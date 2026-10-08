import * as fs from 'fs';
import { Tool, ToolContext } from '../runtime/types.js';
import { EpisodicMemory } from '../memory/memory.js';
import { DocumentParser, detectFormat } from '../research/documentParser.js';
import { RagEngine } from '../research/ragPipeline.js';

/**
 * P4B readDocument: parse and read a document (PDF, DOCX, XLSX, CSV, HTML,
 * Markdown, image via experimental OCR). Large documents are NEVER returned
 * wholesale — above the context budget the tool returns metadata plus a
 * bounded excerpt, and optionally the RAG-retrieved chunks for a focus query.
 */
const DEFAULT_MAX_CONTEXT_CHARS = 8000;

export const readDocumentTool: Tool = {
  definition: {
    name: 'readDocument',
    description:
      'Read and extract text from a document (PDF, DOCX, XLSX, CSV, HTML, Markdown, or image via experimental OCR). Small documents return full text; large documents return a bounded excerpt plus, optionally, retrieval-based chunks for a focus query.',
    capabilities: ['research', 'documents'],
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'Local file path of the document to read.'
        },
        query: {
          type: 'STRING',
          description: 'Optional focus question. For large documents, retrieval selects the most relevant chunks instead of truncating blindly.'
        },
        maxChars: {
          type: 'INTEGER',
          description: 'Optional context budget in characters (default 8000).'
        }
      },
      required: ['path']
    }
  },
  requiresConfirmation: false,
  execute: async (args: { path: string; query?: string; maxChars?: number }, context?: ToolContext) => {
    if (!context || !context.memory) {
      throw new Error('Database memory context is missing.');
    }
    if (!fs.existsSync(args.path)) {
      return { success: false, error: `File not found: ${args.path}` };
    }

    const memory = context.memory as EpisodicMemory;
    const format = detectFormat(args.path);
    const parser = new DocumentParser();
    const maxChars = args.maxChars || DEFAULT_MAX_CONTEXT_CHARS;

    const parsed = await parser.parseFile(args.path);
    const base = {
      format: parsed.format,
      pageCount: parsed.pageCount,
      ocr: parsed.ocr,
      metadata: parsed.metadata
    };

    // Small document: full text within budget.
    if (parsed.text.length <= maxChars) {
      return { success: true, ...base, charCount: parsed.text.length, text: parsed.text, bounded: false };
    }

    // Large document: bounded excerpt + (optional) retrieval-based chunks.
    const excerptChars = Math.min(2000, maxChars);
    let chunks: { rank: number; retrievalScore: number; text: string; rerankScore?: number }[] = [];
    let ragNote: string | undefined;

    if (args.query) {
      try {
        const rag: RagEngine = memory.getRagEngine();
        const result = await rag.query(args.query, { topK: 4 });
        const perChunk = Math.floor((maxChars - excerptChars) / Math.max(result.results.length, 1));
        chunks = result.results.map((r) => ({
          rank: r.rank,
          retrievalScore: Number(r.retrievalScore.toFixed(4)),
          rerankScore: r.rerankScore !== undefined ? Number(r.rerankScore.toFixed(4)) : undefined,
          text: r.text.slice(0, perChunk)
        }));
      } catch (err: any) {
        ragNote = `RAG retrieval unavailable (${err?.message || String(err)}); excerpt only.`;
      }
    }

    return {
      success: true,
      ...base,
      charCount: parsed.text.length,
      bounded: true,
      message: `Document is large (${parsed.text.length} chars); returning a bounded excerpt${args.query ? ' plus retrieval-based chunks for the focus query' : ''}. Use searchDocuments or re-read with a query for targeted content.`,
      excerpt: parsed.text.slice(0, excerptChars),
      retrievedChunks: chunks,
      ragNote
    };
  }
};
