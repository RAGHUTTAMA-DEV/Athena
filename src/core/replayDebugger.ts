import * as fs from 'fs/promises';
import * as path from 'path';
import { EpisodicMemory } from './memory.js';
import { AgentEvent } from './events.js';
import { RunState, RunStatus, RunBudget, RunUsage, StructuredFailure } from './runState.js';

export interface TrajectoryStep {
  stepIndex: number;
  turn: number;
  timestamp: number;
  type: AgentEvent['type'] | 'run_init';
  title: string;
  summary: string;
  details: any;
  durationMs?: number;
  traceId?: string;
  spanId?: string;
}

export interface ToolUsageSummary {
  name: string;
  invocations: number;
  successes: number;
  failures: number;
  totalDurationMs: number;
  avgDurationMs: number;
}

export interface RunTrajectory {
  runId: string;
  parentRunId?: string;
  rootRunId: string;
  sessionId: string;
  task: string;
  status: RunStatus;
  currentTurn: number;
  startTime: number;
  endTime?: number;
  durationMs: number;
  budget: RunBudget;
  usage: RunUsage;
  terminationReason?: string;
  error?: StructuredFailure;
  result?: string;
  steps: TrajectoryStep[];
  toolSummary: ToolUsageSummary[];
  traceId?: string;
}

export interface TrajectorySnapshot {
  stepIndex: number;
  turn: number;
  runStatus: RunStatus;
  planId?: string;
  planGoal?: string;
  activePlanSteps?: Array<{ stepId: string; description: string; status: string }>;
  complexity?: string;
  totalToolCalls: number;
  lastToolCall?: { name: string; args: any };
  lastToolResult?: { name: string; success: boolean; durationMs: number };
  recentThoughts: string[];
}

export interface TrajectoryDiff {
  runIdA: string;
  runIdB: string;
  diverged: boolean;
  divergenceTurn?: number;
  divergenceStepIndex?: number;
  divergenceReason?: string;
  stepCountA: number;
  stepCountB: number;
  durationDeltaMs: number;
  tokenDelta: { input: number; output: number; total: number };
  statusA: RunStatus;
  statusB: RunStatus;
  toolDifferences: {
    inAOnly: string[];
    inBOnly: string[];
    countDeltas: Record<string, number>;
  };
  summary: string;
}

export class TrajectoryReplayer {
  private memory: EpisodicMemory;
  private currentTrajectory: RunTrajectory | null = null;
  private cursorIndex: number = -1;

  constructor(memory: EpisodicMemory) {
    this.memory = memory;
  }

  /**
   * Loads a run and its event log from SQLite, reconstructing the full execution trajectory
   */
  async loadTrajectory(runId: string): Promise<RunTrajectory> {
    const runState = await this.memory.getRunState(runId);
    if (!runState) {
      throw new Error(`Run state not found for runId: "${runId}".`);
    }

    const rawEvents = await this.memory.getRunEvents(runId);
    const steps: TrajectoryStep[] = [];
    const toolStats = new Map<string, { invocations: number; successes: number; failures: number; durationMs: number }>();

    let currentTurn = 0;
    let stepIndex = 0;
    let mainTraceId: string | undefined = undefined;

    // Step 0: Run initialization
    steps.push({
      stepIndex: stepIndex++,
      turn: 0,
      timestamp: runState.createdAt,
      type: 'run_init',
      title: 'Run Initialized',
      summary: `Task: "${runState.task.substring(0, 100)}"`,
      details: {
        budget: runState.budget,
        sessionId: runState.sessionId,
        parentRunId: runState.parentRunId,
        rootRunId: runState.rootRunId
      }
    });

    for (const evt of rawEvents) {
      if (evt.traceId && !mainTraceId) {
        mainTraceId = evt.traceId;
      }

      if (evt.type === 'turn_start') {
        currentTurn = evt.turn;
      }

      let title = evt.type.replace(/_/g, ' ').toUpperCase();
      let summary = '';
      let durationMs: number | undefined = undefined;

      switch (evt.type) {
        case 'status_change':
          summary = `Status transitioned from ${evt.from} → ${evt.to}`;
          break;
        case 'turn_start':
          summary = `Turn ${evt.turn}/${evt.maxTurns} began`;
          break;
        case 'thought':
          summary = evt.text.length > 120 ? `${evt.text.substring(0, 117)}...` : evt.text;
          break;
        case 'tool_call':
          title = `TOOL CALL: ${evt.toolName}`;
          summary = `Arguments: ${JSON.stringify(evt.args)}`;
          const callStat = toolStats.get(evt.toolName) || { invocations: 0, successes: 0, failures: 0, durationMs: 0 };
          callStat.invocations++;
          toolStats.set(evt.toolName, callStat);
          break;
        case 'tool_result':
          title = `TOOL RESULT: ${evt.toolName}`;
          summary = `${evt.success ? 'Success' : 'Failed'} (${evt.durationMs}ms)`;
          durationMs = evt.durationMs;

          // Track tool statistics
          const curr = toolStats.get(evt.toolName) || { invocations: 1, successes: 0, failures: 0, durationMs: 0 };
          if (evt.success) curr.successes++;
          else curr.failures++;
          curr.durationMs += evt.durationMs || 0;
          toolStats.set(evt.toolName, curr);
          break;
        case 'plan_created':
          summary = `Decomposed plan "${evt.goal}" into ${evt.totalSteps} steps`;
          break;
        case 'plan_step_update':
          summary = `Step ${evt.stepId} updated to ${evt.status}`;
          break;
        case 'escalation':
          summary = `Escalated from ${evt.fromComplexity} → ${evt.toComplexity} (${evt.reason})`;
          break;
        case 'verification':
          summary = evt.passed ? 'Verification passed' : `Verification flagged issues: ${evt.issues?.join(', ')}`;
          break;
        case 'repair_attempt':
          summary = `Repair attempt ${evt.attempt}/${evt.maxAttempts}: ${evt.repairAction}`;
          break;
        case 'budget_warning':
          summary = `Resource ${evt.resource} reached ${evt.percentageUsed}% of limit`;
          break;
        case 'error':
          summary = `Error: ${evt.failure?.message || 'Structured failure recorded'}`;
          break;
        case 'completed':
          summary = `Completed with termination reason: ${evt.terminationReason}`;
          break;
        default:
          summary = JSON.stringify(evt);
      }

      steps.push({
        stepIndex: stepIndex++,
        turn: currentTurn,
        timestamp: evt.timestamp,
        type: evt.type,
        title,
        summary,
        details: evt,
        durationMs,
        traceId: evt.traceId,
        spanId: evt.spanId
      });
    }

    const toolSummary: ToolUsageSummary[] = Array.from(toolStats.entries()).map(([name, stat]) => ({
      name,
      invocations: stat.invocations,
      successes: stat.successes,
      failures: stat.failures,
      totalDurationMs: stat.durationMs,
      avgDurationMs: stat.invocations > 0 ? Math.round(stat.durationMs / stat.invocations) : 0
    }));

    const durationMs = (runState.updatedAt || Date.now()) - runState.createdAt;

    this.currentTrajectory = {
      runId: runState.runId,
      parentRunId: runState.parentRunId,
      rootRunId: runState.rootRunId,
      sessionId: runState.sessionId,
      task: runState.task,
      status: runState.status,
      currentTurn: runState.currentTurn,
      startTime: runState.createdAt,
      endTime: runState.status === 'completed' || runState.status === 'failed' || runState.status === 'cancelled'
        ? runState.updatedAt
        : undefined,
      durationMs,
      budget: runState.budget,
      usage: runState.usage,
      terminationReason: runState.terminationReason,
      error: runState.error,
      result: runState.result,
      steps,
      toolSummary,
      traceId: mainTraceId
    };

    this.cursorIndex = 0;
    return this.currentTrajectory;
  }

  getTrajectory(): RunTrajectory | null {
    return this.currentTrajectory;
  }

  // --- Step-by-Step Navigation ---

  getCursor(): number {
    return this.cursorIndex;
  }

  stepNext(): TrajectoryStep | null {
    if (!this.currentTrajectory) return null;
    if (this.cursorIndex < this.currentTrajectory.steps.length - 1) {
      this.cursorIndex++;
      return this.currentTrajectory.steps[this.cursorIndex];
    }
    return null;
  }

  stepPrev(): TrajectoryStep | null {
    if (!this.currentTrajectory) return null;
    if (this.cursorIndex > 0) {
      this.cursorIndex--;
      return this.currentTrajectory.steps[this.cursorIndex];
    }
    return null;
  }

  seekTo(stepIndex: number): TrajectoryStep | null {
    if (!this.currentTrajectory) return null;
    if (stepIndex >= 0 && stepIndex < this.currentTrajectory.steps.length) {
      this.cursorIndex = stepIndex;
      return this.currentTrajectory.steps[this.cursorIndex];
    }
    return null;
  }

  seekToTurn(turn: number): TrajectoryStep | null {
    if (!this.currentTrajectory) return null;
    const index = this.currentTrajectory.steps.findIndex(s => s.turn === turn);
    if (index !== -1) {
      this.cursorIndex = index;
      return this.currentTrajectory.steps[this.cursorIndex];
    }
    return null;
  }

  getCurrentStep(): TrajectoryStep | null {
    if (!this.currentTrajectory || this.cursorIndex < 0 || this.cursorIndex >= this.currentTrajectory.steps.length) {
      return null;
    }
    return this.currentTrajectory.steps[this.cursorIndex];
  }

  /**
   * Inspects execution state snapshot up to the specified stepIndex
   */
  getSnapshot(stepIndex?: number): TrajectorySnapshot {
    if (!this.currentTrajectory) {
      throw new Error('No trajectory loaded.');
    }

    const targetIndex = stepIndex !== undefined ? stepIndex : this.cursorIndex;
    const sliced = this.currentTrajectory.steps.slice(0, targetIndex + 1);

    let planId: string | undefined;
    let planGoal: string | undefined;
    const planStepsMap = new Map<string, { stepId: string; description: string; status: string }>();
    let complexity: string | undefined;
    let totalToolCalls = 0;
    let lastToolCall: { name: string; args: any } | undefined;
    let lastToolResult: { name: string; success: boolean; durationMs: number } | undefined;
    const recentThoughts: string[] = [];
    let runStatus: RunStatus = 'queued';
    let currentTurn = 0;

    for (const step of sliced) {
      currentTurn = step.turn;
      if (step.type === 'status_change') {
        runStatus = step.details.to;
      } else if (step.type === 'plan_created') {
        planId = step.details.planId;
        planGoal = step.details.goal;
        for (const st of step.details.steps || []) {
          planStepsMap.set(st.stepId, { stepId: st.stepId, description: st.description, status: 'pending' });
        }
      } else if (step.type === 'plan_step_update') {
        const existing = planStepsMap.get(step.details.stepId);
        if (existing) {
          existing.status = step.details.status;
        }
      } else if (step.type === 'escalation') {
        complexity = step.details.toComplexity;
      } else if (step.type === 'tool_call') {
        totalToolCalls++;
        lastToolCall = { name: step.details.toolName, args: step.details.args };
      } else if (step.type === 'tool_result') {
        lastToolResult = { name: step.details.toolName, success: step.details.success, durationMs: step.details.durationMs };
      } else if (step.type === 'thought') {
        recentThoughts.push(step.details.text);
        if (recentThoughts.length > 5) recentThoughts.shift();
      }
    }

    return {
      stepIndex: targetIndex,
      turn: currentTurn,
      runStatus,
      planId,
      planGoal,
      activePlanSteps: Array.from(planStepsMap.values()),
      complexity,
      totalToolCalls,
      lastToolCall,
      lastToolResult,
      recentThoughts
    };
  }

  // --- Trajectory Diffing & Divergence Analysis ---

  static diffTrajectories(a: RunTrajectory, b: RunTrajectory): TrajectoryDiff {
    const minSteps = Math.min(a.steps.length, b.steps.length);
    let diverged = false;
    let divergenceTurn: number | undefined;
    let divergenceStepIndex: number | undefined;
    let divergenceReason: string | undefined;

    for (let i = 0; i < minSteps; i++) {
      const stepA = a.steps[i];
      const stepB = b.steps[i];

      if (stepA.type !== stepB.type) {
        diverged = true;
        divergenceStepIndex = i;
        divergenceTurn = Math.max(stepA.turn, stepB.turn);
        divergenceReason = `Step types diverged at step ${i} (Turn ${divergenceTurn}): "${stepA.type}" vs "${stepB.type}".`;
        break;
      }

      if (stepA.type === 'tool_call') {
        const nameA = stepA.details.toolName;
        const nameB = stepB.details.toolName;
        if (nameA !== nameB) {
          diverged = true;
          divergenceStepIndex = i;
          divergenceTurn = stepA.turn;
          divergenceReason = `Tool called diverged at Turn ${stepA.turn}: "${nameA}" vs "${nameB}".`;
          break;
        }

        const argsA = JSON.stringify(stepA.details.args || {});
        const argsB = JSON.stringify(stepB.details.args || {});
        if (argsA !== argsB) {
          diverged = true;
          divergenceStepIndex = i;
          divergenceTurn = stepA.turn;
          divergenceReason = `Tool arguments for "${nameA}" diverged at Turn ${stepA.turn}.`;
          break;
        }
      }

      if (stepA.type === 'tool_result' && stepA.details.success !== stepB.details.success) {
        diverged = true;
        divergenceStepIndex = i;
        divergenceTurn = stepA.turn;
        divergenceReason = `Tool "${stepA.details.toolName}" outcome diverged at Turn ${stepA.turn}: ` +
          `A=${stepA.details.success ? 'success' : 'failure'}, B=${stepB.details.success ? 'success' : 'failure'}.`;
        break;
      }
    }

    if (!diverged && a.steps.length !== b.steps.length) {
      diverged = true;
      divergenceStepIndex = minSteps;
      const longerRun = a.steps.length > b.steps.length ? a : b;
      divergenceTurn = longerRun.steps[minSteps]?.turn || minSteps;
      divergenceReason = `Execution length diverged: Run A took ${a.steps.length} steps, while Run B took ${b.steps.length} steps.`;
    }

    // Tool inventory differences
    const toolsA = new Map(a.toolSummary.map(t => [t.name, t.invocations]));
    const toolsB = new Map(b.toolSummary.map(t => [t.name, t.invocations]));

    const allToolNames = new Set([...toolsA.keys(), ...toolsB.keys()]);
    const inAOnly: string[] = [];
    const inBOnly: string[] = [];
    const countDeltas: Record<string, number> = {};

    for (const name of allToolNames) {
      const cntA = toolsA.get(name) || 0;
      const cntB = toolsB.get(name) || 0;
      if (cntA > 0 && cntB === 0) inAOnly.push(name);
      else if (cntB > 0 && cntA === 0) inBOnly.push(name);
      countDeltas[name] = cntB - cntA;
    }

    const durationDeltaMs = b.durationMs - a.durationMs;
    const tokenDelta = {
      input: (b.usage?.tokens?.input || 0) - (a.usage?.tokens?.input || 0),
      output: (b.usage?.tokens?.output || 0) - (a.usage?.tokens?.output || 0),
      total: (b.usage?.tokens?.total || 0) - (a.usage?.tokens?.total || 0)
    };

    let summary = '';
    if (!diverged) {
      summary = `Trajectories are identical across ${minSteps} steps. Both concluded with status "${a.status}".`;
    } else {
      summary = `Divergence identified at Turn ${divergenceTurn ?? 'N/A'} (Step ${divergenceStepIndex}): ${divergenceReason}`;
    }

    return {
      runIdA: a.runId,
      runIdB: b.runId,
      diverged,
      divergenceTurn,
      divergenceStepIndex,
      divergenceReason,
      stepCountA: a.steps.length,
      stepCountB: b.steps.length,
      durationDeltaMs,
      tokenDelta,
      statusA: a.status,
      statusB: b.status,
      toolDifferences: {
        inAOnly,
        inBOnly,
        countDeltas
      },
      summary
    };
  }

  // --- Exporting & Post-Mortem Reporting ---

  exportMarkdown(options?: { includeFullPayloads?: boolean }): string {
    if (!this.currentTrajectory) {
      throw new Error('No trajectory loaded to export.');
    }

    const t = this.currentTrajectory;
    const dateStr = new Date(t.startTime).toISOString();
    const durationSec = (t.durationMs / 1000).toFixed(2);
    const tokens = t.usage?.tokens || { input: 0, output: 0, total: 0 };

    let md = `# Athena Run Trajectory Report\n\n`;
    md += `> [!NOTE]\n`;
    md += `> Authoritative execution post-mortem for Run \`${t.runId}\`.\n\n`;

    md += `## Overview\n\n`;
    md += `| Field | Value |\n`;
    md += `|---|---|\n`;
    md += `| **Run ID** | \`${t.runId}\` |\n`;
    if (t.parentRunId) md += `| **Parent Run** | \`${t.parentRunId}\` |\n`;
    md += `| **Root Run** | \`${t.rootRunId}\` |\n`;
    md += `| **Session ID** | \`${t.sessionId}\` |\n`;
    if (t.traceId) md += `| **Trace ID** | \`${t.traceId}\` |\n`;
    md += `| **Status** | **\`${t.status.toUpperCase()}\`** |\n`;
    md += `| **Turns** | ${t.currentTurn} / ${t.budget?.maxTurns || 'unlimited'} |\n`;
    md += `| **Duration** | ${durationSec}s |\n`;
    md += `| **Tokens** | ${tokens.total.toLocaleString()} (in: ${tokens.input.toLocaleString()}, out: ${tokens.output.toLocaleString()}) |\n`;
    md += `| **Started At** | ${dateStr} |\n\n`;

    md += `### Goal / Task\n\`\`\`\n${t.task}\n\`\`\`\n\n`;

    if (t.terminationReason) {
      md += `> [!IMPORTANT]\n> Termination Reason: **${t.terminationReason}**\n\n`;
    }

    if (t.error) {
      md += `> [!CAUTION]\n> Failure Encountered: \`${t.error.code}\`\n> Message: ${t.error.message}\n\n`;
    }

    if (t.result) {
      md += `### Final Output\n\`\`\`\n${t.result}\n\`\`\`\n\n`;
    }

    // Tool Summary Table
    md += `## Tool Usage Summary\n\n`;
    if (t.toolSummary.length === 0) {
      md += `_No tools were invoked during this run._\n\n`;
    } else {
      md += `| Tool | Calls | Success | Failures | Total Latency | Avg Latency |\n`;
      md += `|---|---|---|---|---|---|\n`;
      for (const ts of t.toolSummary) {
        md += `| \`${ts.name}\` | ${ts.invocations} | ${ts.successes} | ${ts.failures} | ${ts.totalDurationMs}ms | ${ts.avgDurationMs}ms |\n`;
      }
      md += `\n`;
    }

    // Step-by-Step Chronology
    md += `## Execution Timeline (${t.steps.length} steps)\n\n`;
    for (const step of t.steps) {
      const timeOffset = ((step.timestamp - t.startTime) / 1000).toFixed(2);
      md += `#### Step ${step.stepIndex} (+${timeOffset}s) [Turn ${step.turn}] - ${step.title}\n`;
      md += `${step.summary}\n\n`;

      if (options?.includeFullPayloads && step.details) {
        md += `<details><summary>Payload</summary>\n\n\`\`\`json\n${JSON.stringify(step.details, null, 2)}\n\`\`\`\n</details>\n\n`;
      }
    }

    return md;
  }

  exportJson(): string {
    if (!this.currentTrajectory) {
      throw new Error('No trajectory loaded to export.');
    }
    return JSON.stringify(this.currentTrajectory, null, 2);
  }

  async exportToFile(filePath: string, format: 'markdown' | 'json' = 'markdown'): Promise<string> {
    const resolvedPath = path.resolve(filePath);
    const content = format === 'markdown' ? this.exportMarkdown() : this.exportJson();
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await fs.writeFile(resolvedPath, content, 'utf8');
    return resolvedPath;
  }
}
