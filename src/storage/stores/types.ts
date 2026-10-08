import { RunState, RunStatus } from '../../runtime/runState.js';
import { AgentEvent } from '../../runtime/events.js';
import {
  AgentProfile,
  AgentProfileVersion,
  UserAccount,
  Workspace,
  Project
} from '../../identity/identityTypes.js';
import {
  Goal,
  GoalStatus,
  Task,
  TaskStatus,
  RunWait,
  WaitStatus
} from '../../autonomy/goalTypes.js';
import {
  ScopedMemoryItem,
  MemoryScope,
  MemoryLifecycle,
  MemoryType
} from '../../memory/memoryTypes.js';

/**
 * Athena V2 store interfaces (P1 + P2 + P3).
 *
 * Persistence is written against these interfaces. P12 adds a PostgreSQL
 * adapter; callers and the EpisodicMemory facade do not change.
 */

export interface SessionSearchEntry {
  id: string;
  category: string;
  contentText: string;
  sessionId?: string;
  runId?: string;
  goalId?: string;
  taskId?: string;
  workspaceId?: number;
  projectId?: number;
  agentId?: string;
  metadata?: Record<string, any>;
  timestamp: number;
}

export interface SessionSearchFilter {
  query: string;
  categories?: string[];
  sessionId?: string;
  runId?: string;
  goalId?: string;
  taskId?: string;
  workspaceId?: number;
  projectId?: number;
  agentId?: string;
  timeRange?: { start?: number; end?: number };
  limit?: number;
}

export interface SessionSearchResult {
  id: string;
  category: string;
  contentText: string;
  sessionId?: string;
  runId?: string;
  goalId?: string;
  taskId?: string;
  workspaceId?: number;
  projectId?: number;
  agentId?: string;
  metadata?: Record<string, any>;
  timestamp: number;
  rank?: number;
}

export interface MemoryStore {
  save(item: Omit<ScopedMemoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<number>;
  get(id: number): Promise<ScopedMemoryItem | null>;
  updateLifecycle(id: number, lifecycle: MemoryLifecycle, supersededBy?: number): Promise<void>;
  validate(id: number, evidence?: string): Promise<void>;
  reinforce(id: number, delta?: number): Promise<void>;
  contradict(id: number, evidence?: string): Promise<void>;
  quarantine(id: number, reason: string): Promise<void>;
  search(params: {
    query: string;
    scope?: MemoryScope | MemoryScope[];
    type?: MemoryType | MemoryType[];
    limit?: number;
    threshold?: number;
    minConfidence?: number;
    lifecycles?: MemoryLifecycle[];
    sessionId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
    goalId?: string;
    includeQuarantined?: boolean;
    queryEmbedding?: number[] | null;
  }): Promise<ScopedMemoryItem[]>;
  inspect(query?: string, scope?: MemoryScope, limit?: number): Promise<ScopedMemoryItem[]>;
  delete(id: number): Promise<void>;
}

export interface SessionSearchStore {
  indexEntry(entry: SessionSearchEntry): Promise<void>;
  search(filter: SessionSearchFilter): Promise<SessionSearchResult[]>;
  deleteByRun(runId: string): Promise<void>;
  deleteBySession(sessionId: string): Promise<void>;
}


export interface AgentStore {
  get(id: string): Promise<AgentProfile | null>;
  getByName(name: string): Promise<AgentProfile | null>;
  list(): Promise<AgentProfile[]>;
  /**
   * Persists the current version (assigns the next version, preserves
   * createdAt) and appends an immutable snapshot to version history.
   */
  save(profile: AgentProfile, changedBy?: string): Promise<AgentProfile>;
  getVersionHistory(profileId: string): Promise<AgentProfileVersion[]>;
  setActiveWorkspace(profileId: string, workspaceId: number | null, changedBy?: string): Promise<AgentProfile>;
}

export interface UserStore {
  get(id: string): Promise<UserAccount | null>;
  list(): Promise<UserAccount[]>;
  save(user: UserAccount): Promise<UserAccount>;
}

export interface WorkspaceStore {
  get(id: number): Promise<Workspace | null>;
  getByName(name: string): Promise<Workspace | null>;
  list(): Promise<Workspace[]>;
  /** Inserts when id is unassigned (0). Returns the stored row with its id. */
  save(workspace: Workspace): Promise<Workspace>;
  /** Throws when projects still reference the workspace. */
  delete(id: number): Promise<boolean>;
}

export interface ProjectStore {
  get(id: number): Promise<Project | null>;
  list(workspaceId?: number): Promise<Project[]>;
  save(project: Project): Promise<Project>;
  delete(id: number): Promise<boolean>;
}

export interface RunStore {
  save(state: RunState): Promise<void>;
  get(runId: string): Promise<RunState | null>;
  update(runId: string, updates: Partial<RunState>): Promise<void>;
  list(sessionId?: string, limit?: number): Promise<RunState[]>;
  listByGoal?(goalId: string): Promise<RunState[]>;
  listByStatus?(status: RunStatus): Promise<RunState[]>;
}

export interface EventStore {
  saveRunEvent(event: AgentEvent): Promise<void>;
  getRunEvents(runId: string): Promise<AgentEvent[]>;
}

export interface GoalStore {
  get(id: string): Promise<Goal | null>;
  save(goal: Goal): Promise<Goal>;
  update(id: string, updates: Partial<Goal>): Promise<Goal>;
  list(filter?: { workspaceId?: number; status?: GoalStatus; limit?: number }): Promise<Goal[]>;
  delete(id: string): Promise<boolean>;
}

export interface TaskStore {
  get(id: string): Promise<Task | null>;
  save(task: Task): Promise<Task>;
  update(id: string, updates: Partial<Task>): Promise<Task>;
  listByGoal(goalId: string): Promise<Task[]>;
  getReadyTasks(goalId: string): Promise<Task[]>;
  delete(id: string): Promise<boolean>;
}

export interface RunWaitStore {
  create(wait: RunWait): Promise<RunWait>;
  get(id: string): Promise<RunWait | null>;
  getByRunId(runId: string): Promise<RunWait | null>;
  listActive(): Promise<RunWait[]>;
  update(id: string, updates: Partial<RunWait>): Promise<RunWait>;
  delete(id: string): Promise<boolean>;
}

// --- P4B: Web Research, RAG, and Document Intelligence ---

/** A persisted embedding vector bound to a text chunk (RAG ingest output). */
export interface VectorEmbeddingRecord {
  id: string;
  /** Logical collection, e.g. "documents", "web_research", or a project id. */
  namespace: string;
  /** Owning entity, e.g. the ingested research document id. */
  refId?: string;
  text: string;
  embedding: number[];
  dims: number;
  /** Embedding model that produced the vector. */
  model: string;
  metadata?: Record<string, any>;
  createdAt?: number;
  updatedAt?: number;
}

export interface VectorSearchResult {
  id: string;
  namespace: string;
  refId?: string;
  text: string;
  /** Cosine similarity in [0, 1] (or [-1, 1] for raw cosine). */
  score: number;
  metadata?: Record<string, any>;
}

export interface VectorSearchOptions {
  namespace?: string;
  refId?: string;
  dims?: number;
  limit?: number;
  threshold?: number;
}

/**
 * Vector store behind an interface. SQLite implementation stores embeddings
 * as JSON with in-process cosine search (V1 representation). P12 adds a
 * PostgreSQL/pgvector adapter; callers do not change.
 */
export interface VectorStore {
  upsert(record: VectorEmbeddingRecord): Promise<void>;
  get(id: string): Promise<VectorEmbeddingRecord | null>;
  delete(id: string): Promise<void>;
  deleteByRef(refId: string): Promise<void>;
  deleteByNamespace(namespace: string): Promise<void>;
  search(embedding: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]>;
  count(namespace?: string): Promise<number>;
}

/** An ingested source document tracked by the RAG pipeline. */
export interface ResearchDocument {
  id: string;
  /** "file" | "url" | "text" */
  sourceType: string;
  sourceUri: string;
  title?: string;
  format?: string;
  contentHash: string;
  chunkCount: number;
  charCount: number;
  workspaceId?: number | null;
  metadata?: Record<string, any>;
  createdAt?: number;
  updatedAt?: number;
}

export interface ResearchDocumentStore {
  save(doc: ResearchDocument): Promise<ResearchDocument>;
  get(id: string): Promise<ResearchDocument | null>;
  findBySourceUri(sourceUri: string): Promise<ResearchDocument | null>;
  findByHash(contentHash: string): Promise<ResearchDocument | null>;
  list(filter?: { workspaceId?: number; sourceType?: string; limit?: number }): Promise<ResearchDocument[]>;
  delete(id: string): Promise<boolean>;
}

/** A persistent browser profile tracked by the P4C browser subsystem. */
export interface BrowserProfileRecord {
  id: string;
  agentId?: string | null;
  taskId?: string | null;
  name: string;
  userDataDir: string;
  cookiesCount?: number;
  metadata?: Record<string, any>;
  createdAt?: number;
  updatedAt?: number;
}

export interface BrowserProfileStore {
  save(profile: BrowserProfileRecord): Promise<BrowserProfileRecord>;
  get(id: string): Promise<BrowserProfileRecord | null>;
  findByName(name: string): Promise<BrowserProfileRecord | null>;
  findByAgent(agentId: string): Promise<BrowserProfileRecord[]>;
  findByTask(taskId: string): Promise<BrowserProfileRecord[]>;
  list(filter?: { agentId?: string; taskId?: string; limit?: number }): Promise<BrowserProfileRecord[]>;
  delete(id: string): Promise<boolean>;
}

/** A routine record (Spec Section 30). */
export type RoutineTriggerType = 'event' | 'schedule' | 'condition';

export interface RoutineRecord {
  id: string;
  name: string;
  description?: string;
  triggerType: RoutineTriggerType;
  triggerConfig: Record<string, any>;
  workflow: Record<string, any>;
  conditions?: Record<string, any>[];
  permissions?: string[];
  enabled: boolean;
  successRate: number;
  invocations: number;
  lastRunAt?: number | null;
  history?: any[];
  createdAt?: number;
  updatedAt?: number;
}

export interface RoutineStore {
  save(routine: RoutineRecord): Promise<RoutineRecord>;
  get(id: string): Promise<RoutineRecord | null>;
  findByName(name: string): Promise<RoutineRecord | null>;
  findByTriggerType(triggerType: RoutineTriggerType): Promise<RoutineRecord[]>;
  list(filter?: { enabled?: boolean; triggerType?: RoutineTriggerType; limit?: number }): Promise<RoutineRecord[]>;
  recordRun(id: string, outcome: { success: boolean; durationMs?: number; runId?: string; error?: string }): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** A distilled learned workflow (Spec Section 31). */
export type LearnedWorkflowStatus = 'proposed' | 'approved' | 'active' | 'rejected' | 'archived';

export interface WorkflowStep {
  stepId: string;
  action: string;
  description: string;
  inputTemplate?: Record<string, any>;
  dependencies?: string[];
  expectedOutcome?: string;
}

export interface LearnedWorkflowRecord {
  id: string;
  intent: string;
  steps: WorkflowStep[];
  dependencies?: string[];
  conditions?: Record<string, any>[];
  requiredPermissions?: string[];
  expectedOutcome?: string;
  failureHandling?: Record<string, any>;
  sourceRunId?: string;
  status: LearnedWorkflowStatus;
  reviewNotes?: string;
  reviewedBy?: string;
  reviewedAt?: number;
  successRate: number;
  invocations: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface LearnedWorkflowStore {
  save(workflow: LearnedWorkflowRecord): Promise<LearnedWorkflowRecord>;
  get(id: string): Promise<LearnedWorkflowRecord | null>;
  findByStatus(status: LearnedWorkflowStatus): Promise<LearnedWorkflowRecord[]>;
  list(filter?: { status?: LearnedWorkflowStatus; limit?: number }): Promise<LearnedWorkflowRecord[]>;
  updateStatus(id: string, status: LearnedWorkflowStatus, review?: { notes?: string; reviewedBy?: string }): Promise<void>;
  recordOutcome(id: string, success: boolean): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** A registered skill record with progressive disclosure and telemetry (Spec Section 29). */
export type SkillLifecycleStatus = 'proposed' | 'reviewed' | 'active' | 'deprecated' | 'archived';

export interface SkillRecord {
  id: string;
  name: string;
  version: string;
  description?: string;
  tags?: string[];
  dependencies?: string[];
  permissions?: string[];
  triggers?: string[];
  contentPath?: string;
  status: SkillLifecycleStatus;
  invocations: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  lastUsedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface SkillStore {
  save(skill: SkillRecord): Promise<SkillRecord>;
  get(id: string): Promise<SkillRecord | null>;
  findByName(name: string): Promise<SkillRecord | null>;
  list(filter?: { status?: SkillLifecycleStatus; limit?: number }): Promise<SkillRecord[]>;
  updateStatus(id: string, status: SkillLifecycleStatus): Promise<void>;
  recordOutcome(nameOrId: string, success: boolean): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** A2A Messaging (Spec Section 34). */
export type AgentMessageType =
  | 'request'
  | 'response'
  | 'handoff'
  | 'question'
  | 'blocked'
  | 'status'
  | 'artifact'
  | 'approval'
  | 'cancel';

export type AgentMessageStatus = 'sent' | 'delivered' | 'read' | 'processed' | 'failed';

export interface AgentMessage {
  id: string;
  senderId: string;
  recipientId: string;
  messageType: AgentMessageType;
  goalId?: string;
  taskId?: string;
  runId?: string;
  payload: Record<string, any> | string;
  status: AgentMessageStatus;
  replyToId?: string;
  createdAt: number;
  processedAt?: number;
}

export interface AgentMessageStore {
  save(message: AgentMessage): Promise<AgentMessage>;
  get(id: string): Promise<AgentMessage | null>;
  listByRecipient(recipientId: string, filter?: { goalId?: string; taskId?: string; status?: AgentMessageStatus; limit?: number }): Promise<AgentMessage[]>;
  listByThread(replyToId: string): Promise<AgentMessage[]>;
  listByTask(taskId: string): Promise<AgentMessage[]>;
  listByGoal(goalId: string): Promise<AgentMessage[]>;
  updateStatus(id: string, status: AgentMessageStatus): Promise<void>;
  delete(id: string): Promise<boolean>;
}

/** Multi-Agent Teams (Spec Section 32). */
export interface AgentTeam {
  id: string;
  name: string;
  /** Mandatory specialization justification per build plan rule. */
  justification: string;
  leadAgentId: string;
  memberAgentIds: string[];
  metadata?: Record<string, any>;
  createdAt: number;
  updatedAt: number;
}

export interface AgentTeamStore {
  save(team: AgentTeam): Promise<AgentTeam>;
  get(id: string): Promise<AgentTeam | null>;
  list(): Promise<AgentTeam[]>;
  delete(id: string): Promise<boolean>;
}


