import { AgentMailbox } from './agentMailbox.js';
import { DelegationContractEngine } from './delegationContract.js';
import { HandoffPipeline, HandoffStep, SpecializedRole } from './types.js';
import { TaskStore } from '../storage/stores/types.js';

export type StepExecutor = (step: HandoffStep, previousOutput?: any) => Promise<any>;

export class HandoffEngine {
  constructor(
    private mailbox: AgentMailbox,
    private delegationEngine: DelegationContractEngine,
    private taskStore?: TaskStore
  ) {}

  /**
   * Create a standard 3-stage handoff pipeline: Researcher -> Coder -> Reviewer.
   */
  public createStandardHandoffPipeline(params: {
    pipelineId: string;
    goalId?: string;
    taskId?: string;
    researchTask: string;
    codingTask: string;
    reviewTask: string;
  }): HandoffPipeline {
    return {
      pipelineId: params.pipelineId,
      goalId: params.goalId,
      taskId: params.taskId,
      name: 'Researcher -> Coder -> Reviewer Pipeline',
      currentStepIndex: 0,
      status: 'pending',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      steps: [
        {
          stepIndex: 0,
          role: 'researcher',
          instructions: params.researchTask,
          allowedTools: ['researchWeb', 'searchDocuments', 'readDocument', 'ingestDocument'],
          status: 'pending'
        },
        {
          stepIndex: 1,
          role: 'coder',
          instructions: params.codingTask,
          allowedTools: ['readFile', 'writeFile', 'editFile', 'executeCommand', 'searchFiles'],
          status: 'pending'
        },
        {
          stepIndex: 2,
          role: 'reviewer',
          instructions: params.reviewTask,
          allowedTools: ['readFile', 'inspectPath', 'searchFiles', 'readDocument'],
          status: 'pending'
        }
      ]
    };
  }

  /**
   * Execute or continue a multi-agent handoff pipeline.
   * Emits durable 'handoff' messages to the mailbox between steps.
   */
  public async executePipeline(
    pipeline: HandoffPipeline,
    executor: StepExecutor,
    stopAfterStepIndex?: number
  ): Promise<HandoffPipeline> {
    pipeline.status = 'running';
    pipeline.updatedAt = Date.now();

    for (let i = pipeline.currentStepIndex; i < pipeline.steps.length; i++) {
      if (stopAfterStepIndex !== undefined && i > stopAfterStepIndex) {
        // Pause execution (e.g. for simulating crash before next step)
        return pipeline;
      }

      const step = pipeline.steps[i];
      step.status = 'running';

      // Gather previous output from preceding step or mailbox
      let previousOutput: any = undefined;
      if (i > 0) {
        previousOutput = pipeline.steps[i - 1].output;
        if (!previousOutput && pipeline.goalId) {
          // Fallback: look up last handoff message in mailbox
          const messages = await this.mailbox.getGoalMessages(pipeline.goalId);
          const handoffs = messages.filter(m => m.messageType === 'handoff' && m.recipientId === step.role);
          if (handoffs.length > 0) {
            previousOutput = handoffs[handoffs.length - 1].payload;
          }
        }
      }

      try {
        const result = await executor(step, previousOutput);
        step.output = result;
        step.status = 'completed';
        pipeline.currentStepIndex = i + 1;

        // Emit durable handoff message to mailbox
        const nextRole = i + 1 < pipeline.steps.length ? pipeline.steps[i + 1].role : 'lead';
        await this.mailbox.send({
          senderId: `agent_${step.role}`,
          recipientId: `agent_${nextRole}`,
          messageType: 'handoff',
          goalId: pipeline.goalId,
          taskId: pipeline.taskId,
          payload: {
            pipelineId: pipeline.pipelineId,
            stepIndex: i,
            completedRole: step.role,
            nextRole,
            result
          }
        });

        // Update task status in store if available
        if (this.taskStore && pipeline.taskId) {
          const task = await this.taskStore.get(pipeline.taskId);
          if (task) {
            task.result = JSON.stringify({
              currentHandoffStep: i + 1,
              lastCompletedRole: step.role,
              output: result
            });
            await this.taskStore.save(task);
          }
        }
      } catch (err: any) {
        step.status = 'failed';
        step.error = err.message;
        pipeline.status = 'failed';
        pipeline.updatedAt = Date.now();

        await this.mailbox.send({
          senderId: `agent_${step.role}`,
          recipientId: 'lead',
          messageType: 'blocked',
          goalId: pipeline.goalId,
          taskId: pipeline.taskId,
          payload: {
            pipelineId: pipeline.pipelineId,
            stepIndex: i,
            failedRole: step.role,
            error: err.message
          }
        });

        throw err;
      }
    }

    pipeline.status = 'completed';
    pipeline.updatedAt = Date.now();
    return pipeline;
  }

  /**
   * Crash-safe resume: recovers pipeline state from mailbox & task records and continues remaining steps.
   */
  public async resumeFromRestart(
    pipeline: HandoffPipeline,
    executor: StepExecutor
  ): Promise<HandoffPipeline> {
    if (!pipeline.goalId) {
      return await this.executePipeline(pipeline, executor);
    }

    // Inspect durable mailbox for past handoff messages
    const messages = await this.mailbox.getGoalMessages(pipeline.goalId);
    const handoffMessages = messages.filter(m => m.messageType === 'handoff');

    // Reconcile completed steps
    for (const msg of handoffMessages) {
      const payload = typeof msg.payload === 'object' ? msg.payload : JSON.parse(msg.payload as string);
      if (payload.pipelineId === pipeline.pipelineId && typeof payload.stepIndex === 'number') {
        const step = pipeline.steps[payload.stepIndex];
        if (step) {
          step.status = 'completed';
          step.output = payload.result;
          if (pipeline.currentStepIndex <= payload.stepIndex) {
            pipeline.currentStepIndex = payload.stepIndex + 1;
          }
        }
      }
    }

    // Resume execution for pending steps
    return await this.executePipeline(pipeline, executor);
  }
}
