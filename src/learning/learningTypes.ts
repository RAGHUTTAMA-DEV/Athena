export type SkillLifecycleStatus = 'proposed' | 'reviewed' | 'active' | 'deprecated' | 'archived';

export interface SkillMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  tags: string[];
  dependencies?: string[];
  permissions?: string[];
  triggers?: string[];
  filePath?: string;
  status: SkillLifecycleStatus;
  invocations: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  lastUsedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface SkillWithContent extends SkillMetadata {
  content: string;
}

export type RoutineTriggerType = 'event' | 'schedule' | 'condition';

export interface RoutineCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'in' | 'greater_than' | 'less_than' | 'exists';
  value?: any;
}

export interface RoutineWorkflow {
  type: 'prompt' | 'task_sequence' | 'skill';
  goal?: string;
  prompt?: string;
  steps?: {
    stepId: string;
    action: string;
    description: string;
    parameters?: Record<string, any>;
  }[];
  skillName?: string;
}

export interface RoutineExecutionResult {
  routineId: string;
  success: boolean;
  runId?: string;
  durationMs: number;
  error?: string;
  timestamp: number;
}

export interface WorkflowStepDefinition {
  stepId: string;
  action: string;
  description: string;
  inputTemplate?: Record<string, any>;
  dependencies?: string[];
  expectedOutcome?: string;
}

export interface DistilledWorkflow {
  id: string;
  intent: string;
  steps: WorkflowStepDefinition[];
  dependencies?: string[];
  conditions?: RoutineCondition[];
  requiredPermissions?: string[];
  expectedOutcome?: string;
  failureHandling?: {
    strategy: 'retry' | 'rollback' | 'escalate' | 'ignore';
    maxRetries?: number;
    notes?: string;
  };
  sourceRunId?: string;
  status: 'proposed' | 'approved' | 'active' | 'rejected' | 'archived';
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: number;
  successRate: number;
  invocations: number;
  createdAt: number;
  updatedAt: number;
}
