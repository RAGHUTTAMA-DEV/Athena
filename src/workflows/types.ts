import { RunBudget } from '../runtime/runState.js';

// ── Node Variants ───────────────────────────────────────────────────

export type WfNode =
  | AgentNode
  | OrchestratorNode
  | CollectorNode
  | ToolNode
  | ConditionNode
  | MapNode
  | ApprovalNode
  | TriggerNode
  | SubWorkflowNode;

export interface AgentNode {
  id: string;
  type: 'agent';
  prompt: string;
  tools: string[];
  budget?: Partial<RunBudget>;
  model?: string;
  output?: 'text' | 'json';
  outputSchema?: Record<string, any>;
}

export interface SpecialistDef {
  name: string;
  systemPrompt: string;
  tools: string[];
  budget?: Partial<RunBudget>;
  model?: string;
}

export interface OrchestratorNode {
  id: string;
  type: 'orchestrator';
  systemPrompt: string;
  prompt?: string;
  specialists: SpecialistDef[];
  tools: string[];
  budget?: Partial<RunBudget>;
  model?: string;
  output?: 'text' | 'json';
  outputSchema?: Record<string, any>;
}

export type CollectorStrategy =
  | 'structured_merge'
  | 'consensus_voting'
  | 'debate_refine'
  | 'synthesis_agent';

export interface CollectorNode {
  id: string;
  type: 'collector';
  strategy: CollectorStrategy;
  sources: string[];
  policy?: 'all_or_nothing' | 'best_effort_quorum' | 'fallback_reroute';
  quorumMin?: number;
  votingField?: string;
  votingPolicy?: 'unanimous' | 'majority' | 'supermajority';
  synthesisPrompt?: string;
  synthesisTools?: string[];
  synthesisModel?: string;
  debateMaxRounds?: number;
}

export interface ToolNode {
  id: string;
  type: 'tool';
  tool: string;
  args: Record<string, any>;
}

export interface ConditionNode {
  id: string;
  type: 'condition';
  expr: string;
  trueBranch: string;
  falseBranch: string;
}

export interface MapNode {
  id: string;
  type: 'map';
  over: string;
  node: Omit<WfNode, 'id'>;
  maxConcurrency?: number;
}

export interface ApprovalNode {
  id: string;
  type: 'approval';
  message: string;
  timeoutMs?: number;
}

export interface TriggerNode {
  id: string;
  type: 'trigger';
  triggerType: 'manual' | 'cron' | 'webhook' | 'chat';
  schedule?: string;
  webhookPath?: string;
}

export interface SubWorkflowNode {
  id: string;
  type: 'subWorkflow';
  workflowId: string;
  version?: number;
  inputs: Record<string, any>;
}

// ── Top-Level Workflow Definitions ──────────────────────────────────

export interface WorkflowInput {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  description?: string;
  default?: any;
}

export interface WorkflowSettings {
  maxCostUsd?: number;
  maxTimeMs?: number;
  maxTurns?: number;
  model?: string;
  memoryScope?: string;
}

export interface WorkflowAgentProfile {
  systemPrompt: string;
  name: string;
  description: string;
  publishAsAgent: boolean;
  toolName?: string;
}

export interface Workflow {
  id: string;
  version: number;
  name: string;
  description?: string;
  inputs: Record<string, WorkflowInput>;
  settings: WorkflowSettings;
  agentProfile?: WorkflowAgentProfile;
  nodes: WfNode[];
  edges: [string, string][];
}

// ── Execution & Run Tracking ────────────────────────────────────────

export type WfRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface WfNodeOutput {
  nodeId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: any;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface WfRun {
  runId: string;
  workflowId: string;
  version: number;
  inputs: Record<string, any>;
  status: WfRunStatus;
  nodeOutputs: Record<string, WfNodeOutput>;
  parentRunId?: string;
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export interface BlackboardEntry {
  runId: string;
  key: string;
  value: any;
  createdBy?: string;
  updatedAt: number;
}
