export type GoalStatus =
  | 'proposed'
  | 'active'
  | 'blocked'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type GoalPriority = 'critical' | 'high' | 'normal' | 'low';

export interface GoalBudget {
  maxTimeMs?: number;
  maxTokens?: number;
  maxCostUsd?: number;
  maxToolCalls?: number;
  maxTurns?: number;
}

export interface GoalUsage {
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

export interface Goal {
  id: string;
  workspaceId: number | null;
  projectId: number | null;
  title: string;
  description?: string;
  status: GoalStatus;
  priority: GoalPriority;
  deadline?: number | null;
  progress: number;
  dependencies: string[];
  artifacts: any[];
  budget: GoalBudget;
  usage: GoalUsage;
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export type TaskStatus =
  | 'pending'
  | 'in_progress'
  | 'waiting'
  | 'blocked'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'skipped';

export interface Task {
  id: string;
  goalId: string;
  parentTaskId?: string | null;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: GoalPriority;
  dependencies: string[];
  assignedAgentId?: string | null;
  attempts: number;
  maxAttempts: number;
  result?: string | null;
  error?: string | null;
  recurring?: string | null;
  delegated: boolean;
  createdAt: number;
  updatedAt: number;
}

export type WaitType = 'WAITING_FOR_EVENT' | 'APPROVAL' | 'USER' | 'BLOCKED';
export type WaitStatus = 'waiting' | 'satisfied' | 'timed_out' | 'cancelled';

export interface RunWait {
  id: string;
  runId: string;
  waitType: WaitType;
  status: WaitStatus;
  eventPattern?: string | null;
  matcherCriteria?: Record<string, any> | null;
  deadline?: number | null;
  waitResult?: any;
  metadata?: Record<string, any> | null;
  createdAt: number;
  updatedAt: number;
}

export function createInitialGoalUsage(): GoalUsage {
  return {
    elapsedTimeMs: 0,
    tokens: { input: 0, output: 0, total: 0 },
    costUsd: 0,
    toolCallsCount: 0,
    turnsCount: 0
  };
}
