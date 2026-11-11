import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolContext } from '../runtime/types.js';
import { EpisodicMemory } from '../memory/memory.js';
import { DocumentParser } from '../research/documentParser.js';
import { ParsedDocument } from '../research/researchTypes.js';
import { RagEngine } from '../research/ragPipeline.js';

/**
 * Intelligent Document Reader (Index-first, Page-targeted, & Photo-aware).
 *
 * Supports reading by `documentId` or `path`, loading cached sidecar parses
 * (including page classifications, embedded photo paths/captions, and Index/TOC
 * structure), targeting specific `pages` or a named `section` from the Index,
 * returning only the structural `outlineOnly` map, or retrieving scoped RAG chunks.
 */
const DEFAULT_MAX_CONTEXT_CHARS = 28000;

function compactMediaList(assets?: ParsedDocument['mediaAssets']) {
  if (!assets || assets.length === 0) return [];
  return assets.map((m) => ({
    id: m.id,
    pageNumber: m.pageNumber,
    filePath: m.filePath,
    mimeType: m.mimeType,
    kind: m.kind,
    caption: m.caption ? m.caption.slice(0, 180).replace(/\s+/g, ' ') : undefined
  }));
}

function parsePageRange(spec: string, totalPages?: number): number[] {
  const result = new Set<number>();
  for (const part of spec.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d+)\s*[-–]\s*(\d+)$/);
    if (range) {
      let start = parseInt(range[1], 10);
      let end = parseInt(range[2], 10);
      if (start > end) [start, end] = [end, start];
      const maxEnd = totalPages ? Math.min(end, totalPages) : end;
      for (let p = Math.max(1, start); p <= maxEnd && result.size < 25; p++) {
        result.add(p);
      }
      continue;
    }
    const single = parseInt(trimmed, 10);
    if (!isNaN(single) && single >= 1 && (!totalPages || single <= totalPages)) {
      result.add(single);
    }
  }
  return Array.from(result).sort((a, b) => a - b);
}

async function tryLoadSidecar(sidecarPath?: string): Promise<ParsedDocument | null> {
  if (!sidecarPath || !fs.existsSync(sidecarPath)) return null;
  try {
    const raw = await fs.promises.readFile(sidecarPath, 'utf-8');
    return JSON.parse(raw) as ParsedDocument;
  } catch {
    return null;
  }
}

export const readDocumentTool: Tool = {
  definition: {
    name: 'readDocument',
    description:
      'Intelligently read a document (PDF, DOCX, XLSX, CSV, HTML, Markdown, or image). Supports jumping straight to specific pages or an Index/TOC section, inspecting the Document Outline & Photo/Media Map first (outlineOnly=true), or querying RAG chunks for large documents.',
    capabilities: ['research', 'documents'],
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'Local file path of the document to read.'
        },
        documentId: {
          type: 'STRING',
          description: 'Ingested documentId (from an uploaded attachment or searchDocuments).'
        },
        pages: {
          type: 'STRING',
          description: 'Optional page numbers or range to read directly (e.g. "1", "2,4-6"). Use the Index/Page Map first to choose relevant pages.'
        },
        section: {
          type: 'STRING',
          description: 'Optional section or heading title from the document Index / Table of Contents to jump directly to.'
        },
        outlineOnly: {
          type: 'BOOLEAN',
          description: 'If true, returns only the Document Index / Table of Contents, per-page layout types (text vs mixed vs scanned), and extracted photo/media locations.'
        },
        query: {
          type: 'STRING',
          description: 'Optional focus question. For large documents, retrieves the most relevant chunks scoped to this document.'
        },
        maxChars: {
          type: 'INTEGER',
          description: 'Optional context budget in characters (default 12000).'
        }
      }
    }
  },
  requiresConfirmation: false,
  execute: async (
    args: {
      path?: string;
      documentId?: string;
      pages?: string;
      section?: string;
      outlineOnly?: boolean;
      query?: string;
      maxChars?: number;
    },
    context?: ToolContext
  ) => {
    if (!context || !context.memory) {
      throw new Error('Database memory context is missing.');
    }

    const memory = context.memory as EpisodicMemory;
    const docStore = typeof (memory as any).getResearchDocumentStore === 'function'
      ? (memory as any).getResearchDocumentStore()
      : null;
    let targetPath = args.path;
    let docRecord = args.documentId && docStore ? await docStore.get(args.documentId) : null;

    if (!docRecord && targetPath && docStore) {
      docRecord = await docStore.findBySourceUri(targetPath);
    }
    if (!targetPath && docRecord?.sourceUri && fs.existsSync(docRecord.sourceUri)) {
      targetPath = docRecord.sourceUri;
    }

    if (!targetPath && !docRecord) {
      return { success: false, error: 'Either path or a valid documentId must be provided.' };
    }
    if (targetPath && !fs.existsSync(targetPath) && !docRecord?.metadata?.sidecarPath) {
      return { success: false, error: `File not found: ${targetPath}` };
    }

    const maxChars = args.maxChars || DEFAULT_MAX_CONTEXT_CHARS;
    const parser = new DocumentParser();

    let parsed: ParsedDocument | null = await tryLoadSidecar(docRecord?.metadata?.sidecarPath);
    if (!parsed && targetPath) {
      parsed = await tryLoadSidecar(`${targetPath}.parsed.json`);
    }
    if (!parsed && targetPath) {
      const assetDir = `${targetPath}.assets`;
      parsed = await parser.parseFile(targetPath, { assetDir });
    }
    if (!parsed) {
      return { success: false, error: 'Document content could not be resolved from file or cache.' };
    }

    const base = {
      documentId: docRecord?.id,
      path: targetPath || docRecord?.sourceUri,
      format: parsed.format,
      pageCount: parsed.pageCount,
      ocr: parsed.ocr,
      hasIndexPage: parsed.hasIndexPage,
      indexPages: parsed.indexPages,
      mediaCount: parsed.mediaAssets?.length || 0
    };

    // 1. Structural Index / Outline Map only
    if (args.outlineOnly) {
      return {
        success: true,
        ...base,
        outlineSummary: parsed.outlineSummary,
        indexEntries: parsed.indexEntries || [],
        mediaAssets: compactMediaList(parsed.mediaAssets),
        pages: parsed.pages?.map((p) => ({
          pageNumber: p.pageNumber,
          kind: p.kind,
          charCount: p.charCount,
          imageCount: p.imageCount,
          isIndexPage: p.isIndexPage,
          headings: p.headings,
          screenshotPath: p.screenshotPath
        }))
      };
    }

    // 2. Targeted section jump via Index / TOC
    let targetPageNums: number[] = [];
    if (args.pages) {
      targetPageNums = parsePageRange(args.pages, parsed.pageCount);
    } else if (args.section && parsed.indexEntries && parsed.indexEntries.length > 0) {
      const needle = args.section.toLowerCase();
      const idx = parsed.indexEntries.findIndex((e) => e.title.toLowerCase().includes(needle));
      if (idx >= 0) {
        const matched = parsed.indexEntries[idx];
        if (matched.pageStart) {
          const nextWithPage = parsed.indexEntries
            .slice(idx + 1)
            .find((e) => e.pageStart && e.pageStart > matched.pageStart!);
          const endPage = matched.pageEnd || (nextWithPage?.pageStart ? nextWithPage.pageStart - 1 : matched.pageStart + 2);
          targetPageNums = parsePageRange(`${matched.pageStart}-${Math.min(endPage, matched.pageStart + 5)}`, parsed.pageCount);
        }
      }
    }

    if (targetPageNums.length > 0 && parsed.pages && parsed.pages.length > 0) {
      const selectedPages = parsed.pages.filter((p) => targetPageNums.includes(p.pageNumber));
      const combinedText = selectedPages
        .map((p) => `=== Page ${p.pageNumber} (${p.kind}, photos=${p.imageCount}) ===\n${p.text}`)
        .join('\n\n')
        .slice(0, maxChars);

      const pageMedia = compactMediaList(
        (parsed.mediaAssets || []).filter((m) => m.pageNumber && targetPageNums.includes(m.pageNumber))
      );

      return {
        success: true,
        ...base,
        requestedPages: targetPageNums,
        text: combinedText,
        mediaAssetsOnPages: pageMedia,
        tip: pageMedia.length > 0
          ? 'Pages include visual/photo assets; call imageInspect on any filePath if deeper visual inspection is needed.'
          : undefined
      };
    }

    // If section was requested on a non-paginated doc (e.g. DOCX/Markdown), find matching heading slice
    if (args.section) {
      const idx = parsed.text.toLowerCase().indexOf(args.section.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 200);
        return {
          success: true,
          ...base,
          section: args.section,
          text: parsed.text.slice(start, start + maxChars),
          mediaAssets: compactMediaList(parsed.mediaAssets)
        };
      }
    }

    // 3. Small/medium document: full text + compact media assets within budget
    if (parsed.text.length <= maxChars) {
      return {
        success: true,
        ...base,
        charCount: parsed.text.length,
        text: parsed.text,
        mediaAssets: compactMediaList(parsed.mediaAssets),
        bounded: false
      };
    }

    // 4. Large document: Index / TOC first + Index page text + scoped RAG chunks
    const indexExcerpts: string[] = [];
    if (parsed.pages && parsed.indexPages && parsed.indexPages.length > 0) {
      for (const ip of parsed.indexPages.slice(0, 3)) {
        const p = parsed.pages.find((pg) => pg.pageNumber === ip);
        if (p) indexExcerpts.push(`=== Index Page ${p.pageNumber} ===\n${p.text}`);
      }
    }

    const excerptChars = Math.min(2500, maxChars);
    let chunks: { rank: number; pageNumber?: number; section?: string; retrievalScore: number; text: string; rerankScore?: number }[] = [];
    let ragNote: string | undefined;

    if (args.query) {
      try {
        const rag: RagEngine = memory.getRagEngine();
        const result = await rag.query(args.query, {
          topK: 5,
          documentIds: docRecord ? [docRecord.id] : undefined
        });
        const perChunk = Math.floor((maxChars - excerptChars) / Math.max(result.results.length, 1));
        chunks = result.results.map((r) => ({
          rank: r.rank,
          pageNumber: r.pageNumber,
          section: r.section,
          retrievalScore: Number(r.retrievalScore.toFixed(4)),
          rerankScore: r.rerankScore !== undefined ? Number(r.rerankScore.toFixed(4)) : undefined,
          text: r.text.slice(0, perChunk)
        }));
      } catch (err: any) {
        ragNote = `RAG retrieval unavailable (${err?.message || String(err)}); use pages/section targeting from the Index.`;
      }
    }

    return {
      success: true,
      ...base,
      charCount: parsed.text.length,
      bounded: true,
      message:
        `Large document (${parsed.text.length} chars, ${parsed.pageCount || '?'} pages). ` +
        `Check outlineSummary / indexEntries first, then call readDocument with specific "pages" or "section" (or searchDocuments) to inspect relevant parts.`,
      outlineSummary: parsed.outlineSummary,
      indexEntries: parsed.indexEntries?.slice(0, 50),
      indexPageContent: indexExcerpts.length > 0 ? indexExcerpts.join('\n\n').slice(0, 4000) : undefined,
      excerpt: parsed.text.slice(0, excerptChars),
      mediaAssets: compactMediaList(parsed.mediaAssets?.slice(0, 15)),
      retrievedChunks: chunks,
      ragNote
    };
  }
};
