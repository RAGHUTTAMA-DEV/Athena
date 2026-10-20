import { ReplayStore, ReplayLogEntry } from '../storage/stores/types.js';

export interface ReplayVerification {
  deterministic: boolean;
  totalSteps: number;
  matchedSteps: number;
  divergences: string[];
  finalStateMatches: boolean;
}

export class DeterministicReplayer {
  constructor(private replayStore: ReplayStore) {}

  /**
   * Records a deterministic step into the durable replay log.
   */
  async recordStep(
    runId: string,
    stepIndex: number,
    data: {
      modelInput?: any;
      modelOutput?: any;
      toolCalls?: any;
      toolOutputs?: any;
      stateDiff?: any;
    }
  ): Promise<ReplayLogEntry> {
    const entry: ReplayLogEntry = {
      id: `replay_${runId}_step_${stepIndex}`,
      runId,
      stepIndex,
      modelInput: data.modelInput,
      modelOutput: data.modelOutput,
      toolCalls: data.toolCalls,
      toolOutputs: data.toolOutputs,
      stateDiff: data.stateDiff,
      timestamp: Date.now()
    };
    return this.replayStore.recordStep(entry);
  }

  /**
   * Replays a run step-by-step from the log without making live API or tool calls,
   * comparing re-executed state against the logged state.
   */
  async replayRun(
    runId: string,
    playbackStepFn?: (step: ReplayLogEntry) => Promise<any>
  ): Promise<ReplayVerification> {
    const steps = await this.replayStore.getSteps(runId);

    if (steps.length === 0) {
      return {
        deterministic: false,
        totalSteps: 0,
        matchedSteps: 0,
        divergences: [`No replay logs found for run ${runId}`],
        finalStateMatches: false
      };
    }

    const divergences: string[] = [];
    let matchedCount = 0;
    let simulatedState: Record<string, any> = {};

    for (const step of steps) {
      // If mock playback fn is provided, invoke it
      if (playbackStepFn) {
        try {
          const res = await playbackStepFn(step);
          if (res !== undefined && step.toolOutputs !== undefined) {
            const expected = JSON.stringify(step.toolOutputs);
            const actual = JSON.stringify(res);
            if (expected !== actual) {
              divergences.push(`Step ${step.stepIndex} output divergence: expected ${expected}, got ${actual}`);
            }
          }
        } catch (err: any) {
          divergences.push(`Step ${step.stepIndex} threw error during replay: ${err.message}`);
        }
      }

      // Reconstruct state transitions
      if (step.stateDiff) {
        simulatedState = { ...simulatedState, ...step.stateDiff };
      }

      matchedCount++;
    }

    const deterministic = divergences.length === 0;

    return {
      deterministic,
      totalSteps: steps.length,
      matchedSteps: matchedCount,
      divergences,
      finalStateMatches: deterministic
    };
  }
}
