import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { DocumentParser, detectFormat } from '../../research/documentParser.js';
import { RagEngine } from '../../research/ragPipeline.js';
import { ParsedDocument } from '../../research/researchTypes.js';
import { ConfiguredEmbeddingProvider } from '../../providers/embeddingProvider.js';
import { LocalCrossEncoderReranker } from '../../providers/localReranker.js';
import { AgentMediaAttachment } from '../../runtime/types.js';

export interface UploadAttachmentInput {
  fileName: string;
  mimeType?: string;
  contentBase64?: string;
  textContent?: string;
  sessionId?: string;
  workspaceId?: number;
  sourceUri?: string;
  sourceType?: 'file' | 'url' | 'text';
  namespace?: string;
}

export interface UploadedAttachmentResult {
  attachmentId: string;
  documentId: string;
  name: string;
  mimeType: string;
  size: number;
  filePath: string;
  sidecarPath: string;
  format: string;
  pageCount?: number;
  charCount: number;
  chunkCount: number;
  ocrUsed: boolean;
  hasIndexPage: boolean;
  indexPages: number[];
  indexEntryCount: number;
  mediaCount: number;
  scannedPages: number[];
  mixedPages: number[];
  outlineSummary?: string;
  preview: string;
  ragIndexed: boolean;
  deduplicated: boolean;
  warning?: string;
}

export interface PreparedAttachmentPrompt {
  promptText: string;
  persistedUserPrompt: string;
  mediaAttachments: AgentMediaAttachment[];
  forcedTools: string[];
  documentIds: string[];
}

function sanitizeSegment(raw: string, fallback: string): string {
  const cleaned = String(raw || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || fallback;
}

function decodeBase64Payload(raw: string): Buffer {
  const commaIdx = raw.indexOf(',');
  const payload = raw.startsWith('data:') && commaIdx !== -1 ? raw.slice(commaIdx + 1) : raw;
  return Buffer.from(payload, 'base64');
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf-8').digest('hex');
}

export class AttachmentService {
  private parser = new DocumentParser();
  private embedder = new ConfiguredEmbeddingProvider();
  private reranker = new LocalCrossEncoderReranker();

  constructor(private stores: any) {}

  private createRagEngine(namespace = 'documents'): RagEngine {
    return new RagEngine(
      {
        vectorStore: this.stores.vector,
        documentStore: this.stores.researchDocument,
        embedder: this.embedder,
        reranker: this.reranker,
        parser: this.parser
      },
      { namespace }
    );
  }

  async ingestUpload(input: UploadAttachmentInput): Promise<UploadedAttachmentResult> {
    const safeName = sanitizeSegment(path.basename(input.fileName || 'document.txt'), 'document.txt');
    const safeSession = sanitizeSegment(input.sessionId || 'knowledge', 'knowledge');
    const attachmentId = `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const uploadDir = path.resolve(process.cwd(), 'scratch', 'uploads', safeSession);
    await fs.promises.mkdir(uploadDir, { recursive: true });

    let buffer: Buffer;
    if (input.contentBase64) {
      buffer = decodeBase64Payload(input.contentBase64);
    } else if (typeof input.textContent === 'string') {
      buffer = Buffer.from(input.textContent, 'utf-8');
    } else {
      throw new Error('Either contentBase64 or textContent is required.');
    }

    const filePath = path.join(uploadDir, `${attachmentId}-${safeName}`);
    const assetDir = `${filePath}.assets`;
    const sidecarPath = `${filePath}.parsed.json`;

    await fs.promises.writeFile(filePath, buffer);

    const format = detectFormat(safeName, input.mimeType);
    const parsed: ParsedDocument = await this.parser.parseFile(filePath, {
      assetDir,
      mimeType: input.mimeType,
      source: filePath
    });

    await fs.promises.writeFile(sidecarPath, JSON.stringify(parsed, null, 2), 'utf-8');

    const sourceUri = input.sourceUri || filePath;
    const sourceType = input.sourceType || (input.contentBase64 ? 'file' : 'text');

    let documentId = '';
    let chunkCount = 0;
    let ragIndexed = false;
    let deduplicated = false;
    let finalFilePath = filePath;
    let finalSidecarPath = sidecarPath;
    let warning: string | undefined;

    const compactPages = parsed.pages?.map((p) => ({
      pageNumber: p.pageNumber,
      kind: p.kind,
      charCount: p.charCount,
      imageCount: p.imageCount,
      isIndexPage: p.isIndexPage,
      headings: p.headings,
      screenshotPath: p.screenshotPath
    }));

    const enrichedMeta = {
      pageCount: parsed.pageCount,
      ocr: parsed.ocr,
      hasIndexPage: parsed.hasIndexPage,
      indexPages: parsed.indexPages,
      indexEntries: parsed.indexEntries?.slice(0, 80),
      mediaAssets: parsed.mediaAssets,
      outlineSummary: parsed.outlineSummary,
      pageSummaries: compactPages,
      sidecarPath,
      filePath
    };

    if (this.stores?.researchDocument) {
      if (this.stores.vector && this.embedder.isConfigured() && parsed.text.trim().length > 0) {
        try {
          const rag = this.createRagEngine(input.namespace || 'documents');
          const ingestRes = await rag.ingestParsedDocument(parsed, sourceType, sourceUri, {
            workspaceId: input.workspaceId,
            sessionId: input.sessionId,
            title: safeName,
            sidecarPath
          });
          documentId = ingestRes.documentId;
          chunkCount = ingestRes.chunkCount;
          ragIndexed = true;
          deduplicated = Boolean(ingestRes.deduplicated);

          // If deduplicated against an existing doc, merge any missing intelligent metadata & link sessionId
          const saved = await this.stores.researchDocument.get(documentId);
          if (saved) {
            const sessionIds = Array.isArray(saved.metadata?.sessionIds)
              ? Array.from(new Set([...saved.metadata.sessionIds, input.sessionId].filter(Boolean)))
              : [saved.metadata?.sessionId, input.sessionId].filter(Boolean);
            const existingSidecarOk = saved.metadata?.sidecarPath && fs.existsSync(saved.metadata.sidecarPath);
            const existingFileOk = saved.metadata?.filePath && fs.existsSync(saved.metadata.filePath);

            finalSidecarPath = existingSidecarOk ? saved.metadata.sidecarPath : sidecarPath;
            finalFilePath = existingFileOk ? saved.metadata.filePath : filePath;

            await this.stores.researchDocument.save({
              ...saved,
              metadata: {
                ...enrichedMeta,
                ...saved.metadata,
                // Always fill in structural/photo intelligence if older record lacked it
                hasIndexPage: saved.metadata?.hasIndexPage ?? enrichedMeta.hasIndexPage,
                indexPages: saved.metadata?.indexPages ?? enrichedMeta.indexPages,
                indexEntries: saved.metadata?.indexEntries ?? enrichedMeta.indexEntries,
                mediaAssets: saved.metadata?.mediaAssets ?? enrichedMeta.mediaAssets,
                outlineSummary: saved.metadata?.outlineSummary ?? enrichedMeta.outlineSummary,
                pageSummaries: saved.metadata?.pageSummaries ?? enrichedMeta.pageSummaries,
                sidecarPath: finalSidecarPath,
                filePath: finalFilePath,
                sessionId: input.sessionId || saved.metadata?.sessionId,
                sessionIds
              }
            });
          }
        } catch (err: any) {
          warning = `RAG embedding skipped (${err?.message || String(err)}); structural/page reader remains active.`;
        }
      } else if (!this.embedder.isConfigured()) {
        warning = 'Embedding provider not configured; structural/page reader and direct document context remain active.';
      }

      // Fallback record (deduplicated by contentHash) if RagEngine skipped
      if (!documentId) {
        const contentHash = sha256(parsed.text || safeName);
        const existing = await this.stores.researchDocument.findByHash(contentHash);
        if (existing) {
          documentId = existing.id;
          chunkCount = existing.chunkCount || 0;
          deduplicated = true;
          const sessionIds = Array.isArray(existing.metadata?.sessionIds)
            ? Array.from(new Set([...existing.metadata.sessionIds, input.sessionId].filter(Boolean)))
            : [existing.metadata?.sessionId, input.sessionId].filter(Boolean);
          const existingSidecarOk = existing.metadata?.sidecarPath && fs.existsSync(existing.metadata.sidecarPath);
          const existingFileOk = existing.metadata?.filePath && fs.existsSync(existing.metadata.filePath);
          finalSidecarPath = existingSidecarOk ? existing.metadata.sidecarPath : sidecarPath;
          finalFilePath = existingFileOk ? existing.metadata.filePath : filePath;
          await this.stores.researchDocument.save({
            ...existing,
            metadata: {
              ...enrichedMeta,
              ...existing.metadata,
              sidecarPath: finalSidecarPath,
              filePath: finalFilePath,
              sessionId: input.sessionId || existing.metadata?.sessionId,
              sessionIds
            }
          });
        } else {
          documentId = `doc_${crypto.randomUUID()}`;
          await this.stores.researchDocument.save({
            id: documentId,
            sourceType,
            sourceUri,
            title: safeName,
            format: parsed.format,
            contentHash,
            chunkCount: 0,
            charCount: parsed.text.length,
            workspaceId: input.workspaceId ?? null,
            metadata: {
              ...enrichedMeta,
              sessionId: input.sessionId,
              sessionIds: input.sessionId ? [input.sessionId] : undefined
            }
          });
        }
      }
    }

    const scannedPages = parsed.pages?.filter((p) => p.kind === 'scanned').map((p) => p.pageNumber) || [];
    const mixedPages = parsed.pages?.filter((p) => p.kind === 'mixed').map((p) => p.pageNumber) || [];

    return {
      attachmentId,
      documentId,
      name: safeName,
      mimeType: input.mimeType || 'application/octet-stream',
      size: buffer.length,
      filePath: finalFilePath,
      sidecarPath: finalSidecarPath,
      format: parsed.format,
      pageCount: parsed.pageCount || (parsed.pages ? parsed.pages.length : undefined),
      charCount: parsed.text.length,
      chunkCount,
      ocrUsed: Boolean(parsed.ocr),
      hasIndexPage: Boolean(parsed.hasIndexPage),
      indexPages: parsed.indexPages || [],
      indexEntryCount: parsed.indexEntries?.length || 0,
      mediaCount: parsed.mediaAssets?.length || 0,
      scannedPages,
      mixedPages,
      outlineSummary: parsed.outlineSummary,
      preview: parsed.text.slice(0, 600),
      ragIndexed,
      deduplicated,
      warning
    };
  }

  private async loadParsedFromDocOrAttachment(att: any): Promise<{
    docRecord: any;
    parsed: ParsedDocument | null;
    filePath?: string;
  }> {
    let docRecord: any = null;
    if (att?.documentId && this.stores?.researchDocument) {
      docRecord = await this.stores.researchDocument.get(att.documentId);
    }
    const sidecarPath = att?.sidecarPath || docRecord?.metadata?.sidecarPath || (att?.filePath ? `${att.filePath}.parsed.json` : undefined);
    if (sidecarPath && fs.existsSync(sidecarPath)) {
      try {
        const raw = await fs.promises.readFile(sidecarPath, 'utf-8');
        return { docRecord, parsed: JSON.parse(raw) as ParsedDocument, filePath: att?.filePath || docRecord?.sourceUri };
      } catch {}
    }
    const targetPath = att?.filePath || docRecord?.metadata?.filePath || docRecord?.sourceUri;
    if (targetPath && fs.existsSync(targetPath)) {
      const parsed = await this.parser.parseFile(targetPath, { assetDir: `${targetPath}.assets` });
      return { docRecord, parsed, filePath: targetPath };
    }
    return { docRecord, parsed: null, filePath: targetPath };
  }

  /**
   * Builds intelligent prompt context + multimodal visual parts for attached documents.
   * - Small/medium documents (combined <= 24,000 chars): injects structured text,
   *   element map, photo notes, and actual visual `inlineData` assets so Gemini
   *   inspects both text AND photos/stamps/signatures directly.
   * - Large documents (> 24,000 chars): injects the Document Index / Table of Contents
   *   + Page Layout Map + Index Page text + top scoped RAG chunks, guiding the agent
   *   to navigate via `readDocument` (`pages`/`section`) and `searchDocuments`.
   */
  async preparePromptContext(params: {
    userPrompt: string;
    attachments?: any[];
    sessionId?: string;
  }): Promise<PreparedAttachmentPrompt> {
    const rawAttachments = Array.isArray(params.attachments) ? params.attachments : [];

    // Follow-up turn without fresh attachments: provide lightweight manifest of session docs
    if (rawAttachments.length === 0) {
      if (params.sessionId && this.stores?.researchDocument) {
        const recentDocs = await this.stores.researchDocument.list({ limit: 40 });
        const sessionDocs = recentDocs.filter(
          (d: any) =>
            d.metadata?.sessionId === params.sessionId ||
            (Array.isArray(d.metadata?.sessionIds) && d.metadata.sessionIds.includes(params.sessionId))
        );
        if (sessionDocs.length > 0) {
          const docSummaryLines = sessionDocs.slice(0, 6).map((d: any) => {
            const pCount = d.metadata?.pageCount ? `, ${d.metadata.pageCount} pages` : '';
            const mCount = d.metadata?.mediaAssets?.length ? `, ${d.metadata.mediaAssets.length} photos` : '';
            const idxFlag = d.metadata?.hasIndexPage ? ', HAS INDEX PAGE' : '';
            return `- "${d.title || d.sourceUri}" | documentId=${d.id} | path=${d.metadata?.filePath || d.sourceUri} (${d.format || 'doc'}${pCount}${mCount}${idxFlag})`;
          });
          return {
            promptText:
              `${params.userPrompt}\n\n[Session Documents Available via readDocument / searchDocuments / imageInspect]\n` +
              `${docSummaryLines.join('\n')}\n` +
              `Answer directly from conversation history when already established, or use readDocument / searchDocuments / imageInspect with the documentId above.`,
            persistedUserPrompt: params.userPrompt,
            mediaAttachments: [],
            forcedTools: ['readDocument', 'searchDocuments', 'imageInspect'],
            documentIds: sessionDocs.map((d: any) => d.id)
          };
        }
      }

      return {
        promptText: params.userPrompt,
        persistedUserPrompt: params.userPrompt,
        mediaAttachments: [],
        forcedTools: [],
        documentIds: []
      };
    }

    const loadedDocs: Array<{
      att: any;
      name: string;
      docId?: string;
      filePath?: string;
      parsed: ParsedDocument | null;
      inlineTextFallback?: string;
    }> = [];

    for (const att of rawAttachments) {
      const name = att?.name || 'attachment';
      if (att?.documentId || att?.filePath || att?.sidecarPath) {
        const { docRecord, parsed, filePath } = await this.loadParsedFromDocOrAttachment(att);
        loadedDocs.push({
          att,
          name,
          docId: att.documentId || docRecord?.id,
          filePath,
          parsed
        });
      } else if (att?.contentBase64) {
        // Legacy/direct API caller sending base64 inline in submitMessage
        const uploaded = await this.ingestUpload({
          fileName: name,
          mimeType: att.mimeType,
          contentBase64: att.contentBase64,
          sessionId: params.sessionId
        });
        const { docRecord, parsed, filePath } = await this.loadParsedFromDocOrAttachment(uploaded);
        loadedDocs.push({
          att: uploaded,
          name,
          docId: uploaded.documentId || docRecord?.id,
          filePath,
          parsed
        });
      } else {
        loadedDocs.push({
          att,
          name,
          parsed: null,
          inlineTextFallback: att?.content
            ? String(att.content).slice(0, 20000)
            : `[Empty or unparsed attachment: ${att?.mimeType || 'unknown'}]`
        });
      }
    }

    const totalChars = loadedDocs.reduce(
      (sum, d) => sum + (d.parsed ? d.parsed.text.length : d.inlineTextFallback?.length || 0),
      0
    );
    // Gemini handles 120k chars (~30k tokens) effortlessly in direct context, avoiding unnecessary readDocument round-trips
    const directMode = totalChars <= 120000;

    const contextSections: string[] = [];
    const mediaAttachments: AgentMediaAttachment[] = [];
    const documentIds: string[] = [];
    const MAX_MEDIA_PARTS = 6;

    for (const item of loadedDocs) {
      if (item.docId) documentIds.push(item.docId);

      if (!item.parsed) {
        contextSections.push(`--- Attached File: ${item.name} ---\n${item.inlineTextFallback}`);
        continue;
      }

      const p = item.parsed;
      const header = [
        `--- Attached Document: ${item.name} ---`,
        `documentId=${item.docId || 'unsaved'} | format=${p.format}${p.pageCount ? ` | pages=${p.pageCount}` : ''} | chars=${p.text.length}` +
          `${p.ocr ? ' | ocr/vision=yes' : ''}${p.hasIndexPage ? ` | indexPages=[${(p.indexPages || []).join(',')}]` : ''}` +
          `${p.mediaAssets?.length ? ` | photos=${p.mediaAssets.length}` : ''}`,
        item.filePath ? `filePath=${item.filePath}` : ''
      ]
        .filter(Boolean)
        .join('\n');

      // Prioritize key visual assets (standalone images, embedded photos, and pages with photos/stamps/signatures)
      if (p.mediaAssets && p.mediaAssets.length > 0 && mediaAttachments.length < MAX_MEDIA_PARTS) {
        const prioritized = [...p.mediaAssets].sort((a, b) => {
          const score = (m: typeof a) => {
            if (m.kind === 'image_file' || m.kind === 'embedded_photo') return 3;
            const txt = `${m.caption || ''} ${m.ocrText || ''}`;
            if (/\[PHOTO\]|passport\s*photo|thumbprint|anomaly|tamper|overwrit/i.test(txt)) return 2;
            return 1;
          };
          return score(b) - score(a);
        });
        for (const asset of prioritized) {
          if (mediaAttachments.length >= MAX_MEDIA_PARTS) break;
          if (asset.filePath && fs.existsSync(asset.filePath) && asset.mimeType.startsWith('image/')) {
            mediaAttachments.push({
              filePath: asset.filePath,
              mimeType: asset.mimeType,
              name: `${item.name}${asset.pageNumber ? ` (Page ${asset.pageNumber})` : ''}`,
              pageNumber: asset.pageNumber
            });
          }
        }
      }

      if (directMode) {
        const outlinePart = p.outlineSummary && ((p.pageCount || 0) > 1 || (p.mediaAssets?.length || 0) > 0 || p.hasIndexPage)
          ? `\n[Structure & Visual Map]\n${p.outlineSummary}\n`
          : '';
        contextSections.push(`${header}${outlinePart}\n[Extracted Content]\n${p.text}\n--- End of ${item.name} ---`);
      } else {
        // Index-First + Scoped RAG mode for large docs
        const indexPageTexts: string[] = [];
        if (p.pages && p.indexPages && p.indexPages.length > 0) {
          for (const ip of p.indexPages.slice(0, 3)) {
            const pg = p.pages.find((x) => x.pageNumber === ip);
            if (pg) indexPageTexts.push(`=== Index Page ${pg.pageNumber} ===\n${pg.text.slice(0, 2500)}`);
          }
        }

        let ragHitsText = '';
        if (item.docId && this.embedder.isConfigured() && this.stores?.vector) {
          try {
            const rag = this.createRagEngine('documents');
            const qRes = await rag.query(params.userPrompt, { topK: 4, documentIds: [item.docId] });
            if (qRes.results.length > 0) {
              ragHitsText =
                `\n[Top Scoped RAG Matches for Query]\n` +
                qRes.results
                  .map(
                    (r) =>
                      `#${r.rank}${r.pageNumber ? ` (Page ${r.pageNumber})` : ''}${r.section ? ` [${r.section}]` : ''}: ${r.text.slice(0, 1400)}`
                  )
                  .join('\n---\n');
            }
          } catch {}
        }

        const firstPagePreview = p.pages?.[0]
          ? `\n[Page 1 Preview]\n${p.pages[0].text.slice(0, 1200)}`
          : `\n[Opening Excerpt]\n${p.text.slice(0, 1200)}`;

        contextSections.push(
          `${header}\n` +
            `[Structure, Index & Photo Map]\n${p.outlineSummary || '(No outline extracted)'}\n` +
            (indexPageTexts.length > 0 ? `\n[Index / Table of Contents Page Text]\n${indexPageTexts.join('\n\n')}\n` : '') +
            `${firstPagePreview}` +
            `${ragHitsText}\n` +
            `--- End of Summary for ${item.name} ---`
        );
      }
    }

    const attachmentLabelSummary = loadedDocs
      .map((d) => {
        const metaParts: string[] = [];
        if (d.parsed?.format) metaParts.push(d.parsed.format.toUpperCase());
        if (d.parsed?.pageCount) metaParts.push(`${d.parsed.pageCount}p`);
        if (d.parsed?.mediaAssets?.length) metaParts.push(`${d.parsed.mediaAssets.length} photo(s)`);
        if (d.parsed?.hasIndexPage) metaParts.push('Index');
        return metaParts.length > 0 ? `${d.name} (${metaParts.join(', ')})` : d.name;
      })
      .join(', ');

    const persistedUserPrompt = `${params.userPrompt}\n\n[Attached: ${attachmentLabelSummary}]`;

    const guidanceNote =
      `\n\n[Document Navigation Guidance]\n` +
      (directMode
        ? `- The complete extracted text of all attached document(s) is already included above, along with attached visual page scans / embedded photos for this turn. Answer directly by comparing the text and visual details (photos, signatures, stamps, dates, PAN/Aadhaar numbers, schedules, amounts) — only call \`imageInspect\` if you need to inspect a specific saved page image path that was not attached inline.`
        : `- Because the combined attached documents are large (${totalChars} chars), follow the Index / Structure Map first and call \`readDocument\` (with \`documentId\` and \`pages\` or \`section\`), \`searchDocuments\` (scoped with \`documentIds\`), or \`imageInspect\` (on saved photo \`filePath\`s) to inspect exact sections.`);

    return {
      promptText: `${params.userPrompt}\n\n${contextSections.join('\n\n')}${guidanceNote}`,
      persistedUserPrompt,
      mediaAttachments,
      forcedTools: ['readDocument', 'searchDocuments', 'imageInspect'],
      documentIds
    };
  }
}
