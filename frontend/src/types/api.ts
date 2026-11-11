export type RunStatus =
  | 'created'
  | 'queued'
  | 'planning'
  | 'running'
  | 'waiting'
  | 'blocked'
  | 'approval_required'
  | 'verifying'
  | 'reviewing'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface StructuredFailure {
  category: string;
  code: string;
  message: string;
  retryable: boolean;
  details?: any;
}

export interface RunRecord {
  runId: string;
  rootRunId?: string;
  sessionId: string;
  goalId?: string;
  taskId?: string;
  task?: string;
  status: RunStatus;
  currentTurn?: number;
  budget?: { maxTurns?: number };
  usage?: {
    elapsedTimeMs?: number;
    tokens?: { input: number; output: number; total: number };
    costUsd?: number;
    toolCallsCount?: number;
    turnsCount?: number;
  };
  result?: string;
  error?: string | StructuredFailure;
  stage?: string;
  createdAt: number;
  updatedAt: number;
  summary?: string;
  currentStage?: string;
  metadata?: Record<string, any>;
}

export interface SessionSummary {
  sessionId: string;
  lastActiveAt: number | string;
  runCount: number;
  latestRunId?: string;
  latestStatus?: RunStatus;
  title?: string;
}

export interface ToolCallEvent {
  id?: string;
  tool: string;
  status: 'started' | 'running' | 'completed' | 'failed';
  args?: any;
  result?: any;
  durationMs?: number;
}

export interface ResearchTrack {
  id: string;
  name: string;
  status: 'SOURCE CHECKED' | 'REVIEW NEEDED' | 'IN PROGRESS' | 'QUEUED' | string;
  description?: string;
}

export interface ApprovalRecord {
  id: string;
  approvalId?: string;
  runId?: string;
  goalId?: string;
  taskId?: string;
  action: string;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  explanation?: string;
  proposedAction?: any;
  params?: any;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: number;
  expiresAt?: number;
  resolvedAt?: number;
  resolutionReason?: string;
}

export type FlowKind =
  | 'System'
  | 'Memory'
  | 'Thinking'
  | 'Browser'
  | 'Coding'
  | 'Sub-agent'
  | 'Skill'
  | 'MCP'
  | 'Scheduler'
  | 'Tool'
  | 'Warning';

export interface FlowStep {
  id: string;
  kind: FlowKind | string;
  child?: string;
  tool?: string;
  title: string;
  detail?: string;
  args?: any;
  result?: any;
  status: 'running' | 'completed' | 'failed' | 'done';
  durationMs?: number;
  timestamp?: number;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'agent' | 'system';
  senderName?: string;
  content: string;
  error?: string | StructuredFailure;
  timestamp: string | number;
  runId?: string;
  status?: RunStatus;
  thoughts?: string[];
  toolCalls?: ToolCallEvent[];
  flowSteps?: FlowStep[];
  approvals?: ApprovalRecord[];
  tracks?: ResearchTrack[];
}

export interface GoalRecord {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'active' | 'paused' | 'completed' | 'failed';
  priority?: string;
  progress?: number;
  tasks?: TaskRecord[];
  createdAt: number;
  updatedAt?: number;
}

export interface TaskRecord {
  id: string;
  goalId: string;
  title: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed';
  assignedAgent?: string;
  dependencies?: string[];
  attempts?: number;
  result?: string;
}

export interface ArtifactRecord {
  id: string;
  name: string;
  type: string;
  mimeType?: string;
  currentVersion: number;
  contentHash?: string;
  contentText?: string;
  filePath?: string;
  runId?: string;
  goalId?: string;
  createdAt: number;
}

export interface SessionStateView {
  sessionId: string;
  activeRun: RunRecord | null;
  recentRuns: RunRecord[];
  pendingApprovals: ApprovalRecord[];
  activeGoal: GoalRecord | null;
  tasks: TaskRecord[];
  hydratedAt: number;
}

export interface RunTraceResponse {
  run: RunRecord;
  events: any[];
  approvals: ApprovalRecord[];
  replaySteps: any[];
}
