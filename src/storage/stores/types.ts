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

