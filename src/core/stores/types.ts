import { RunState } from '../runState.js';
import { AgentEvent } from '../events.js';
import {
  AgentProfile,
  AgentProfileVersion,
  UserAccount,
  Workspace,
  Project
} from '../identityTypes.js';

/**
 * Athena V2 store interfaces (P1).
 *
 * Persistence is written against these interfaces. P12 adds a PostgreSQL
 * adapter; callers and the EpisodicMemory facade do not change.
 */

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
}

export interface EventStore {
  saveRunEvent(event: AgentEvent): Promise<void>;
  getRunEvents(runId: string): Promise<AgentEvent[]>;
}
