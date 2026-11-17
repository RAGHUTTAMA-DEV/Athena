import { Tool, ToolContext } from '../runtime/types.js';
import { WorkflowRegistry } from './registry.js';
import { WorkflowExecutor } from './executor.js';
import { Workflow } from './types.js';
import { registerDynamicTools, toolsRegistry } from '../tools/index.js';
import { EventBus } from '../background/eventBus.js';

/**
 * Creates a native Tool wrapping a published workflow agent.
 */
export function createWorkflowAgentTool(wf: Workflow, executor: WorkflowExecutor): Tool {
  const toolName = wf.agentProfile?.toolName || `run_${wf.id.replace(/[^a-zA-Z0-9_]/g, '_')}`;
  const paramProperties: Record<string, any> = {};
  const required: string[] = [];

  for (const [k, v] of Object.entries(wf.inputs || {})) {
    paramProperties[k] = {
      type: v.type.toUpperCase(),
      description: v.description || `Parameter ${k}`
    };
    if (v.required) {
      required.push(k);
    }
  }

  return {
    definition: {
      name: toolName,
      description: wf.agentProfile?.description || `Execute the ${wf.name} agent workflow.`,
      parameters: {
        type: 'OBJECT',
        properties: paramProperties,
        required
      }
    },
    requiresConfirmation: false,
    execute: async (args: any, context?: ToolContext) => {
      const parentRunId = context?.runId || 'agent_invocation';
      const run = await executor.run(wf, args || {}, parentRunId, context?.cancellationToken);

      if (run.status === 'failed') {
        throw new Error(`Workflow agent '${wf.id}' failed: ${run.error}`);
      }

      // Return the final non-trigger node's output, or the whole output dict
      const finalNode = wf.nodes.filter(n => n.type !== 'trigger').at(-1);
      const finalOutput = finalNode ? run.nodeOutputs[finalNode.id]?.output : run.nodeOutputs;

      return {
        runId: run.runId,
        status: run.status,
        result: finalOutput,
        allOutputs: run.nodeOutputs
      };
    }
  };
}

/**
 * Discovers all workflows with publishAsAgent: true and registers them as tools.
 * Also subscribes to EventBus to re-register on updates.
 */
export async function registerAllWorkflowAgents(
  registry: WorkflowRegistry,
  executor: WorkflowExecutor
): Promise<string[]> {
  const workflows = await registry.list();
  const registeredToolNames: string[] = [];

  for (const item of workflows) {
    const wf = await registry.get(item.id);
    if (wf && wf.agentProfile?.publishAsAgent) {
      const tool = createWorkflowAgentTool(wf, executor);
      registerDynamicTools([tool]);
      registeredToolNames.push(tool.definition.name);
    }
  }

  // Subscribe to live updates
  EventBus.getInstance().subscribe('workflow:updated:*', async (event) => {
    const wfId = event.payload?.workflowId;
    if (wfId) {
      const updatedWf = await registry.get(wfId);
      if (updatedWf && updatedWf.agentProfile?.publishAsAgent) {
        const tool = createWorkflowAgentTool(updatedWf, executor);
        registerDynamicTools([tool]);
      }
    }
  });

  return registeredToolNames;
}
