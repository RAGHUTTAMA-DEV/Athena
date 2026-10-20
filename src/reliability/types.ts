export type TaskVerificationCategory =
  | 'page_inspected'
  | 'file_verified'
  | 'test_build'
  | 'sources_checked'
  | 'delivery_result'
  | 'resulting_state';

export interface TaskVerificationRequest {
  taskType: TaskVerificationCategory;
  expectedOutcome: string;
  evidence: any;
  options?: {
    filePath?: string;
    url?: string;
    domElements?: string[];
    exitCode?: number;
    testResults?: { passed: number; failed: number };
    minSources?: number;
    expectedState?: Record<string, any>;
    currentState?: Record<string, any>;
    channelStatus?: string;
  };
}

export interface TaskVerificationOutcome {
  passed: boolean;
  taskType: TaskVerificationCategory;
  score: number; // 0.0 - 1.0
  evidenceSummary: string;
  failureReasons: string[];
  repairPlan?: string;
}

export interface ReviewRubricItem {
  name: string;
  passed: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
}

export interface IndependentReviewResult {
  approved: boolean;
  score: number; // 0.0 - 1.0
  rubrics: ReviewRubricItem[];
  defectsCaught: string[];
  summary: string;
}

export interface SelfRepairAttempt {
  attemptIndex: number;
  failureClassification: 'syntax' | 'logic' | 'timeout' | 'missing_dependency' | 'assertion' | 'unknown';
  diagnosis: string;
  repairPlan: string;
  actionTaken: string;
  verificationPassed: boolean;
}

export interface SelfRepairResult {
  repaired: boolean;
  attemptsCount: number;
  attempts: SelfRepairAttempt[];
  finalOutput?: any;
  exhausted: boolean;
}

export type HITLTriggerType =
  | 'critical_ambiguity'
  | 'high_risk'
  | 'destructive'
  | 'financial'
  | 'external_publication'
  | 'credential_modification'
  | 'permission_escalation';

export interface HITLEvaluation {
  requiresApproval: boolean;
  triggerType?: HITLTriggerType;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  explanation: string;
}
