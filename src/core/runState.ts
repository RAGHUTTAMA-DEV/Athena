export type RunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TerminationReason =
  | 'goal_achieved'
  | 'max_turns'
  | 'budget_exceeded'
  | 'user_cancelled'
  | 'unrecoverable_error'
  | 'timeout';

export type FailureCategory =
  | 'timeout'
  | 'auth'
  | 'rate-limit'
  | 'invalid-input'
  | 'policy'
  | 'tool'
  | 'provider'
  | 'budget'
  | 'bug';

export interface StructuredFailure {
  category: FailureCategory;
  code: string;
  message: string;
  retryable: boolean;
  details?: any;
}

export interface RunBudget {
  maxTimeMs?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxToolCalls?: number;
  maxTurns?: number;
  childAgentBudget?: RunBudget;
}

export interface BudgetUsage {
  elapsedTimeMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  costUsd: number;
  toolCallsCount: number;
  turnsCount: number;
}

export interface RunState {
  runId: string;
  parentRunId?: string;
  rootRunId: string;
  sessionId: string;
  task: string;
  status: RunStatus;
  currentTurn: number;
  budget: RunBudget;
  usage: BudgetUsage;
  idempotencyKeys: string[];
  terminationReason?: TerminationReason;
  error?: StructuredFailure;
  result?: string;
  createdAt: number;
  updatedAt: number;
}

export function createInitialRunState(params: {
  runId?: string;
  parentRunId?: string;
  rootRunId?: string;
  sessionId: string;
  task: string;
  budget?: RunBudget;
}): RunState {
  const runId = params.runId || `run_${Math.random().toString(36).substring(2, 10)}`;
  const rootRunId = params.rootRunId || (params.parentRunId ? params.parentRunId : runId);
  const now = Date.now();

  return {
    runId,
    parentRunId: params.parentRunId,
    rootRunId,
    sessionId: params.sessionId,
    task: params.task,
    status: 'queued',
    currentTurn: 0,
    budget: {
      maxTurns: 25,
      maxTimeMs: 300000, // 5 minutes default
      maxToolCalls: 50,
      ...params.budget
    },
    usage: {
      elapsedTimeMs: 0,
      tokens: { input: 0, output: 0, total: 0 },
      costUsd: 0,
      toolCallsCount: 0,
      turnsCount: 0
    },
    idempotencyKeys: [],
    createdAt: now,
    updatedAt: now
  };
}
