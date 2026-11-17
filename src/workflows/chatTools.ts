import { Tool, ToolContext } from '../runtime/types.js';
import { WorkflowRegistry } from './registry.js';
import { WorkflowExecutor } from './executor.js';
import { validateWorkflow } from './validator.js';
import { EventBus } from '../background/eventBus.js';
import { Workflow } from './types.js';

// In-memory mapping of active workflow per chat session
const activeWorkflowSessions = new Map<string, string>();

export function getActiveWorkflowForSession(sessionId?: string): string | undefined {
  if (!sessionId) return undefined;
  return activeWorkflowSessions.get(sessionId);
}

export function setActiveWorkflowForSession(sessionId: string, workflowId: string): void {
  activeWorkflowSessions.set(sessionId, workflowId);
}

export function clearActiveWorkflowForSession(sessionId: string): void {
  activeWorkflowSessions.delete(sessionId);
}

/**
 * Tool: runWorkflow
 * Executes a saved workflow by ID with supplied inputs.
 */
export function createRunWorkflowTool(registry: WorkflowRegistry, executor: WorkflowExecutor): Tool {
  return {
    definition: {
      name: 'runWorkflow',
      description: 'Run a saved Athena workflow by id. Use when the user asks to execute or run a workflow.',
      parameters: {
        type: 'OBJECT',
        properties: {
          id: {
            type: 'STRING',
            description: 'The unique workflow id (e.g. "research-agent")'
          },
          inputs: {
            type: 'OBJECT',
            description: 'Input arguments matching the workflow input schema'
          }
        },
        required: ['id']
      }
    },
    requiresConfirmation: true,
    execute: async (args: any, ctx?: ToolContext) => {
      const wfId = args.id;
      const wf = await registry.get(wfId);
      if (!wf) {
        return { error: `Workflow '${wfId}' not found in registry.` };
      }

      const parentRunId = ctx?.runId || 'chat';
      const inputs = args.inputs || {};

      try {
        const run = await executor.run(wf, inputs, parentRunId, ctx?.cancellationToken);
        return {
          runId: run.runId,
          workflowId: wf.id,
          version: wf.version,
          status: run.status,
          outputs: run.nodeOutputs,
          error: run.error
        };
      } catch (err: any) {
        return {
          error: `Workflow execution failed: ${err.message || String(err)}`
        };
      }
    }
  };
}

/**
 * Tool: createWorkflow
 * Drafts or saves a new workflow from natural language or explicit definition.
 */
export function createCreateWorkflowTool(registry: WorkflowRegistry): Tool {
  return {
    definition: {
      name: 'createWorkflow',
      description: 'Create and save a new workflow. You can pass a full workflow definition JSON directly, or pass a description to obtain formatting instructions for drafting.',
      parameters: {
        type: 'OBJECT',
        properties: {
          description: {
            type: 'STRING',
            description: 'Natural language description of what the workflow should do'
          },
          definition: {
            type: 'OBJECT',
            description: 'Complete Workflow JSON object (or stringified JSON) to validate and save immediately'
          }
        }
      }
    },
    requiresConfirmation: false,
    execute: async (args: any, ctx?: ToolContext) => {
      let def = args?.definition;
      if (typeof def === 'string') {
        try {
          def = JSON.parse(def);
        } catch {}
      }

      // Check if definition was accidentally passed as description
      if (!def && typeof args?.description === 'string' && args.description.trim().startsWith('{')) {
        try {
          const parsed = JSON.parse(args.description.trim());
          if (parsed && (parsed.nodes || parsed.id)) {
            def = parsed;
          }
        } catch {}
      }

      // If a full definition object was provided, validate and save it directly
      if (def && typeof def === 'object') {
        const wf = def as Workflow;
        const validation = validateWorkflow(wf);
        if (!validation.valid) {
          return {
            success: false,
            errors: validation.errors,
            hint: 'Fix the validation errors and call createWorkflow again.'
          };
        }

        await registry.save(wf);

        if (ctx?.sessionId) {
          setActiveWorkflowForSession(ctx.sessionId, wf.id);
        }

        // Notify UI canvas to open/render the newly created workflow
        EventBus.getInstance().publish(`workflow:open-canvas`, {
          workflowId: wf.id,
          version: wf.version,
          definition: wf
        });

        return {
          success: true,
          workflowId: wf.id,
          version: wf.version,
          message: `Workflow '${wf.name}' (id: ${wf.id}) created and saved successfully. Canvas opened.`
        };
      }

      // Return drafting schema instructions so the agent produces a compliant JSON payload
      return {
        instruction: 'Draft a JSON object matching the Workflow interface. Once formulated, you can pass it to createWorkflow with the "definition" argument, or emit it for the user.',
        schema: {
          id: 'kebab-case-string',
          version: 1,
          name: 'Human readable workflow name',
          description: 'Summary of what this workflow does',
          inputs: {
            fieldName: { type: 'string|number|boolean|object|array', required: true }
          },
          settings: {
            maxCostUsd: 0.5,
            maxTimeMs: 300000,
            model: 'gemini-2.5-flash'
          },
          nodes: [
            '{ id, type: "trigger|agent|orchestrator|collector|tool|condition|map|approval|subWorkflow", ... }'
          ],
          edges: [
            '["sourceNodeId", "targetNodeId"]'
          ]
        },
        descriptionRequested: args.description
      };
    }
  };
}

/**
 * Tool: getWorkflow
 * Retrieves current workflow definition to prevent stale reasoning during chat iterations.
 */
export function createGetWorkflowTool(registry: WorkflowRegistry): Tool {
  return {
    definition: {
      name: 'getWorkflow',
      description: 'Inspect the current state and nodes of a workflow. If id is omitted, the currently active workflow for this conversation is returned.',
      parameters: {
        type: 'OBJECT',
        properties: {
          id: {
            type: 'STRING',
            description: 'Workflow id to look up. If omitted, uses active session workflow.'
          },
          version: {
            type: 'INTEGER',
            description: 'Optional specific version. If omitted, returns latest.'
          }
        }
      }
    },
    execute: async (args: any, ctx?: ToolContext) => {
      const wfId = args?.id || getActiveWorkflowForSession(ctx?.sessionId);
      if (!wfId) {
        return {
          error: 'No workflow id provided and no active workflow is associated with this session.'
        };
      }

      const wf = await registry.get(wfId, args?.version);
      if (!wf) {
        return { error: `Workflow '${wfId}' not found.` };
      }

      return {
        workflow: wf,
        activeInSession: getActiveWorkflowForSession(ctx?.sessionId) === wf.id
      };
    }
  };
}
