export type MemoryScope =
  | 'global'
  | 'user'
  | 'workspace'
  | 'project'
  | 'agent'
  | 'session'
  | 'task'
  | 'goal';

export type MemoryType =
  | 'fact'
  | 'preference'
  | 'relationship'
  | 'procedural'
  | 'semantic'
  | 'episodic';

export type MemoryLifecycle =
  | 'candidate'
  | 'validated'
  | 'active'
  | 'confirmed'
  | 'contradicted'
  | 'superseded'
  | 'archived'
  | 'quarantined'
  | 'deleted';

export interface MemoryProvenance {
  source: 'user_input' | 'agent_reflection' | 'tool_result' | 'subagent';
  timestamp: number;
  runId?: string;
  sessionId?: string;
  evidence?: string;
}

export interface ScopedMemoryItem {
  id: number;
  scope: MemoryScope;
  fact: string;
  tags: string[];
  confidence: number; // Calibrated 0.0 to 1.0
  lifecycle: MemoryLifecycle;
  type?: MemoryType;
  provenance: MemoryProvenance;
  supersededBy?: number;
  embedding?: number[];
  score?: number; // Semantic similarity score on search
  /** Undefined = unbound / cross-workspace (V1 semantics). */
  workspaceId?: number;
  projectId?: number;
  agentId?: string;
  goalId?: string;
  securityStatus?: 'clean' | 'quarantined' | 'flagged';
  quarantineReason?: string;
  createdAt: number;
  updatedAt: number;
}

export interface SkillRegistryEntry {
  name: string;
  version: string;
  description: string;
  tags: string[];
  dependencies: string[];
  invocations: number;
  successes: number;
  failures: number;
  successRate: number;
  lastInvoked?: number;
  createdAt: number;
  updatedAt: number;
}

export type ContextRefType =
  | 'file'
  | 'folder'
  | 'repo'
  | 'url'
  | 'session'
  | 'run'
  | 'goal'
  | 'task'
  | 'memory'
  | 'artifact'
  | 'project';

export interface ContextRef {
  type: ContextRefType;
  target: string;
  raw: string;
}

export interface ResolvedContextRef {
  ref: ContextRef;
  content: string;
  tokenCount: number;
  truncated: boolean;
  metadata?: Record<string, any>;
}

export interface ContextBudget {
  maxContextTokens?: number;      // Total prompt context token cap
  systemPromptTokenLimit?: number;
  memoryTokenLimit?: number;       // Token budget allocated for semantic/scoped memory
  skillsTokenLimit?: number;       // Token budget allocated for procedural skills
  historyTokenLimit?: number;      // Token budget allocated for conversation history
  contextRefsTokenLimit?: number;  // Token budget allocated for resolved context references
}

export interface LayeredContextBreakdown {
  identityTokens: number;
  stableInstructionsTokens: number;
  skillsTokens: number;
  toolsTokens: number;
  taskStateTokens: number;
  memoryTokens: number;
  liveContextTokens: number;
  historyTokens: number;
  totalTokens: number;
}

export interface AssembledContext {
  systemInstruction: string;
  includedFacts: ScopedMemoryItem[];
  includedSkills: any[];
  workingHistory: any[];
  resolvedRefs?: ResolvedContextRef[];
  layerBreakdown?: LayeredContextBreakdown;
  tokenEstimate: {
    system: number;
    memory: number;
    skills: number;
    history: number;
    total: number;
  };
}

export interface TokenUsageRecord {
  callId: string;
  runId?: string;
  goalId?: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  latencyMs: number;
  costUsd: number;
  timestamp: number;
}

