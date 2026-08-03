import { Tool, ToolContext } from '../core/types.js';
import { EpisodicMemory } from '../core/memory.js';

export const semanticMemoryTool: Tool = {
  definition: {
    name: 'semantic_memory_manage',
    description: 'Perform CRUD operations on semantic memory (durable facts and knowledge about the user, profile, or environment). Use this to store information that should persist across sessions.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'The action to perform: "store", "query", or "delete"'
        },
        fact: {
          type: 'STRING',
          description: 'The fact or knowledge to store (required for "store")'
        },
        tags: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Tags indicating categories or topics (for "store")'
        },
        query: {
          type: 'STRING',
          description: 'The search query to match facts against using concept similarity (required for "query")'
        },
        limit: {
          type: 'INTEGER',
          description: 'Max number of facts to return (for "query", default: 3)'
        },
        threshold: {
          type: 'NUMBER',
          description: 'Cosine similarity score threshold between 0.0 and 1.0 (for "query", default: 0.65)'
        },
        id: {
          type: 'INTEGER',
          description: 'ID of the fact to delete (required for "delete")'
        }
      },
      required: ['action']
    }
  },
  execute: async (args: {
    action: 'store' | 'query' | 'delete';
    fact?: string;
    tags?: string[];
    query?: string;
    limit?: number;
    threshold?: number;
    id?: number;
  }, context?: ToolContext) => {
    if (!context || !context.memory) {
      throw new Error('Database memory context is missing.');
    }

    const memory = context.memory as EpisodicMemory;
    const { action, fact, tags, query, limit, threshold, id } = args;

    switch (action) {
      case 'store': {
        if (!fact) {
          throw new Error('Fact is required for store action.');
        }
        const lastId = await memory.saveSemanticFact(fact, tags);
        return { success: true, message: `Fact stored successfully with ID: ${lastId}.`, id: lastId };
      }

      case 'query': {
        if (!query) {
          throw new Error('Query string is required for query action.');
        }
        const facts = await memory.searchSemanticFacts(query, limit ?? 3, threshold ?? 0.65);
        return { success: true, facts };
      }

      case 'delete': {
        if (id === undefined) {
          throw new Error('Fact ID is required for delete action.');
        }
        await memory.deleteSemanticFact(id);
        return { success: true, message: `Fact with ID ${id} deleted successfully.` };
      }

      default:
        throw new Error(`Invalid action: ${action}`);
    }
  }
};
