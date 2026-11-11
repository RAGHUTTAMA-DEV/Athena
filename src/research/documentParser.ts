import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { PDFParse } from 'pdf-parse';
import mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import Tesseract from 'tesseract.js';
import JSZip from 'jszip';
import {
  DocumentFormat,
  DocumentIndexEntry,
  DocumentMediaAsset,
  DocumentPageRecord,
  PageElementType,
  ParsedDocument
} from './researchTypes.js';
import { CapabilityRegistry, CapabilityStatus } from '../tools/capabilityRegistry.js';
import { GeminiVisionProvider, detectVisualMimeType } from '../multimodal/providers/visionProvider.js';

/**
 * Intelligent Element-Aware & Index-Aware Document Parser.
 *
 * Extracts structured text from PDF, DOCX, XLSX, CSV, HTML, Markdown, and images.
 * - PDFs are analyzed page-by-page to distinguish selectable text, mixed pages
 *   (text + embedded photos/stamps/signatures), and scanned image pages.
 * - Scanned pages and embedded photos (in PDFs and DOCX `word/media/*`) are
 *   extracted, deduplicated, saved to `assetDir` when supplied, and inspected
 *   via Gemini Vision (when GEMINI_API_KEY is configured) or tesseract.js OCR.
 * - Explicit Index / Table of Contents pages, PDF bookmarks/outlines, and
 *   section headings are extracted into `indexEntries` and `outlineSummary`
 *   so the agent can navigate via the Index first instead of blind chunk scanning.
 */

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff', '.pnm', '.pbm']);

export interface ParseDocumentOptions {
  source?: string;
  mimeType?: string;
  /** Optional directory where extracted page scans and embedded photos are saved. */
  assetDir?: string;
  /** Allow Gemini Vision inspection on scanned pages & embedded photos (defaults to true when configured). */
  enableVision?: boolean;
  /** Maximum number of distinct visual inspections (scans/photos) per document (default 12). */
  maxVisionInspections?: number;
}

export function detectFormat(source: string, mimeType?: string): DocumentFormat {
  const ext = path.extname(source.split('?')[0]).toLowerCase();
  if (ext === '.pdf') return 'pdf';
  if (ext === '.docx' || ext === '.doc') return 'docx';
  if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
  if (ext === '.csv' || ext === '.tsv') return 'csv';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.md' || ext === '.markdown') return 'markdown';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (mimeType) {
    if (mimeType.includes('pdf')) return 'pdf';
    if (mimeType.includes('wordprocessingml') || mimeType.includes('msword')) return 'docx';
    if (mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) return 'xlsx';
    if (mimeType.includes('csv')) return 'csv';
    if (mimeType.includes('html')) return 'html';
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.includes('markdown')) return 'markdown';
  }
  return 'text';
}

function sha256Buffer(buf: Buffer | Uint8Array): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function ensureDir(dirPath?: string): Promise<void> {
  if (!dirPath) return;
  await fs.promises.mkdir(dirPath, { recursive: true });
}

function guessImageExt(mimeType: string, fallbackName?: string): string {
  if (fallbackName) {
    const ext = path.extname(fallbackName).toLowerCase();
    if (ext && IMAGE_EXTENSIONS.has(ext)) return ext;
  }
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/gif') return '.gif';
  return '.png';
}

/** Detect whether a page looks like a Table of Contents / Index page. */
export function isTocOrIndexPage(pageText: string): boolean {
  if (!pageText || pageText.trim().length < 25) return false;
  const headerHit = /^\s*(table\s+of\s+contents|contents|index|document\s+index|list\s+of\s+contents|schedule\s+of\s+contents)\b/im.test(
    pageText.slice(0, 600)
  );
  const lines = pageText.split('\n').map((l) => l.trim()).filter(Boolean);
  let tocLineCount = 0;
  for (const line of lines) {
    if (
      /^(.{3,80}?)[\s.·…_-]{2,}(\d{1,4}|[ivxlcdm]{1,6})\s*$/i.test(line) ||
      /^(?:chapter|section|clause|article|part|schedule|annexure|item)\s+[\w.-]+.*\s+(\d{1,4})\s*$/i.test(line)
    ) {
      tocLineCount++;
    }
  }
  return (headerHit && tocLineCount >= 2) || tocLineCount >= 4;
}

/** Extract structured entries from an Index / Table of Contents page. */
export function extractTocEntries(pageText: string): DocumentIndexEntry[] {
  const entries: DocumentIndexEntry[] = [];
  const seen = new Set<string>();
  const lines = pageText.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    // Match "1.2 Title ........ 14" or "Clause 3 Title   8"
    const m =
      line.match(/^(.{3,90}?)[\s.·…_-]{2,}(\d{1,4})\s*$/) ||
      line.match(/^((?:chapter|section|clause|article|part|schedule|annexure|item)\s+[\w.-]+(?:\s*[:\-–]\s*|\s+).{2,80}?)\s+(\d{1,4})\s*$/i);
    if (!m) continue;
    const rawTitle = m[1].replace(/[.·…_-]+$/, '').trim();
    const pageNum = parseInt(m[2], 10);
    if (!rawTitle || isNaN(pageNum) || pageNum <= 0 || pageNum > 5000) continue;
    if (/^(page|total|sno|s\.no|sl\.no)$/i.test(rawTitle)) continue;

    const key = `${rawTitle.toLowerCase()}@${pageNum}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const level = /^\d+\.\d+\.\d+/.test(rawTitle) ? 3 : /^\d+\.\d+/.test(rawTitle) ? 2 : 1;
    entries.push({
      title: rawTitle,
      level,
      pageStart: pageNum,
      source: 'toc_page'
    });
  }
  return entries;
}

/** Extract salient headings from a single page's text. */
export function extractPageHeadings(pageText: string): string[] {
  const headings: string[] = [];
  const lines = pageText.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.length < 4 || line.length > 100) continue;
    if (/^#{1,6}\s+(.+)$/.test(line)) {
      headings.push(line.replace(/^#{1,6}\s+/, '').trim());
      continue;
    }
    if (
      /^(?:CLAUSE|SECTION|ARTICLE|CHAPTER|PART|SCHEDULE|ANNEXURE|EXHIBIT)\s+[\w.-]+/i.test(line) ||
      (/^[A-Z][A-Z\s\d.,:&()/-]{5,75}$/.test(line) && /[A-Z]{3}/.test(line))
    ) {
      headings.push(line);
    }
  }
  return Array.from(new Set(headings)).slice(0, 6);
}

export function buildOutlineSummary(doc: {
  title?: string;
  format: DocumentFormat;
  pageCount?: number;
  pages?: DocumentPageRecord[];
  indexEntries?: DocumentIndexEntry[];
  hasIndexPage?: boolean;
  indexPages?: number[];
  mediaAssets?: DocumentMediaAsset[];
}): string {
  const lines: string[] = [];
  const label = doc.title || 'Document';
  const totalImages = doc.mediaAssets?.length || 0;
  const scannedCount = doc.pages?.filter((p) => p.kind === 'scanned').length || 0;
  const mixedCount = doc.pages?.filter((p) => p.kind === 'mixed').length || 0;

  lines.push(
    `Document Map: ${label} (${doc.format.toUpperCase()}${doc.pageCount ? `, ${doc.pageCount} pages` : ''}` +
      `${totalImages > 0 ? `, ${totalImages} photo/visual asset(s)` : ''}` +
      `${scannedCount > 0 ? `, ${scannedCount} scanned page(s)` : ''}` +
      `${mixedCount > 0 ? `, ${mixedCount} mixed text+photo page(s)` : ''})`
  );

  if (doc.hasIndexPage && doc.indexPages && doc.indexPages.length > 0) {
    lines.push(`Index / Table of Contents found on page(s): ${doc.indexPages.join(', ')}`);
  }

  if (doc.indexEntries && doc.indexEntries.length > 0) {
    lines.push('Structure / Index Entries:');
    for (const entry of doc.indexEntries.slice(0, 40)) {
      const indent = '  '.repeat(Math.max(0, (entry.level || 1) - 1));
      const pageStr = entry.pageStart
        ? entry.pageEnd && entry.pageEnd !== entry.pageStart
          ? `p.${entry.pageStart}-${entry.pageEnd}`
          : `p.${entry.pageStart}`
        : '';
      lines.push(`- ${indent}${entry.title}${pageStr ? ` (${pageStr})` : ''} [${entry.source}]`);
    }
    if (doc.indexEntries.length > 40) {
      lines.push(`  ... (${doc.indexEntries.length - 40} more entries)`);
    }
  }

  if (doc.pages && doc.pages.length > 0) {
    lines.push('Page Layout Summary:');
    for (const p of doc.pages.slice(0, 30)) {
      const tags: string[] = [p.kind];
      if (p.isIndexPage) tags.push('INDEX_PAGE');
      if (p.imageCount > 0) tags.push(`${p.imageCount} photo(s)`);
      const headingNote = p.headings && p.headings.length > 0 ? ` — ${p.headings[0]}` : '';
      lines.push(`  Page ${p.pageNumber}: [${tags.join(', ')}] (${p.charCount} chars)${headingNote}`);
    }
    if (doc.pages.length > 30) {
      lines.push(`  ... (${doc.pages.length - 30} more pages)`);
    }
  }

  if (doc.mediaAssets && doc.mediaAssets.length > 0) {
    lines.push('Visual / Photo Assets:');
    for (const asset of doc.mediaAssets.slice(0, 15)) {
      const pageLabel = asset.pageNumber ? `Page ${asset.pageNumber}` : 'Embedded';
      const cap = asset.caption ? ` — ${asset.caption.slice(0, 160).replace(/\s+/g, ' ')}` : '';
      lines.push(`  - [${asset.id}] ${pageLabel} (${asset.kind}, ${asset.mimeType}) @ ${asset.filePath}${cap}`);
    }
  }

  return lines.join('\n');
}

export class DocumentParser {
  private vision: GeminiVisionProvider;

  constructor(
    private capabilities: CapabilityRegistry = CapabilityRegistry.getInstance(),
    visionProvider?: GeminiVisionProvider
  ) {
    this.vision = visionProvider || new GeminiVisionProvider();
  }

  /** Parse a local file. */
  async parseFile(filePath: string, options: ParseDocumentOptions = {}): Promise<ParsedDocument> {
    const buffer = await fs.promises.readFile(filePath);
    const format = detectFormat(filePath, options.mimeType);
    return this.parseBuffer(buffer, format, { ...options, source: options.source || filePath });
  }

  /** Parse raw bytes with a known format. */
  async parseBuffer(
    buffer: Buffer,
    format: DocumentFormat,
    context: ParseDocumentOptions = {}
  ): Promise<ParsedDocument> {
    switch (format) {
      case 'pdf':
        return this.parsePdf(buffer, context);
      case 'docx':
        return this.parseDocx(buffer, context);
      case 'xlsx': {
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheets: string[] = [];
        const indexEntries: DocumentIndexEntry[] = [];
        for (const name of workbook.SheetNames) {
          const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name]);
          sheets.push(`## Sheet: ${name}\n${csv}`);
          indexEntries.push({ title: `Sheet: ${name}`, level: 1, source: 'heading' });
        }
        return {
          format,
          text: normalizeWhitespace(sheets.join('\n\n')),
          sheets: workbook.SheetNames,
          indexEntries,
          outlineSummary: buildOutlineSummary({
            title: context.source ? path.basename(context.source) : undefined,
            format,
            indexEntries
          }),
          metadata: { sheetNames: workbook.SheetNames }
        };
      }
      case 'csv': {
        const csvText = buffer.toString('utf-8');
        const parsed = Papa.parse<string[]>(csvText, { skipEmptyLines: true });
        return {
          format,
          text: normalizeWhitespace(csvText),
          rows: parsed.data.length
        };
      }
      case 'html': {
        return { format, text: stripHtml(buffer.toString('utf-8')) };
      }
      case 'image':
        return this.parseImage(buffer, context);
      case 'markdown':
      case 'text': {
        const text = normalizeWhitespace(buffer.toString('utf-8'));
        const headings = extractPageHeadings(text);
        const indexEntries: DocumentIndexEntry[] = headings.map((h) => ({
          title: h,
          level: 1,
          source: 'heading'
        }));
        return {
          format,
          text,
          indexEntries: indexEntries.length > 0 ? indexEntries : undefined,
          outlineSummary:
            indexEntries.length > 0
              ? buildOutlineSummary({
                  title: context.source ? path.basename(context.source) : undefined,
                  format,
                  indexEntries
                })
              : undefined
        };
      }
      default: {
        // Exhaustiveness guard
        throw new Error(`Unsupported document format: ${format satisfies never}`);
      }
    }
  }

  /**
   * Element-aware & Index-aware PDF parser:
   * - Inspects every page for selectable text + embedded images.
   * - Classifies pages as `text`, `mixed` (text + photos), or `scanned`.
   * - Runs Gemini Vision / Tesseract OCR on scanned pages and embedded photos.
   * - Extracts PDF outline bookmarks and explicit Index / TOC pages.
   */
  private async parsePdf(buffer: Buffer, context: ParseDocumentOptions): Promise<ParsedDocument> {
    const parser = new PDFParse({ data: buffer });
    const enableVision = context.enableVision ?? this.vision.isConfigured();
    const maxVisionInspections = context.maxVisionInspections ?? 12;
    let visionCount = 0;
    let ocrUsed = false;

    try {
      // Run sequentially so pdfjs-dist initializes and reuses a single worker document load
      const textResult = await parser.getText();
      const infoResult = await parser.getInfo({ parsePageInfo: false }).catch(() => null);
      const imageResult = await parser
        .getImage({ imageThreshold: 50, imageDataUrl: false, imageBuffer: true })
        .catch(() => null);

      const imagesByPage = new Map<number, Array<{ data: Uint8Array; name: string; width: number; height: number }>>();
      if (imageResult && Array.isArray(imageResult.pages)) {
        for (const p of imageResult.pages) {
          imagesByPage.set(p.pageNumber, p.images || []);
        }
      }

      if (context.assetDir) {
        await ensureDir(context.assetDir);
      }

      const rawPages = textResult.pages || [];
      const totalPages = textResult.total || rawPages.length;
      const totalRawChars = rawPages.reduce((acc, p) => acc + normalizeWhitespace(p.text || '').length, 0);

      const pages: DocumentPageRecord[] = [];
      const mediaAssets: DocumentMediaAsset[] = [];
      const indexEntries: DocumentIndexEntry[] = [];
      const indexPages: number[] = [];
      const seenImageHashes = new Set<string>();
      const visionCacheByHash = new Map<string, string>();

      for (let idx = 0; idx < totalPages; idx++) {
        const pageNum = rawPages[idx]?.num || idx + 1;
        let pageText = normalizeWhitespace(rawPages[idx]?.text || '');
        const embeddedImgs = imagesByPage.get(pageNum) || [];
        const cleanCharCount = pageText.replace(/\s+/g, '').length;

        const isScanned =
          (cleanCharCount < 60 && embeddedImgs.length > 0) ||
          (cleanCharCount < 25 && totalRawChars < 120);

        let kind: PageElementType = 'text';
        if (isScanned) kind = 'scanned';
        else if (embeddedImgs.length > 0) kind = 'mixed';

        const pageMediaIds: string[] = [];
        let screenshotPath: string | undefined;
        let visualSummary: string | undefined;

        if (kind === 'scanned') {
          // Render the whole scanned page at 1.5x so stamps, layout, handwritten notes & text stay intact
          let scanBuffer: Buffer | null = null;
          let scanMime = 'image/png';
          try {
            const shot = await parser.getScreenshot({
              partial: [pageNum],
              scale: 1.5,
              imageDataUrl: false,
              imageBuffer: true
            });
            const pageShot = shot.pages?.[0];
            if (pageShot && pageShot.data && pageShot.data.length > 0) {
              scanBuffer = Buffer.from(pageShot.data);
              scanMime = detectVisualMimeType(scanBuffer);
            }
          } catch {
            // Fallback to first embedded image if screenshot rendering fails in headless node canvas
          }

          if (!scanBuffer && embeddedImgs.length > 0 && embeddedImgs[0].data) {
            scanBuffer = Buffer.from(embeddedImgs[0].data);
            scanMime = detectVisualMimeType(scanBuffer, embeddedImgs[0].name);
          }

          if (scanBuffer && scanBuffer.length > 0) {
            const assetId = `p${pageNum}_scan`;
            if (context.assetDir) {
              const ext = guessImageExt(scanMime);
              screenshotPath = path.join(context.assetDir, `page-${pageNum}-scan${ext}`);
              await fs.promises.writeFile(screenshotPath, scanBuffer);
            }

            let extracted = '';
            if (enableVision && this.vision.isConfigured() && visionCount < maxVisionInspections) {
              visionCount++;
              try {
                extracted = await this.vision.inspectBufferStrict(
                  scanBuffer,
                  scanMime,
                  `You are inspecting scanned Page ${pageNum} of a document (${path.basename(context.source || 'document.pdf')}).\n` +
                    `1) Transcribe ALL visible text verbatim, preserving sections, dates, numbers, and table fields.\n` +
                    `2) Explicitly list any PHOTOS (e.g. portraits/passport photos), SIGNATURES, THUMBPRINTS, RUBBER STAMPS, SEALS, HANDWRITING, or visual anomalies (overwriting, white-out, mismatched fonts, missing seals).\n` +
                    `Format cleanly with:\n[TRANSCRIPTION]\n...\n[VISUAL ELEMENTS & PHOTOS]\n...`
                );
                ocrUsed = true;
              } catch {
                // Fall through to Tesseract OCR
              }
            }

            if (!extracted) {
              try {
                const ocrRes = await this.ocr(scanBuffer, `${context.source || 'pdf'}#page=${pageNum}`);
                extracted = ocrRes.text;
                ocrUsed = true;
              } catch {
                extracted = '';
              }
            }

            if (extracted) {
              visualSummary = extracted.slice(0, 400);
              pageText = pageText ? `${pageText}\n\n${extracted}` : extracted;
            } else {
              pageText = pageText || `[Scanned page ${pageNum} contains image data; no text could be extracted automatically.]`;
            }

            mediaAssets.push({
              id: assetId,
              pageNumber: pageNum,
              filePath: screenshotPath || `${context.source || 'pdf'}#page=${pageNum}`,
              mimeType: scanMime,
              caption: visualSummary,
              ocrText: extracted || undefined,
              kind: 'page_scan'
            });
            pageMediaIds.push(assetId);
          }
        } else if (kind === 'mixed') {
          // Page has selectable text AND embedded photos/stamps/signatures!
          const photoNotes: string[] = [];
          let imgCounter = 0;
          for (const img of embeddedImgs) {
            if (!img.data || img.data.length === 0) continue;
            const imgBuf = Buffer.from(img.data);
            const imgHash = sha256Buffer(imgBuf);
            const isRepeatedLogo = seenImageHashes.has(imgHash);
            seenImageHashes.add(imgHash);

            imgCounter++;
            const assetId = `p${pageNum}_img${imgCounter}`;
            const imgMime = detectVisualMimeType(imgBuf, img.name);
            let savedImgPath = `${context.source || 'pdf'}#page=${pageNum}#${img.name}`;

            if (context.assetDir && !isRepeatedLogo) {
              const ext = guessImageExt(imgMime, img.name);
              savedImgPath = path.join(context.assetDir, `page-${pageNum}-photo-${imgCounter}${ext}`);
              await fs.promises.writeFile(savedImgPath, imgBuf);
            }

            let caption = visionCacheByHash.get(imgHash);
            if (!caption && !isRepeatedLogo && enableVision && this.vision.isConfigured() && visionCount < maxVisionInspections) {
              visionCount++;
              try {
                caption = await this.vision.inspectBufferStrict(
                  imgBuf,
                  imgMime,
                  `Inspect this embedded image from Page ${pageNum} of "${path.basename(context.source || 'document.pdf')}". ` +
                    `State concisely what it shows (e.g., passport photo of person, signature, thumbprint, rubber stamp/seal, QR code, diagram, chart, or decorative logo), extract any readable text/names/dates inside it, and note any visual anomalies.`
                );
                visionCacheByHash.set(imgHash, caption);
              } catch {
                // Keep non-fatal; image is still saved on disk for imageInspect tool
              }
            }

            if (!isRepeatedLogo) {
              mediaAssets.push({
                id: assetId,
                pageNumber: pageNum,
                filePath: savedImgPath,
                mimeType: imgMime,
                width: img.width,
                height: img.height,
                caption,
                kind: 'embedded_photo'
              });
              pageMediaIds.push(assetId);
              photoNotes.push(
                `- [${assetId}] Photo (${img.width}x${img.height}) saved at ${savedImgPath}${caption ? `: ${caption.replace(/\s+/g, ' ')}` : ''}`
              );
            }
          }

          if (photoNotes.length > 0) {
            visualSummary = photoNotes.join('\n');
            pageText = `${pageText}\n\n[Embedded Photos/Visuals on Page ${pageNum}]\n${visualSummary}`;
          }
        }

        const tocHit = isTocOrIndexPage(pageText);
        if (tocHit) {
          indexPages.push(pageNum);
          for (const entry of extractTocEntries(pageText)) {
            indexEntries.push(entry);
          }
        }

        const headings = extractPageHeadings(pageText);
        for (const h of headings) {
          if (!tocHit) {
            indexEntries.push({
              title: h,
              level: 1,
              pageStart: pageNum,
              source: 'heading'
            });
          }
        }

        pages.push({
          pageNumber: pageNum,
          kind,
          charCount: pageText.length,
          imageCount: embeddedImgs.length,
          text: pageText,
          visualSummary,
          screenshotPath,
          mediaIds: pageMediaIds.length > 0 ? pageMediaIds : undefined,
          headings: headings.length > 0 ? headings : undefined,
          isIndexPage: tocHit || undefined
        });
      }

      // Include PDF outline bookmarks if present and not already redundant
      if (infoResult?.outline && Array.isArray(infoResult.outline)) {
        const walkOutline = (nodes: any[], level: number) => {
          for (const node of nodes) {
            if (node?.title) {
              indexEntries.unshift({
                title: String(node.title).trim(),
                level,
                source: 'pdf_outline'
              });
            }
            if (Array.isArray(node?.items) && node.items.length > 0) {
              walkOutline(node.items, level + 1);
            }
          }
        };
        walkOutline(infoResult.outline, 1);
      }

      const fullText = normalizeWhitespace(
        pages
          .map((p) => {
            if (pages.length <= 1) return p.text;
            const photoTag = p.imageCount > 0 ? ` | photos=${p.imageCount}` : '';
            const idxTag = p.isIndexPage ? ' | INDEX_PAGE' : '';
            return `=== Page ${p.pageNumber} (${p.kind}${photoTag}${idxTag}) ===\n${p.text}`;
          })
          .join('\n\n')
      );

      const outlineSummary = buildOutlineSummary({
        title: infoResult?.info?.Title || (context.source ? path.basename(context.source) : undefined),
        format: 'pdf',
        pageCount: totalPages,
        pages,
        indexEntries,
        hasIndexPage: indexPages.length > 0,
        indexPages,
        mediaAssets
      });

      return {
        format: 'pdf',
        text: fullText,
        pageCount: totalPages,
        ocr: ocrUsed || undefined,
        pages,
        indexEntries: indexEntries.length > 0 ? indexEntries : undefined,
        hasIndexPage: indexPages.length > 0,
        indexPages: indexPages.length > 0 ? indexPages : undefined,
        mediaAssets: mediaAssets.length > 0 ? mediaAssets : undefined,
        outlineSummary,
        metadata: {
          pages: pages.length,
          pdfInfo: infoResult?.info,
          hasOutline: Boolean(infoResult?.outline && infoResult.outline.length > 0),
          mediaCount: mediaAssets.length,
          scannedPages: pages.filter((p) => p.kind === 'scanned').map((p) => p.pageNumber),
          mixedPages: pages.filter((p) => p.kind === 'mixed').map((p) => p.pageNumber)
        }
      };
    } finally {
      await parser.destroy();
    }
  }

  /**
   * Element-aware & Heading/TOC-aware DOCX parser:
   * - Extracts clean text + HTML headings (`<h1>`-`<h6>`).
   * - Inspects `word/media/*` inside the OOXML zip archive to detect embedded
   *   photos, signatures, stamps, and scans, inspecting them with Gemini Vision.
   */
  private async parseDocx(buffer: Buffer, context: ParseDocumentOptions): Promise<ParsedDocument> {
    const rawResult = await mammoth.extractRawText({ buffer });
    let rawText = normalizeWhitespace(rawResult.value || '');

    const indexEntries: DocumentIndexEntry[] = [];
    const mediaAssets: DocumentMediaAsset[] = [];
    const enableVision = context.enableVision ?? this.vision.isConfigured();
    const maxVisionInspections = context.maxVisionInspections ?? 10;
    let visionCount = 0;

    // Extract headings from HTML conversion cleanly (non-fatal if minimal OOXML lacks styles)
    try {
      const htmlResult = await mammoth.convertToHtml({ buffer });
      const headingRe = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
      let m: RegExpExecArray | null;
      while ((m = headingRe.exec(htmlResult.value || '')) !== null) {
        const level = parseInt(m[1], 10) || 1;
        const headingText = stripHtml(m[2]).trim();
        if (headingText) {
          indexEntries.push({ title: headingText, level, source: 'heading' });
        }
      }
    } catch {
      // Non-fatal fallback to regex heading extraction below
    }

    if (indexEntries.length === 0) {
      for (const h of extractPageHeadings(rawText)) {
        indexEntries.push({ title: h, level: 1, source: 'heading' });
      }
    }

    const hasIndexPage = isTocOrIndexPage(rawText.slice(0, 4000));
    if (hasIndexPage) {
      for (const toc of extractTocEntries(rawText.slice(0, 6000))) {
        indexEntries.push(toc);
      }
    }

    // Inspect embedded media inside word/media/* via JSZip
    try {
      const zip = await JSZip.loadAsync(buffer);
      const mediaEntries = Object.values(zip.files).filter(
        (f) => !f.dir && /^word\/media\//i.test(f.name)
      );

      if (mediaEntries.length > 0) {
        if (context.assetDir) {
          await ensureDir(context.assetDir);
        }
        const seenHashes = new Set<string>();
        let mediaIdx = 0;
        const mediaNotes: string[] = [];

        for (const entry of mediaEntries) {
          const imgBuf = await entry.async('nodebuffer');
          if (!imgBuf || imgBuf.length < 256) continue;
          const hash = sha256Buffer(imgBuf);
          if (seenHashes.has(hash)) continue;
          seenHashes.add(hash);

          mediaIdx++;
          const mimeType = detectVisualMimeType(imgBuf, entry.name);
          const ext = guessImageExt(mimeType, entry.name);
          const savedPath = context.assetDir
            ? path.join(context.assetDir, `docx-photo-${mediaIdx}${ext}`)
            : `${context.source || 'docx'}#${entry.name}`;

          if (context.assetDir) {
            await fs.promises.writeFile(savedPath, imgBuf);
          }

          let caption: string | undefined;
          if (enableVision && this.vision.isConfigured() && visionCount < maxVisionInspections) {
            visionCount++;
            try {
              caption = await this.vision.inspectBufferStrict(
                imgBuf,
                mimeType,
                `Inspect this image embedded inside DOCX "${path.basename(context.source || 'document.docx')}". ` +
                  `Identify what it is (passport photo, signature, stamp/seal, chart, screenshot, etc.), extract any visible text/names/dates, and note anything unusual.`
              );
            } catch {
              // Keep asset recorded even if vision call fails
            }
          }

          const assetId = `docx_img_${mediaIdx}`;
          mediaAssets.push({
            id: assetId,
            filePath: savedPath,
            mimeType,
            caption,
            kind: 'embedded_photo'
          });
          mediaNotes.push(`- [${assetId}] Embedded image (${entry.name}) saved at ${savedPath}${caption ? `: ${caption.replace(/\s+/g, ' ')}` : ''}`);
        }

        if (mediaNotes.length > 0) {
          rawText = `${rawText}\n\n[Embedded Photos/Visuals in DOCX]\n${mediaNotes.join('\n')}`;
        }
      }
    } catch {
      // Non-fatal if zip inspection fails on malformed doc
    }

    // Paginate long DOCX documents cleanly into ~3,500-char logical pages for targeted reading
    const pages: DocumentPageRecord[] = [];
    if (rawText.length > 0) {
      const paras = rawText.split(/\n\s*\n/).filter(Boolean);
      let chunk = '';
      for (const para of paras) {
        if (chunk && chunk.length + para.length + 2 > 3500) {
          const pNum = pages.length + 1;
          pages.push({
            pageNumber: pNum,
            kind: mediaAssets.length > 0 && pNum === 1 ? 'mixed' : 'text',
            charCount: chunk.length,
            imageCount: pNum === 1 ? mediaAssets.length : 0,
            text: chunk,
            headings: extractPageHeadings(chunk)
          });
          chunk = para;
        } else {
          chunk = chunk ? `${chunk}\n\n${para}` : para;
        }
      }
      if (chunk) {
        const pNum = pages.length + 1;
        pages.push({
          pageNumber: pNum,
          kind: mediaAssets.length > 0 && pNum === 1 ? 'mixed' : 'text',
          charCount: chunk.length,
          imageCount: pNum === 1 ? mediaAssets.length : 0,
          text: chunk,
          headings: extractPageHeadings(chunk)
        });
      }
    }

    const outlineSummary = buildOutlineSummary({
      title: context.source ? path.basename(context.source) : undefined,
      format: 'docx',
      pageCount: pages.length || undefined,
      pages: pages.length > 1 ? pages : undefined,
      indexEntries,
      hasIndexPage,
      mediaAssets
    });

    return {
      format: 'docx',
      text: rawText,
      pageCount: pages.length > 0 ? pages.length : undefined,
      pages: pages.length > 0 ? pages : undefined,
      hasIndexPage: hasIndexPage || undefined,
      indexEntries: indexEntries.length > 0 ? indexEntries : undefined,
      mediaAssets: mediaAssets.length > 0 ? mediaAssets : undefined,
      outlineSummary,
      metadata: {
        mediaCount: mediaAssets.length,
        headingCount: indexEntries.length
      }
    };
  }

  /**
   * Image parser: saves asset when `assetDir` is provided, uses Gemini Vision
   * (verbatim text + photo/stamp/anomaly inspection) when configured, and falls
   * back to Tesseract OCR.
   */
  private async parseImage(buffer: Buffer, context: ParseDocumentOptions): Promise<ParsedDocument> {
    const mimeType = detectVisualMimeType(buffer, context.source);
    let savedPath = context.source || 'image';
    if (context.assetDir) {
      await ensureDir(context.assetDir);
      const ext = guessImageExt(mimeType, context.source);
      savedPath = path.join(context.assetDir, `image${ext}`);
      await fs.promises.writeFile(savedPath, buffer);
    }

    const enableVision = context.enableVision ?? this.vision.isConfigured();
    if (enableVision && this.vision.isConfigured()) {
      try {
        const visionText = await this.vision.inspectBufferStrict(
          buffer,
          mimeType,
          `Analyze this attached image (${path.basename(context.source || 'image')}).\n` +
            `1) Describe what is visually in the photo/image (people, documents, stamps, seals, signatures, UI, objects).\n` +
            `2) Transcribe ALL readable text verbatim.\n` +
            `3) Highlight any suspicious visual details, edits, mismatched regions, or obscured information.`
        );
        const asset: DocumentMediaAsset = {
          id: 'img_1',
          pageNumber: 1,
          filePath: savedPath,
          mimeType,
          caption: visionText.slice(0, 400),
          ocrText: visionText,
          kind: 'image_file'
        };
        return {
          format: 'image',
          text: normalizeWhitespace(visionText),
          pageCount: 1,
          ocr: true,
          mediaAssets: [asset],
          outlineSummary: buildOutlineSummary({
            title: context.source ? path.basename(context.source) : undefined,
            format: 'image',
            pageCount: 1,
            mediaAssets: [asset]
          }),
          metadata: { source: context.source, mimeType, visionProvider: 'gemini' }
        };
      } catch {
        // Fallback to Tesseract OCR below
      }
    }

    const ocrDoc = await this.ocr(buffer, context.source);
    const asset: DocumentMediaAsset = {
      id: 'img_1',
      pageNumber: 1,
      filePath: savedPath,
      mimeType,
      ocrText: ocrDoc.text,
      kind: 'image_file'
    };
    return {
      ...ocrDoc,
      pageCount: 1,
      mediaAssets: [asset],
      metadata: { ...ocrDoc.metadata, mimeType }
    };
  }

  /**
   * OCR for scanned documents/images — experimental capability. On failure
   * the capability status stays honest (`experimental` with reason or
   * `unsupported`) and a typed error propagates; the caller never receives
   * fabricated text.
   */
  async ocr(buffer: Buffer, source?: string): Promise<ParsedDocument> {
    const entry = this.capabilities.get('documents.ocr');
    const previousStatus: CapabilityStatus = entry?.status || 'experimental';
    let worker: Tesseract.Worker | undefined;
    try {
      this.capabilities.setStatus('documents.ocr', 'experimental');
      let rejectOnWorkerError!: (err: Error) => void;
      const workerErrorPromise = new Promise<never>((_, reject) => {
        rejectOnWorkerError = reject;
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => reject(new Error('OCR timed out after 15000ms')), 15000);
        if (typeof (timer as any).unref === 'function') (timer as any).unref();
      });

      worker = await Promise.race([
        Tesseract.createWorker('eng', 1, {
          errorHandler: (err: any) => {
            rejectOnWorkerError(new Error(err?.message || String(err)));
          }
        }),
        workerErrorPromise,
        timeoutPromise
      ]);

      const { data } = await Promise.race([
        worker.recognize(buffer),
        workerErrorPromise,
        timeoutPromise
      ]);
      const text = typeof data.text === 'string' ? data.text : '';
      if (!text.trim()) {
        throw new Error('OCR produced no text');
      }
      return { format: 'image', text: normalizeWhitespace(text), ocr: true, metadata: { source } };
    } catch (err: any) {
      this.capabilities.setStatus(
        'documents.ocr',
        'experimental',
        `Last OCR attempt failed: ${err?.message || String(err)}`
      );
      // Restore the pre-existing status (experimental by default).
      this.capabilities.setStatus('documents.ocr', previousStatus);
      throw new Error(
        `OCR failed for ${source || 'image buffer'} (capability is experimental): ${err?.message || String(err)}`
      );
    } finally {
      if (worker) {
        await worker.terminate().catch(() => {});
      }
    }
  }
}

export function stripHtml(html: string): string {
  return normalizeWhitespace(
    html
      // Drop script/style blocks entirely — their content is not document text.
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|tr|table|ul|ol|section|article|blockquote)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
