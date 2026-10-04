export type MemoryScope =
  | 'global'
  | 'user'
  | 'workspace'
  | 'project'
  | 'session'
  | 'task';

export type MemoryLifecycle =
  | 'active'
  | 'confirmed'
  | 'contradicted'
  | 'superseded'
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
  provenance: MemoryProvenance;
  supersededBy?: number;
  embedding?: number[];
  score?: number; // Semantic similarity score on search
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

export interface ContextBudget {
  maxContextTokens?: number;      // Total prompt context token cap
  systemPromptTokenLimit?: number;
  memoryTokenLimit?: number;       // Token budget allocated for semantic/scoped memory
  skillsTokenLimit?: number;       // Token budget allocated for procedural skills
  historyTokenLimit?: number;      // Token budget allocated for conversation history
}

export interface AssembledContext {
  systemInstruction: string;
  includedFacts: ScopedMemoryItem[];
  includedSkills: any[];
  workingHistory: any[];
  tokenEstimate: {
    system: number;
    memory: number;
    skills: number;
    history: number;
    total: number;
  };
}
