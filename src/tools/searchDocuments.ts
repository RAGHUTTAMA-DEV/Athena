import { Tool, ToolContext } from '../runtime/types.js';
import { EpisodicMemory } from '../memory/memory.js';
import { RagEngine } from '../research/ragPipeline.js';

/**
 * P4B searchDocuments: RAG retrieval over the ingested knowledge base
 * (embed query → vector retrieve → cross-encoder rerank when available),
 * with optional scoping to specific attached `documentId` / `documentIds`.
 */
export const searchDocumentsTool: Tool = {
  definition: {
    name: 'searchDocuments',
    description:
      'Search ingested documents (RAG): embed the query, retrieve matching document chunks (optionally scoped to specific documentIds), and rerank them with a cross-encoder when available. Returns cited chunks with page numbers and sections.',
    capabilities: ['research', 'rag', 'documents'],
    parameters: {
      type: 'OBJECT',
      properties: {
        query: {
          type: 'STRING',
          description: 'The question or topic to search for within ingested documents.'
        },
        topK: {
          type: 'INTEGER',
          description: 'Maximum number of chunks to return (default 5).'
        },
        documentIds: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional list of documentIds to restrict retrieval to (e.g. files attached to this session).'
        },
        namespace: {
          type: 'STRING',
          description: 'Optional vector namespace to restrict the search (default "documents").'
        }
      },
      required: ['query']
    }
  },
  requiresConfirmation: false,
  execute: async (
    args: { query: string; topK?: number; documentIds?: string[]; namespace?: string },
    context?: ToolContext
  ) => {
    if (!context || !context.memory) {
      throw new Error('Database memory context is missing.');
    }
    const rag: RagEngine = (context.memory as EpisodicMemory).getRagEngine(args.namespace);

    const result = await rag.query(args.query, {
      topK: args.topK || 5,
      documentIds: Array.isArray(args.documentIds) && args.documentIds.length > 0 ? args.documentIds : undefined
    });
    return {
      success: true,
      query: result.query,
      reranked: result.reranked,
      rerankerModel: result.rerankerModel,
      rerankSkippedReason: result.rerankSkippedReason,
      count: result.results.length,
      results: result.results.map((r) => ({
        rank: r.rank,
        documentId: r.documentId,
        sourceUri: r.sourceUri,
        pageNumber: r.pageNumber,
        section: r.section,
        text: r.text,
        retrievalScore: Number(r.retrievalScore.toFixed(4)),
        rerankScore: r.rerankScore !== undefined ? Number(r.rerankScore.toFixed(4)) : undefined
      }))
    };
  }
};
