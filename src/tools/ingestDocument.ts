import * as fs from 'fs';
import { Tool, ToolContext } from '../runtime/types.js';
import { EpisodicMemory } from '../memory/memory.js';
import { RagEngine } from '../research/ragPipeline.js';
import { detectFormat } from '../research/documentParser.js';

/**
 * P4B ingestDocument: RAG ingest for a local file or URL
 * (parse → chunk → embed → store in the vector store).
 * Identical content is deduplicated; re-ingesting a changed source replaces
 * its previous chunks.
 */
export const ingestDocumentTool: Tool = {
  definition: {
    name: 'ingestDocument',
    description:
      'Ingest a document (PDF, DOCX, XLSX, CSV, HTML, Markdown, plain text, or image via experimental OCR) from a local path or URL into the RAG knowledge base: parse, chunk, embed, and store for later retrieval.',
    capabilities: ['research', 'rag', 'documents'],
    parameters: {
      type: 'OBJECT',
      properties: {
        path: {
          type: 'STRING',
          description: 'Local file path OR URL of the document to ingest.'
        },
        namespace: {
          type: 'STRING',
          description: 'Optional vector namespace (default "documents").'
        }
      },
      required: ['path']
    }
  },
  requiresConfirmation: false,
  execute: async (args: { path: string; namespace?: string }, context?: ToolContext) => {
    if (!context || !context.memory) {
      throw new Error('Database memory context is missing.');
    }
    const rag: RagEngine = (context.memory as EpisodicMemory).getRagEngine(args.namespace);

    if (/^https?:\/\//i.test(args.path)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await fetch(args.path, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const mimeType = response.headers.get('content-type') || undefined;
        const buffer = Buffer.from(await response.arrayBuffer());
        const result = await rag.ingestBuffer(buffer, detectFormat(args.path, mimeType || undefined), args.path, {
          sourceType: 'url'
        });
        return { success: true, ...result };
      } finally {
        clearTimeout(timeout);
      }
    }

    if (!fs.existsSync(args.path)) {
      return { success: false, error: `File not found: ${args.path}` };
    }
    const result = await rag.ingestFile(args.path);
    return { success: true, ...result };
  }
};
