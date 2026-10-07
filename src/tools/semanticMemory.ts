import { Tool, ToolContext } from '../runtime/types.js';
import { EpisodicMemory } from '../memory/memory.js';
import { MemoryScope } from '../memory/memoryTypes.js';

export const semanticMemoryTool: Tool = {
  definition: {
    name: 'semantic_memory_manage',
    description: 'Perform scoped memory operations across multiple scopes (global, user, workspace, project, session, task). Supports storing facts with calibrated confidence and provenance evidence, searching, contradicting obsolete knowledge, resolving conflicts, and inspecting durable memory.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'Action to perform: "store", "query", "delete", "inspect", "reinforce", "contradict", "resolve", or "purge".'
        },
        scope: {
          type: 'STRING',
          description: 'Memory scope: "global", "user", "workspace", "project", "agent", "goal", "session", or "task" (defaults to "user").'
        },
        fact: {
          type: 'STRING',
          description: 'The fact or knowledge string (required for "store").'
        },
        tags: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Tags indicating categories or topics (for "store").'
        },
        confidence: {
          type: 'NUMBER',
          description: 'Confidence score between 0.0 and 1.0 (defaults to 1.0 for verified facts).'
        },
        evidence: {
          type: 'STRING',
          description: 'Citation, quote, or file reference proving where this fact was learned from.'
        },
        query: {
          type: 'STRING',
          description: 'Search query for semantic or keyword matching.'
        },
        limit: {
          type: 'INTEGER',
          description: 'Max number of facts to return (default: 5).'
        },
        threshold: {
          type: 'NUMBER',
          description: 'Similarity threshold between 0.0 and 1.0 (default: 0.50).'
        },
        id: {
          type: 'INTEGER',
          description: 'ID of the fact to delete, reinforce, contradict, or resolve.'
        },
        newFact: {
          type: 'STRING',
          description: 'Replacement fact when resolving a contradiction.'
        }
      },
      required: ['action']
    }
  },
  execute: async (args: {
    action: 'store' | 'query' | 'delete' | 'inspect' | 'reinforce' | 'contradict' | 'resolve' | 'purge';
    scope?: MemoryScope;
    fact?: string;
    tags?: string[];
    confidence?: number;
    evidence?: string;
    query?: string;
    limit?: number;
    threshold?: number;
    id?: number;
    newFact?: string;
  }, context?: ToolContext) => {
    if (!context || !context.memory) {
      throw new Error('Database memory context is missing.');
    }

    const memory = context.memory as EpisodicMemory;
    const scope: MemoryScope = args.scope || 'user';
    const sessionId = context.parentRunId || undefined;

    switch (args.action) {
      case 'store': {
        if (!args.fact) {
          throw new Error('Field "fact" is required for "store" action.');
        }

        const res = await memory.writeSecureMemory({
          scope,
          fact: args.fact,
          tags: args.tags,
          confidence: args.confidence,
          provenance: {
            source: 'user_input',
            timestamp: Date.now(),
            runId: context.runId,
            sessionId,
            evidence: args.evidence
          }
        });

        if (res.status === 'quarantined') {
          return {
            success: false,
            quarantined: true,
            id: res.id,
            error: `SECURITY_QUARANTINE: The input was identified as an adversarial prompt injection (${res.quarantineReason}). The fact has been quarantined with confidence 0.0 and will NOT be activated or used.`,
            message: `The memory input violated security policies and was quarantined.`
          };
        }

        return {
          success: true,
          id: res.id,
          scope,
          confidence: res.confidence,
          secretsRedacted: res.secretsRedacted,
          message: `Fact stored successfully in [${scope}] memory with ID: ${res.id}.` + (res.secretsRedacted ? ' (Sensitive credentials were automatically masked).' : '')
        };
      }


      case 'query': {
        if (!args.query) {
          throw new Error('Field "query" is required for "query" action.');
        }

        const facts = await memory.searchScopedMemory({
          query: args.query,
          scope: args.scope,
          limit: args.limit ?? 5,
          threshold: args.threshold ?? 0.50,
          sessionId
        });

        return {
          success: true,
          count: facts.length,
          facts
        };
      }

      case 'inspect': {
        const facts = await memory.inspectMemory(args.query, args.scope, args.limit ?? 20);
        return {
          success: true,
          count: facts.length,
          facts
        };
      }

      case 'reinforce': {
        if (args.id === undefined) {
          throw new Error('Field "id" is required for "reinforce" action.');
        }
        await memory.reinforceMemory(args.id, 0.15);
        return {
          success: true,
          id: args.id,
          message: `Fact ${args.id} reinforced and marked confirmed.`
        };
      }

      case 'contradict': {
        if (args.id === undefined) {
          throw new Error('Field "id" is required for "contradict" action.');
        }
        await memory.contradictMemory(args.id, args.evidence);
        return {
          success: true,
          id: args.id,
          message: `Fact ${args.id} marked contradicted with reduced confidence.`
        };
      }

      case 'resolve': {
        if (args.id === undefined || !args.newFact) {
          throw new Error('Fields "id" and "newFact" are required for "resolve" action.');
        }
        const newId = await memory.resolveContradiction(args.id, args.newFact, {
          source: 'tool_result',
          timestamp: Date.now(),
          runId: context.runId,
          sessionId,
          evidence: args.evidence
        });
        return {
          success: true,
          oldFactId: args.id,
          newFactId: newId,
          message: `Fact ${args.id} superseded by updated fact ${newId}.`
        };
      }

      case 'delete': {
        if (args.id === undefined) {
          throw new Error('Field "id" is required for "delete" action.');
        }
        await memory.deleteScopedMemory(args.id);
        return {
          success: true,
          message: `Fact ${args.id} marked deleted.`
        };
      }

      case 'purge': {
        const deleted = await memory.purgeScope(scope, sessionId);
        return {
          success: true,
          purgedCount: deleted,
          message: `Purged ${deleted} facts from [${scope}] scope.`
        };
      }

      default:
        throw new Error(`Invalid action: "${args.action}". Allowed: store, query, inspect, reinforce, contradict, resolve, delete, purge.`);
    }
  }
};
