import { PermissionModel } from '../identity/identityTypes.js';
import {
  AgentMessage,
  AgentMessageType,
  AgentMessageStatus,
  AgentTeam,
  AgentMessageStore,
  AgentTeamStore
} from '../storage/stores/types.js';

export {
  AgentMessage,
  AgentMessageType,
  AgentMessageStatus,
  AgentTeam,
  AgentMessageStore,
  AgentTeamStore
};

export type SpecializedRole = 'researcher' | 'coder' | 'reviewer' | 'planner' | 'browser' | 'data';

export interface DelegationContract {
  contractId: string;
  parentAgentId: string;
  targetRole: SpecializedRole | string;
  targetAgentId?: string;
  goalId?: string;
  taskId?: string;
  taskDescription: string;
  scopedContext: string;
  allowedTools: string[];
  permissionScope?: PermissionModel;
  boundedLifetime: {
    maxTurns: number;
    timeoutMs: number;
  };
  outputContract: {
    format: 'summary' | 'artifact' | 'json' | 'structured';
    expectedFields?: string[];
  };
  handoffMetadata?: Record<string, any>;
}

export interface HandoffStep {
  stepIndex: number;
  role: SpecializedRole | string;
  instructions: string;
  allowedTools: string[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: any;
  error?: string;
}

export interface HandoffPipeline {
  pipelineId: string;
  goalId?: string;
  taskId?: string;
  name: string;
  steps: HandoffStep[];
  currentStepIndex: number;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
}
