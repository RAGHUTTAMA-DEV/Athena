import { Tool, ToolContext } from '../runtime/types.js';
import { EpisodicMemory } from '../memory/memory.js';
import { RagEngine } from '../research/ragPipeline.js';

/**
 * P4B searchDocuments: RAG retrieval over the ingested knowledge base
 * (embed query → vector retrieve → cross-encoder rerank when available).
 * When the reranker is unsupported, the result says so explicitly —
 * it never silently falls back to a lexical "rerank".
 */
export const searchDocumentsTool: Tool = {
  definition: {
    name: 'searchDocuments',
    description:
      'Search the ingested document knowledge base (RAG): embed the query, retrieve the most similar document chunks, and rerank them with a real cross-encoder when available. Returns cited chunks with retrieval and rerank scores.',
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
        namespace: {
          type: 'STRING',
          description: 'Optional vector namespace to restrict the search (default "documents").'
        }
      },
      required: ['query']
    }
  },
  requiresConfirmation: false,
  execute: async (args: { query: string; topK?: number; namespace?: string }, context?: ToolContext) => {
    if (!context || !context.memory) {
      throw new Error('Database memory context is missing.');
    }
    const rag: RagEngine = (context.memory as EpisodicMemory).getRagEngine(args.namespace);

    const result = await rag.query(args.query, { topK: args.topK || 5 });
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
        text: r.text,
        retrievalScore: Number(r.retrievalScore.toFixed(4)),
        rerankScore: r.rerankScore !== undefined ? Number(r.rerankScore.toFixed(4)) : undefined
      }))
    };
  }
};
