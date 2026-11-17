import { Tool, ToolContext } from '../runtime/types.js';
import { WorkflowRegistry } from './registry.js';
import { validateWorkflow } from './validator.js';
import { getActiveWorkflowForSession } from './chatTools.js';
import { WfNode, WorkflowSettings, WorkflowAgentProfile } from './types.js';

export function createAddWorkflowNodeTool(registry: WorkflowRegistry): Tool {
  return {
    definition: {
      name: 'addWorkflowNode',
      description: 'Add a new node to an existing workflow draft. Automatically inserts edges if afterNodeId or beforeNodeId are specified.',
      parameters: {
        type: 'OBJECT',
        properties: {
          workflowId: {
            type: 'STRING',
            description: 'Target workflow id. Defaults to active workflow in conversation if omitted.'
          },
          node: {
            type: 'OBJECT',
            description: 'Full WfNode object to add ({ id, type, prompt, tools, ... })'
          },
          afterNodeId: {
            type: 'STRING',
            description: 'Optional node id to connect from (adds edge [afterNodeId, node.id])'
          },
          beforeNodeId: {
            type: 'STRING',
            description: 'Optional node id to connect to (adds edge [node.id, beforeNodeId])'
          }
        },
        required: ['node']
      }
    },
    execute: async (args: any, ctx?: ToolContext) => {
      const wfId = args.workflowId || getActiveWorkflowForSession(ctx?.sessionId);
      if (!wfId) {
        return { error: 'No workflowId provided and no active workflow is selected in session.' };
      }

      const wf = await registry.get(wfId);
      if (!wf) {
        return { error: `Workflow '${wfId}' not found.` };
      }

      const newNode = args.node as WfNode;
      if (!newNode || !newNode.id || !newNode.type) {
        return { error: 'Invalid node object: id and type are required.' };
      }

      if (wf.nodes.some(n => n.id === newNode.id)) {
        return { error: `Node '${newNode.id}' already exists in workflow '${wfId}'.` };
      }

      wf.nodes.push(newNode);

      if (args.afterNodeId) {
        if (!wf.nodes.some(n => n.id === args.afterNodeId)) {
          return { error: `afterNodeId '${args.afterNodeId}' does not exist in workflow.` };
        }
        wf.edges.push([args.afterNodeId, newNode.id]);
      }

      if (args.beforeNodeId) {
        if (!wf.nodes.some(n => n.id === args.beforeNodeId)) {
          return { error: `beforeNodeId '${args.beforeNodeId}' does not exist in workflow.` };
        }
        wf.edges.push([newNode.id, args.beforeNodeId]);
      }

      const validation = validateWorkflow(wf);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }

      wf.version++;
      await registry.save(wf);

      return {
        success: true,
        workflowId: wf.id,
        version: wf.version,
        addedNodeId: newNode.id,
        message: `Node '${newNode.id}' added to workflow '${wf.id}' v${wf.version}.`
      };
    }
  };
}

export function createRemoveWorkflowNodeTool(registry: WorkflowRegistry): Tool {
  return {
    definition: {
      name: 'removeWorkflowNode',
      description: 'Remove a node and its attached edges from a workflow.',
      parameters: {
        type: 'OBJECT',
        properties: {
          workflowId: {
            type: 'STRING',
            description: 'Target workflow id. Defaults to active workflow if omitted.'
          },
          nodeId: {
            type: 'STRING',
            description: 'ID of node to remove'
          }
        },
        required: ['nodeId']
      }
    },
    execute: async (args: any, ctx?: ToolContext) => {
      const wfId = args.workflowId || getActiveWorkflowForSession(ctx?.sessionId);
      if (!wfId) {
        return { error: 'No workflowId provided and no active workflow is selected.' };
      }

      const wf = await registry.get(wfId);
      if (!wf) {
        return { error: `Workflow '${wfId}' not found.` };
      }

      const nodeIndex = wf.nodes.findIndex(n => n.id === args.nodeId);
      if (nodeIndex === -1) {
        return { error: `Node '${args.nodeId}' does not exist in workflow '${wfId}'.` };
      }

      wf.nodes.splice(nodeIndex, 1);
      wf.edges = wf.edges.filter(([from, to]) => from !== args.nodeId && to !== args.nodeId);

      const validation = validateWorkflow(wf);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }

      wf.version++;
      await registry.save(wf);

      return {
        success: true,
        workflowId: wf.id,
        version: wf.version,
        removedNodeId: args.nodeId,
        message: `Node '${args.nodeId}' removed from workflow '${wf.id}' v${wf.version}.`
      };
    }
  };
}

export function createUpdateWorkflowNodeTool(registry: WorkflowRegistry): Tool {
  return {
    definition: {
      name: 'updateWorkflowNode',
      description: 'Update properties of an existing node (e.g. change prompt, tool list, budget, model).',
      parameters: {
        type: 'OBJECT',
        properties: {
          workflowId: {
            type: 'STRING',
            description: 'Target workflow id. Defaults to active workflow if omitted.'
          },
          nodeId: {
            type: 'STRING',
            description: 'ID of node to update'
          },
          patch: {
            type: 'OBJECT',
            description: 'Fields to merge into the node (e.g. { prompt: "...", tools: [...] })'
          }
        },
        required: ['nodeId', 'patch']
      }
    },
    execute: async (args: any, ctx?: ToolContext) => {
      const wfId = args.workflowId || getActiveWorkflowForSession(ctx?.sessionId);
      if (!wfId) {
        return { error: 'No workflowId provided and no active workflow is selected.' };
      }

      const wf = await registry.get(wfId);
      if (!wf) {
        return { error: `Workflow '${wfId}' not found.` };
      }

      const node = wf.nodes.find(n => n.id === args.nodeId);
      if (!node) {
        return { error: `Node '${args.nodeId}' does not exist in workflow '${wfId}'.` };
      }

      Object.assign(node, args.patch);

      const validation = validateWorkflow(wf);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }

      wf.version++;
      await registry.save(wf);

      return {
        success: true,
        workflowId: wf.id,
        version: wf.version,
        updatedNodeId: args.nodeId,
        message: `Node '${args.nodeId}' updated in workflow '${wf.id}' v${wf.version}.`
      };
    }
  };
}

export function createAddWorkflowEdgeTool(registry: WorkflowRegistry): Tool {
  return {
    definition: {
      name: 'addWorkflowEdge',
      description: 'Add a directional edge between two nodes in a workflow [fromNodeId, toNodeId]. Validates to prevent cycles.',
      parameters: {
        type: 'OBJECT',
        properties: {
          workflowId: {
            type: 'STRING',
            description: 'Target workflow id. Defaults to active workflow if omitted.'
          },
          from: {
            type: 'STRING',
            description: 'Source node id'
          },
          to: {
            type: 'STRING',
            description: 'Target node id'
          }
        },
        required: ['from', 'to']
      }
    },
    execute: async (args: any, ctx?: ToolContext) => {
      const wfId = args.workflowId || getActiveWorkflowForSession(ctx?.sessionId);
      if (!wfId) {
        return { error: 'No workflowId provided and no active workflow is selected.' };
      }

      const wf = await registry.get(wfId);
      if (!wf) {
        return { error: `Workflow '${wfId}' not found.` };
      }

      const edgeExists = wf.edges.some(([f, t]) => f === args.from && t === args.to);
      if (edgeExists) {
        return { error: `Edge from '${args.from}' to '${args.to}' already exists.` };
      }

      wf.edges.push([args.from, args.to]);

      const validation = validateWorkflow(wf);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }

      wf.version++;
      await registry.save(wf);

      return {
        success: true,
        workflowId: wf.id,
        version: wf.version,
        addedEdge: [args.from, args.to]
      };
    }
  };
}

export function createRemoveWorkflowEdgeTool(registry: WorkflowRegistry): Tool {
  return {
    definition: {
      name: 'removeWorkflowEdge',
      description: 'Remove a directional edge between two nodes in a workflow.',
      parameters: {
        type: 'OBJECT',
        properties: {
          workflowId: {
            type: 'STRING',
            description: 'Target workflow id. Defaults to active workflow if omitted.'
          },
          from: {
            type: 'STRING',
            description: 'Source node id'
          },
          to: {
            type: 'STRING',
            description: 'Target node id'
          }
        },
        required: ['from', 'to']
      }
    },
    execute: async (args: any, ctx?: ToolContext) => {
      const wfId = args.workflowId || getActiveWorkflowForSession(ctx?.sessionId);
      if (!wfId) {
        return { error: 'No workflowId provided and no active workflow is selected.' };
      }

      const wf = await registry.get(wfId);
      if (!wf) {
        return { error: `Workflow '${wfId}' not found.` };
      }

      const initialLen = wf.edges.length;
      wf.edges = wf.edges.filter(([f, t]) => !(f === args.from && t === args.to));

      if (wf.edges.length === initialLen) {
        return { error: `Edge [${args.from}, ${args.to}] does not exist.` };
      }

      const validation = validateWorkflow(wf);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }

      wf.version++;
      await registry.save(wf);

      return {
        success: true,
        workflowId: wf.id,
        version: wf.version,
        removedEdge: [args.from, args.to]
      };
    }
  };
}

export function createUpdateWorkflowSettingsTool(registry: WorkflowRegistry): Tool {
  return {
    definition: {
      name: 'updateWorkflowSettings',
      description: 'Update top-level workflow metadata, budgets, settings, or agent profile publishing configurations.',
      parameters: {
        type: 'OBJECT',
        properties: {
          workflowId: {
            type: 'STRING',
            description: 'Target workflow id. Defaults to active workflow if omitted.'
          },
          name: { type: 'STRING', description: 'Updated workflow display name' },
          description: { type: 'STRING', description: 'Updated workflow description' },
          settings: { type: 'OBJECT', description: 'Updated settings (maxCostUsd, maxTimeMs, model, etc.)' },
          agentProfile: { type: 'OBJECT', description: 'Updated agentProfile (systemPrompt, publishAsAgent, etc.)' }
        }
      }
    },
    execute: async (args: any, ctx?: ToolContext) => {
      const wfId = args.workflowId || getActiveWorkflowForSession(ctx?.sessionId);
      if (!wfId) {
        return { error: 'No workflowId provided and no active workflow is selected.' };
      }

      const wf = await registry.get(wfId);
      if (!wf) {
        return { error: `Workflow '${wfId}' not found.` };
      }

      if (args.name) wf.name = args.name;
      if (args.description !== undefined) wf.description = args.description;
      if (args.settings) Object.assign(wf.settings, args.settings);
      if (args.agentProfile) {
        wf.agentProfile = wf.agentProfile
          ? { ...wf.agentProfile, ...args.agentProfile }
          : args.agentProfile;
      }

      const validation = validateWorkflow(wf);
      if (!validation.valid) {
        return { success: false, errors: validation.errors };
      }

      wf.version++;
      await registry.save(wf);

      return {
        success: true,
        workflowId: wf.id,
        version: wf.version,
        message: `Workflow '${wf.id}' settings updated to v${wf.version}.`
      };
    }
  };
}
