import { Tool } from '../runtime/types.js';
import { EpisodicMemory } from '../memory/memory.js';
import { RoutineTriggerType } from '../storage/stores/types.js';

export const routineManageTool: Tool = {
  definition: {
    name: 'routineManage',
    description: 'Manage automated Athena routines (triggers, schedules, event listeners, and standing behaviors).',
    capabilities: ['system'],
    tags: ['routine', 'system', 'learning', 'automation', 'event'],
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['create', 'list', 'trigger', 'enable', 'disable', 'delete', 'get'],
          description: 'The routine action to perform.'
        },
        id: {
          type: 'STRING',
          description: 'Unique routine ID (for get, trigger, enable, disable, delete).'
        },
        name: {
          type: 'STRING',
          description: 'Descriptive routine name.'
        },
        description: {
          type: 'STRING',
          description: 'Description of what this routine does.'
        },
        triggerType: {
          type: 'STRING',
          enum: ['event', 'schedule', 'condition'],
          description: 'How the routine is triggered: "event" (e.g. CI failed), "schedule" (cron), or "condition".'
        },
        triggerConfig: {
          type: 'OBJECT',
          description: 'Configuration for the trigger (e.g. { topic: "ci:failed" } or { cron: "0 9 * * 1-5" }).'
        },
        workflow: {
          type: 'OBJECT',
          description: 'The workflow definition (e.g. { type: "prompt", prompt: "..." } or task sequence).'
        },
        conditions: {
          type: 'ARRAY',
          items: { type: 'OBJECT' },
          description: 'Optional filter conditions before the routine executes.'
        },
        permissions: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Required permissions for the routine.'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: false,
  manifest: {
    name: 'routineManage',
    version: '1.0.0',
    description: 'Manage automated Athena routines and event-driven behaviors',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 15000,
    permissions: ['system'],
    tags: ['routine', 'learning', 'automation']
  },
  execute: async (args: {
    action: 'create' | 'list' | 'trigger' | 'enable' | 'disable' | 'delete' | 'get';
    id?: string;
    name?: string;
    description?: string;
    triggerType?: RoutineTriggerType;
    triggerConfig?: Record<string, any>;
    workflow?: Record<string, any>;
    conditions?: any[];
    permissions?: string[];
  }) => {
    try {
      const memory = EpisodicMemory.getInstance();
      const engine = memory.getRoutineEngine();
      const store = memory.getRoutineStore();
      if (!store) throw new Error('Routine store not initialized.');

      switch (args.action) {
        case 'create': {
          if (!args.name || !args.triggerType) {
            return { success: false, error: 'name and triggerType are required to create a routine.' };
          }
          const id = args.id || `routine_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
          const routine = await engine.registerRoutine({
            id,
            name: args.name,
            description: args.description,
            triggerType: args.triggerType,
            triggerConfig: args.triggerConfig || {},
            workflow: args.workflow || { type: 'prompt', prompt: args.description || args.name },
            conditions: args.conditions,
            permissions: args.permissions,
            enabled: true,
            successRate: 1.0,
            invocations: 0,
            history: []
          });
          return { success: true, message: `Routine "${routine.name}" created with ID: ${routine.id}`, routine };
        }
        case 'list': {
          const list = await store.list();
          return { success: true, count: list.length, routines: list };
        }
        case 'get': {
          if (!args.id) return { success: false, error: 'id required for get.' };
          const routine = await store.get(args.id);
          return { success: Boolean(routine), routine };
        }
        case 'trigger': {
          if (!args.id) return { success: false, error: 'id required for trigger.' };
          const routine = await store.get(args.id);
          if (!routine) return { success: false, error: `Routine ${args.id} not found.` };
          const res = await engine.triggerRoutine(routine);
          return { success: res.success, result: res };
        }
        case 'enable': {
          if (!args.id) return { success: false, error: 'id required for enable.' };
          await engine.enableRoutine(args.id);
          return { success: true, message: `Routine ${args.id} enabled.` };
        }
        case 'disable': {
          if (!args.id) return { success: false, error: 'id required for disable.' };
          await engine.disableRoutine(args.id);
          return { success: true, message: `Routine ${args.id} disabled.` };
        }
        case 'delete': {
          if (!args.id) return { success: false, error: 'id required for delete.' };
          await engine.disableRoutine(args.id);
          const ok = await store.delete(args.id);
          return { success: ok, message: ok ? `Routine ${args.id} deleted.` : `Failed to delete ${args.id}.` };
        }
        default:
          return { success: false, error: `Unknown action: ${(args as any).action}` };
      }
    } catch (err: any) {
      return { success: false, error: `Routine management failed: ${err.message}` };
    }
  }
};

export const workflowLearnTool: Tool = {
  definition: {
    name: 'workflowLearn',
    description: 'Distill successful multi-step executions into reusable Learned Workflows, review them, or promote them to Skills or Routines.',
    capabilities: ['system'],
    tags: ['learning', 'workflow', 'skill', 'routine'],
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['distill', 'review', 'promoteToSkill', 'promoteToRoutine', 'list', 'get'],
          description: 'The workflow action to perform.'
        },
        workflowId: {
          type: 'STRING',
          description: 'Target learned workflow ID.'
        },
        intent: {
          type: 'STRING',
          description: 'High-level user intent behind the distilled workflow.'
        },
        steps: {
          type: 'ARRAY',
          items: { type: 'OBJECT' },
          description: 'The sequence of abstract steps.'
        },
        status: {
          type: 'STRING',
          enum: ['proposed', 'approved', 'active', 'rejected', 'archived'],
          description: 'Review status.'
        },
        reviewNotes: {
          type: 'STRING',
          description: 'Review notes or rationale.'
        },
        promotedName: {
          type: 'STRING',
          description: 'Name when promoting to a Skill or Routine.'
        },
        routineTriggerType: {
          type: 'STRING',
          enum: ['event', 'schedule'],
          description: 'Trigger type when promoting to a Routine.'
        },
        routineTriggerConfig: {
          type: 'OBJECT',
          description: 'Trigger configuration when promoting to a Routine.'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: false,
  manifest: {
    name: 'workflowLearn',
    version: '1.0.0',
    description: 'Distill and manage learned workflows from successful task executions',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 15000,
    permissions: ['system'],
    tags: ['learning', 'workflow']
  },
  execute: async (args: {
    action: 'distill' | 'review' | 'promoteToSkill' | 'promoteToRoutine' | 'list' | 'get';
    workflowId?: string;
    intent?: string;
    steps?: any[];
    status?: any;
    reviewNotes?: string;
    promotedName?: string;
    routineTriggerType?: 'event' | 'schedule';
    routineTriggerConfig?: Record<string, any>;
  }) => {
    try {
      const memory = EpisodicMemory.getInstance();
      const learner = memory.getWorkflowLearner();
      const store = memory.getLearnedWorkflowStore();
      if (!store) throw new Error('Learned workflow store not initialized.');

      switch (args.action) {
        case 'distill': {
          if (!args.intent || !args.steps) {
            return { success: false, error: 'intent and steps are required for distill.' };
          }
          const wf = await learner.distillWorkflow({
            intent: args.intent,
            steps: args.steps
          });
          return { success: true, message: `Workflow distilled with ID: ${wf.id} in state "${wf.status}"`, workflow: wf };
        }
        case 'review': {
          if (!args.workflowId || !args.status) {
            return { success: false, error: 'workflowId and status are required for review.' };
          }
          const updated = await learner.reviewWorkflow(args.workflowId, args.status, {
            notes: args.reviewNotes || 'Reviewed via workflowLearn tool',
            reviewedBy: 'user'
          });
          return { success: true, message: `Workflow ${args.workflowId} updated to status "${args.status}"`, workflow: updated };
        }
        case 'promoteToSkill': {
          if (!args.workflowId || !args.promotedName) {
            return { success: false, error: 'workflowId and promotedName are required for promoteToSkill.' };
          }
          const skill = await learner.promoteToSkill(args.workflowId, args.promotedName);
          return { success: true, message: `Workflow promoted to Skill "${args.promotedName}"`, skill };
        }
        case 'promoteToRoutine': {
          if (!args.workflowId || !args.promotedName || !args.routineTriggerType) {
            return { success: false, error: 'workflowId, promotedName, and routineTriggerType are required.' };
          }
          const routine = await learner.promoteToRoutine(args.workflowId, {
            name: args.promotedName,
            triggerType: args.routineTriggerType,
            triggerConfig: args.routineTriggerConfig || {}
          });
          return { success: true, message: `Workflow promoted to Routine "${args.promotedName}"`, routine };
        }
        case 'list': {
          const list = await store.list();
          return { success: true, count: list.length, workflows: list };
        }
        case 'get': {
          if (!args.workflowId) return { success: false, error: 'workflowId required for get.' };
          const wf = await store.get(args.workflowId);
          return { success: Boolean(wf), workflow: wf };
        }
        default:
          return { success: false, error: `Unknown action: ${(args as any).action}` };
      }
    } catch (err: any) {
      return { success: false, error: `Workflow learning failed: ${err.message}` };
    }
  }
};
