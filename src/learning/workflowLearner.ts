import {
  LearnedWorkflowRecord,
  LearnedWorkflowStore,
  LearnedWorkflowStatus,
  WorkflowStep
} from '../storage/stores/types.js';
import { ProgressiveSkillManager } from './progressiveSkillManager.js';
import { RoutineEngine } from './routineEngine.js';

export interface WorkflowDistillationInput {
  intent: string;
  sourceRunId?: string;
  steps: {
    toolName: string;
    description?: string;
    parameters?: Record<string, any>;
    resultSummary?: string;
  }[];
  dependencies?: string[];
  requiredPermissions?: string[];
  expectedOutcome?: string;
}

export class WorkflowLearner {
  private workflowStore: LearnedWorkflowStore;
  private skillManager?: ProgressiveSkillManager;
  private routineEngine?: RoutineEngine;

  constructor(
    workflowStore: LearnedWorkflowStore,
    skillManager?: ProgressiveSkillManager,
    routineEngine?: RoutineEngine
  ) {
    this.workflowStore = workflowStore;
    this.skillManager = skillManager;
    this.routineEngine = routineEngine;
  }

  public getStore(): LearnedWorkflowStore {
    return this.workflowStore;
  }

  /**
   * Distills a successful execution into an abstracted, reusable LearnedWorkflow.
   * Hard Rule: NOT raw action recordings or literal session transcripts.
   * Generalizes inputs into parameterizable step templates, extracts conditions and permissions.
   */
  async distillWorkflow(input: WorkflowDistillationInput): Promise<LearnedWorkflowRecord> {
    const id = `lw_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Sanitize and parameterize steps (stripping ephemeral IDs, timestamps, session keys)
    const generalizedSteps: WorkflowStep[] = input.steps.map((raw, idx) => {
      const stepId = `step_${idx + 1}`;
      const action = raw.toolName;
      const description = raw.description || `Execute ${action} operation`;

      // Abstract parameters by removing transient runtime metadata
      const template: Record<string, any> = {};
      if (raw.parameters) {
        for (const [k, v] of Object.entries(raw.parameters)) {
          if (['timestamp', 'runId', 'sessionId', 'idempotencyKey'].includes(k)) continue;
          template[k] = v;
        }
      }

      return {
        stepId,
        action,
        description,
        inputTemplate: Object.keys(template).length > 0 ? template : undefined,
        expectedOutcome: raw.resultSummary || undefined
      };
    });

    const inferredPermissions = new Set<string>(input.requiredPermissions || []);
    for (const s of generalizedSteps) {
      if (s.action.startsWith('fs:') || ['readFile', 'writeFile', 'deleteFile', 'replaceFileContent'].includes(s.action)) {
        inferredPermissions.add('fs');
      }
      if (s.action.startsWith('cmd:') || ['executeCommand', 'processManage'].includes(s.action)) {
        inferredPermissions.add('cmd:exec');
      }
      if (s.action.startsWith('browser') || s.action.includes('Browser')) {
        inferredPermissions.add('browser');
      }
      if (s.action.startsWith('computer') || s.action.includes('Computer')) {
        inferredPermissions.add('computer');
      }
    }

    const workflow: LearnedWorkflowRecord = {
      id,
      intent: input.intent.trim(),
      steps: generalizedSteps,
      dependencies: input.dependencies || [],
      conditions: [{ field: 'intent', operator: 'contains', value: input.intent }],
      requiredPermissions: Array.from(inferredPermissions),
      expectedOutcome: input.expectedOutcome || `Successful execution of ${input.intent}`,
      failureHandling: {
        strategy: 'retry',
        maxRetries: 2,
        notes: 'Review parameters and dependencies if step fails'
      },
      sourceRunId: input.sourceRunId,
      status: 'proposed', // Hard rule: Enters as proposed until reviewed
      successRate: 1.0,
      invocations: 0,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return await this.workflowStore.save(workflow);
  }

  /**
   * Human or agent review gate for learned workflows.
   */
  async reviewWorkflow(
    id: string,
    status: LearnedWorkflowStatus,
    review: { notes: string; reviewedBy: string }
  ): Promise<LearnedWorkflowRecord> {
    await this.workflowStore.updateStatus(id, status, review);
    const updated = await this.workflowStore.get(id);
    if (!updated) throw new Error(`Learned workflow ${id} not found.`);
    return updated;
  }

  /**
   * Promotes an approved learned workflow into a reusable Skill (Spec Section 29 & 31).
   */
  async promoteToSkill(workflowId: string, skillName: string): Promise<any> {
    if (!this.skillManager) throw new Error('SkillManager not configured on WorkflowLearner.');

    const wf = await this.workflowStore.get(workflowId);
    if (!wf) throw new Error(`Learned workflow ${workflowId} not found.`);
    if (wf.status !== 'approved' && wf.status !== 'active') {
      throw new Error(`Cannot promote workflow with status "${wf.status}". Must be approved or active.`);
    }

    // Generate markdown instructions from the distilled workflow steps
    const stepInstructions = wf.steps.map((s, idx) => {
      const paramStr = s.inputTemplate ? ` with inputs: \`${JSON.stringify(s.inputTemplate)}\`` : '';
      return `${idx + 1}. **${s.action}**: ${s.description}${paramStr}`;
    }).join('\n');

    const markdownBody = `# ${skillName}\n\n**Intent:** ${wf.intent}\n\n## Instructions\n${stepInstructions}\n\n## Expected Outcome\n${wf.expectedOutcome || 'Workflow successfully verified.'}\n`;

    const proposedSkill = await this.skillManager.proposeSkill({
      name: skillName,
      description: wf.intent,
      tags: ['learned_workflow', ...wf.dependencies || []],
      content: markdownBody,
      dependencies: wf.dependencies,
      permissions: wf.requiredPermissions
    });

    return proposedSkill;
  }

  /**
   * Promotes an approved learned workflow into a standing Routine (Spec Section 30 & 31).
   */
  async promoteToRoutine(workflowId: string, routineParams: {
    name: string;
    triggerType: 'event' | 'schedule';
    triggerConfig: Record<string, any>;
    conditions?: any[];
  }): Promise<any> {
    if (!this.routineEngine) throw new Error('RoutineEngine not configured on WorkflowLearner.');

    const wf = await this.workflowStore.get(workflowId);
    if (!wf) throw new Error(`Learned workflow ${workflowId} not found.`);
    if (wf.status !== 'approved' && wf.status !== 'active') {
      throw new Error(`Cannot promote workflow with status "${wf.status}". Must be approved or active.`);
    }

    const routine = await this.routineEngine.registerRoutine({
      id: `routine_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      name: routineParams.name,
      description: wf.intent,
      triggerType: routineParams.triggerType,
      triggerConfig: routineParams.triggerConfig,
      workflow: {
        type: 'task_sequence',
        intent: wf.intent,
        steps: wf.steps
      },
      conditions: routineParams.conditions || wf.conditions,
      permissions: wf.requiredPermissions,
      enabled: true,
      successRate: 1.0,
      invocations: 0,
      history: []
    });

    return routine;
  }
}
