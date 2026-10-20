import { PostgresDatabase } from '../postgresDatabase.js';
import {
  AgentStore,
  UserStore,
  WorkspaceStore,
  ProjectStore,
  RunStore,
  EventStore,
  GoalStore,
  TaskStore,
  RunWaitStore,
  MemoryStore,
  SessionSearchStore,
  VectorStore,
  ResearchDocumentStore,
  ApprovalStore,
  ArtifactStore,
  ReplayStore,
  VectorEmbeddingRecord,
  VectorSearchResult,
  VectorSearchOptions,
  ResearchDocument,
  ApprovalRequest,
  Artifact,
  ArtifactVersion,
  ReplayLogEntry,
  SessionSearchEntry,
  SessionSearchFilter,
  SessionSearchResult,
} from '../../stores/types.js';
import {
  AgentProfile,
  AgentProfileVersion,
  AgentStatusType,
  PermissionModel,
  ProfileMemoryScope,
  UserAccount,
  UserPreferences,
  Workspace,
  WorkspaceKind,
  Project
} from '../../../identity/identityTypes.js';
import {
  Goal,
  GoalStatus,
  GoalPriority,
  Task,
  TaskStatus,
  RunWait,
  WaitType,
  WaitStatus,
  createInitialGoalUsage
} from '../../../autonomy/goalTypes.js';
import { RunState, RunStatus } from '../../../runtime/runState.js';
import { AgentEvent } from '../../../runtime/events.js';
import { ScopedMemoryItem, MemoryLifecycle } from '../../../memory/memoryTypes.js';

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

export class PostgresAgentStore implements AgentStore {
  constructor(private db: PostgresDatabase) {}

  async get(id: string): Promise<AgentProfile | null> {
    const res = await this.db.query('SELECT * FROM agent_profiles WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapProfile(res.rows[0]);
  }

  async getByName(name: string): Promise<AgentProfile | null> {
    const res = await this.db.query('SELECT * FROM agent_profiles WHERE name = $1', [name]);
    if (res.rows.length === 0) return null;
    return this.mapProfile(res.rows[0]);
  }

  async list(): Promise<AgentProfile[]> {
    const res = await this.db.query('SELECT * FROM agent_profiles ORDER BY created_at ASC');
    return res.rows.map(this.mapProfile);
  }

  async save(profile: AgentProfile, changedBy?: string): Promise<AgentProfile> {
    const existing = await this.get(profile.id);
    const version = existing ? existing.version + 1 : (profile.version || 1);
    const now = Date.now();
    const createdAt = existing ? existing.createdAt : (profile.createdAt || now);

    const saved: AgentProfile = {
      ...profile,
      version,
      createdAt,
      updatedAt: now
    };

    await this.db.query(
      `INSERT INTO agent_profiles (
        id, name, version, identity, role, personality, capabilities,
        permissions, preferences, workspace_id, memory_scope, skills,
        routines, goals, model_policy, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      ON CONFLICT(id) DO UPDATE SET
        name = EXCLUDED.name,
        version = EXCLUDED.version,
        identity = EXCLUDED.identity,
        role = EXCLUDED.role,
        personality = EXCLUDED.personality,
        capabilities = EXCLUDED.capabilities,
        permissions = EXCLUDED.permissions,
        preferences = EXCLUDED.preferences,
        workspace_id = EXCLUDED.workspace_id,
        memory_scope = EXCLUDED.memory_scope,
        skills = EXCLUDED.skills,
        routines = EXCLUDED.routines,
        goals = EXCLUDED.goals,
        model_policy = EXCLUDED.model_policy,
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at`,
      [
        saved.id,
        saved.name,
        saved.version,
        saved.identity,
        saved.role || '',
        saved.personality || '',
        JSON.stringify(saved.capabilities || []),
        JSON.stringify(saved.permissions || { toolPermissions: [] }),
        JSON.stringify(saved.preferences || {}),
        saved.workspaceId ?? null,
        saved.memoryScope || 'all',
        JSON.stringify(saved.skills || []),
        JSON.stringify(saved.routines || []),
        JSON.stringify(saved.goals || []),
        JSON.stringify(saved.modelPolicy || {}),
        saved.status || 'active',
        saved.createdAt,
        saved.updatedAt
      ]
    );

    await this.db.query(
      `INSERT INTO agent_profile_versions (profile_id, version, snapshot, changed_by, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [saved.id, saved.version, JSON.stringify(saved), changedBy || null, now]
    );

    return saved;
  }

  async getVersionHistory(profileId: string): Promise<AgentProfileVersion[]> {
    const res = await this.db.query(
      'SELECT * FROM agent_profile_versions WHERE profile_id = $1 ORDER BY version ASC',
      [profileId]
    );
    return res.rows.map(r => ({
      profileId: r.profile_id,
      version: r.version,
      snapshot: parseJson(r.snapshot, {} as AgentProfile),
      changedBy: r.changed_by,
      createdAt: parseInt(r.created_at, 10)
    }));
  }

  async setActiveWorkspace(profileId: string, workspaceId: number | null, changedBy?: string): Promise<AgentProfile> {
    const profile = await this.get(profileId);
    if (!profile) throw new Error(`Agent profile not found: ${profileId}`);
    profile.workspaceId = workspaceId;
    return this.save(profile, changedBy);
  }

  private mapProfile(row: any): AgentProfile {
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      identity: row.identity,
      role: row.role || '',
      personality: row.personality || '',
      capabilities: parseJson<string[]>(row.capabilities, []),
      permissions: parseJson<PermissionModel>(row.permissions, { toolPermissions: [] }),
      preferences: parseJson<Record<string, any>>(row.preferences, {}),
      workspaceId: row.workspace_id !== null ? parseInt(row.workspace_id, 10) : null,
      memoryScope: (row.memory_scope || 'all') as ProfileMemoryScope,
      skills: parseJson<string[]>(row.skills, []),
      routines: parseJson<string[]>(row.routines, []),
      goals: parseJson<string[]>(row.goals, []),
      modelPolicy: parseJson<Record<string, any>>(row.model_policy, {}),
      status: (row.status || 'active') as AgentStatusType,
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresUserStore implements UserStore {
  constructor(private db: PostgresDatabase) {}

  async get(id: string): Promise<UserAccount | null> {
    const res = await this.db.query('SELECT * FROM users WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapUser(res.rows[0]);
  }

  async list(): Promise<UserAccount[]> {
    const res = await this.db.query('SELECT * FROM users ORDER BY created_at ASC');
    return res.rows.map(this.mapUser);
  }

  async save(user: UserAccount): Promise<UserAccount> {
    const existing = await this.get(user.id);
    const now = Date.now();
    const stored: UserAccount = {
      ...user,
      createdAt: existing ? existing.createdAt : (user.createdAt || now),
      updatedAt: now
    };

    await this.db.query(
      `INSERT INTO users (id, name, preferences, permissions, relationships, routines, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT(id) DO UPDATE SET
         name = EXCLUDED.name,
         preferences = EXCLUDED.preferences,
         permissions = EXCLUDED.permissions,
         relationships = EXCLUDED.relationships,
         routines = EXCLUDED.routines,
         updated_at = EXCLUDED.updated_at`,
      [
        stored.id,
        stored.name,
        JSON.stringify(stored.preferences || {}),
        JSON.stringify(stored.permissions || { toolPermissions: [] }),
        JSON.stringify(stored.relationships || {}),
        JSON.stringify(stored.routines || []),
        stored.createdAt,
        stored.updatedAt
      ]
    );

    return stored;
  }

  private mapUser(row: any): UserAccount {
    return {
      id: row.id,
      name: row.name,
      preferences: parseJson<UserPreferences>(row.preferences, {}),
      permissions: parseJson<PermissionModel>(row.permissions, { toolPermissions: [] }),
      relationships: parseJson<Record<string, string>>(row.relationships, {}),
      routines: parseJson<string[]>(row.routines, []),
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresWorkspaceStore implements WorkspaceStore {
  constructor(private db: PostgresDatabase) {}

  async get(id: number): Promise<Workspace | null> {
    const res = await this.db.query('SELECT * FROM workspaces WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapWorkspace(res.rows[0]);
  }

  async getByName(name: string): Promise<Workspace | null> {
    const res = await this.db.query('SELECT * FROM workspaces WHERE name = $1', [name]);
    if (res.rows.length === 0) return null;
    return this.mapWorkspace(res.rows[0]);
  }

  async list(): Promise<Workspace[]> {
    const res = await this.db.query('SELECT * FROM workspaces ORDER BY created_at ASC');
    return res.rows.map(this.mapWorkspace);
  }

  async save(workspace: Workspace): Promise<Workspace> {
    const now = Date.now();
    if (!workspace.id) {
      const res = await this.db.query(
        `INSERT INTO workspaces (name, kind, root_path, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [workspace.name, workspace.kind, workspace.rootPath, now, now]
      );
      return { ...workspace, id: parseInt(res.rows[0].id, 10), createdAt: now, updatedAt: now };
    }
    await this.db.query(
      `UPDATE workspaces SET name = $1, kind = $2, root_path = $3, updated_at = $4 WHERE id = $5`,
      [workspace.name, workspace.kind, workspace.rootPath, now, workspace.id]
    );
    return { ...workspace, updatedAt: now };
  }

  async delete(id: number): Promise<boolean> {
    const res = await this.db.query('DELETE FROM workspaces WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapWorkspace(row: any): Workspace {
    return {
      id: parseInt(row.id, 10),
      name: row.name,
      kind: row.kind as WorkspaceKind,
      rootPath: row.root_path,
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresProjectStore implements ProjectStore {
  constructor(private db: PostgresDatabase) {}

  async get(id: number): Promise<Project | null> {
    const res = await this.db.query('SELECT * FROM projects WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapProject(res.rows[0]);
  }

  async list(workspaceId?: number): Promise<Project[]> {
    let sql = 'SELECT * FROM projects';
    const params: any[] = [];
    if (workspaceId !== undefined) {
      sql += ' WHERE workspace_id = $1';
      params.push(workspaceId);
    }
    sql += ' ORDER BY created_at ASC';
    const res = await this.db.query(sql, params);
    return res.rows.map(this.mapProject);
  }

  async save(project: Project): Promise<Project> {
    const now = Date.now();
    if (!project.id) {
      const res = await this.db.query(
        `INSERT INTO projects (workspace_id, name, root_path, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [project.workspaceId, project.name, project.rootPath || null, now, now]
      );
      return { ...project, id: parseInt(res.rows[0].id, 10), createdAt: now, updatedAt: now };
    }
    await this.db.query(
      `UPDATE projects SET workspace_id = $1, name = $2, root_path = $3, updated_at = $4 WHERE id = $5`,
      [project.workspaceId, project.name, project.rootPath || null, now, project.id]
    );
    return { ...project, updatedAt: now };
  }

  async delete(id: number): Promise<boolean> {
    const res = await this.db.query('DELETE FROM projects WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapProject(row: any): Project {
    return {
      id: parseInt(row.id, 10),
      workspaceId: parseInt(row.workspace_id, 10),
      name: row.name,
      rootPath: row.root_path || null,
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

const DEFAULT_RUN_USAGE = {
  elapsedTimeMs: 0,
  tokens: { input: 0, output: 0, total: 0 },
  costUsd: 0,
  toolCallsCount: 0,
  turnsCount: 0
};

export class PostgresRunStore implements RunStore {
  constructor(private db: PostgresDatabase) {}

  async save(state: RunState): Promise<void> {
    await this.db.query(
      `INSERT INTO runs (
        run_id, parent_run_id, root_run_id, session_id, goal_id, task_id, task, status,
        current_turn, budget, usage, idempotency_keys, termination_reason,
        error, result, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT(run_id) DO UPDATE SET
        parent_run_id = EXCLUDED.parent_run_id,
        root_run_id = EXCLUDED.root_run_id,
        session_id = EXCLUDED.session_id,
        goal_id = EXCLUDED.goal_id,
        task_id = EXCLUDED.task_id,
        task = EXCLUDED.task,
        status = EXCLUDED.status,
        current_turn = EXCLUDED.current_turn,
        budget = EXCLUDED.budget,
        usage = EXCLUDED.usage,
        idempotency_keys = EXCLUDED.idempotency_keys,
        termination_reason = EXCLUDED.termination_reason,
        error = EXCLUDED.error,
        result = EXCLUDED.result,
        updated_at = EXCLUDED.updated_at`,
      [
        state.runId,
        state.parentRunId || null,
        state.rootRunId,
        state.sessionId,
        state.goalId || null,
        state.taskId || null,
        state.task,
        state.status,
        state.currentTurn,
        JSON.stringify(state.budget || {}),
        JSON.stringify(state.usage || DEFAULT_RUN_USAGE),
        JSON.stringify(state.idempotencyKeys || []),
        state.terminationReason || null,
        state.error ? JSON.stringify(state.error) : null,
        state.result || null,
        state.createdAt,
        state.updatedAt
      ]
    );
  }

  async get(runId: string): Promise<RunState | null> {
    const res = await this.db.query('SELECT * FROM runs WHERE run_id = $1', [runId]);
    if (res.rows.length === 0) return null;
    return this.mapRun(res.rows[0]);
  }

  async update(runId: string, updates: Partial<RunState>): Promise<void> {
    const existing = await this.get(runId);
    if (!existing) throw new Error(`Run not found: ${runId}`);
    const merged: RunState = { ...existing, ...updates, updatedAt: Date.now() };
    await this.save(merged);
  }

  async list(sessionId?: string, limit = 50): Promise<RunState[]> {
    let sql = 'SELECT * FROM runs';
    const params: any[] = [];
    if (sessionId) {
      sql += ' WHERE session_id = $1';
      params.push(sessionId);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    const res = await this.db.query(sql, params);
    return res.rows.map(this.mapRun);
  }

  async listByGoal(goalId: string): Promise<RunState[]> {
    const res = await this.db.query('SELECT * FROM runs WHERE goal_id = $1 ORDER BY created_at DESC', [goalId]);
    return res.rows.map(this.mapRun);
  }

  async listByStatus(status: RunStatus): Promise<RunState[]> {
    const res = await this.db.query('SELECT * FROM runs WHERE status = $1 ORDER BY created_at DESC', [status]);
    return res.rows.map(this.mapRun);
  }

  private mapRun(row: any): RunState {
    return {
      runId: row.run_id,
      parentRunId: row.parent_run_id || undefined,
      rootRunId: row.root_run_id,
      sessionId: row.session_id,
      goalId: row.goal_id || undefined,
      taskId: row.task_id || undefined,
      task: row.task,
      status: row.status as RunStatus,
      currentTurn: row.current_turn,
      budget: parseJson(row.budget, {}),
      usage: parseJson(row.usage, { ...DEFAULT_RUN_USAGE }),
      idempotencyKeys: parseJson(row.idempotency_keys, []),
      terminationReason: row.termination_reason || undefined,
      error: parseJson(row.error, undefined),
      result: row.result || undefined,
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresEventStore implements EventStore {
  constructor(private db: PostgresDatabase) {}

  async saveRunEvent(event: AgentEvent): Promise<void> {
    const id = `ev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    await this.db.query(
      `INSERT INTO event_log (id, topic, payload, timestamp, published)
       VALUES ($1, $2, $3, $4, 1)`,
      [id, (event as any).type || 'agent_event', JSON.stringify(event), (event as any).timestamp || Date.now()]
    );
  }

  async getRunEvents(runId: string): Promise<AgentEvent[]> {
    const res = await this.db.query(
      `SELECT payload FROM event_log WHERE payload LIKE $1 ORDER BY timestamp ASC`,
      [`%"runId":"${runId}"%`]
    );
    return res.rows.map(r => JSON.parse(r.payload));
  }
}

export class PostgresGoalStore implements GoalStore {
  constructor(private db: PostgresDatabase) {}

  async get(id: string): Promise<Goal | null> {
    const res = await this.db.query('SELECT * FROM goals WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapGoal(res.rows[0]);
  }

  async save(goal: Goal): Promise<Goal> {
    const now = Date.now();
    const createdAt = goal.createdAt || now;
    const updatedAt = goal.updatedAt !== undefined ? goal.updatedAt : now;
    const saved: Goal = { ...goal, createdAt, updatedAt };

    await this.db.query(
      `INSERT INTO goals (
        id, workspace_id, project_id, title, description, status,
        priority, deadline, progress, dependencies, artifacts, budget,
        usage, metadata, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT(id) DO UPDATE SET
        workspace_id = EXCLUDED.workspace_id,
        project_id = EXCLUDED.project_id,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        deadline = EXCLUDED.deadline,
        progress = EXCLUDED.progress,
        dependencies = EXCLUDED.dependencies,
        artifacts = EXCLUDED.artifacts,
        budget = EXCLUDED.budget,
        usage = EXCLUDED.usage,
        metadata = EXCLUDED.metadata,
        updated_at = EXCLUDED.updated_at`,
      [
        saved.id,
        saved.workspaceId ?? null,
        saved.projectId ?? null,
        saved.title,
        saved.description || null,
        saved.status,
        saved.priority,
        saved.deadline ?? null,
        saved.progress,
        JSON.stringify(saved.dependencies || []),
        JSON.stringify(saved.artifacts || []),
        JSON.stringify(saved.budget || {}),
        JSON.stringify(saved.usage || createInitialGoalUsage()),
        JSON.stringify(saved.metadata || null),
        saved.createdAt,
        saved.updatedAt
      ]
    );

    return saved;
  }

  async update(id: string, updates: Partial<Goal>): Promise<Goal> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Goal not found: ${id}`);
    const merged: Goal = { ...existing, ...updates, updatedAt: Date.now() };
    return this.save(merged);
  }

  async list(filter?: { workspaceId?: number; status?: GoalStatus; limit?: number }): Promise<Goal[]> {
    let sql = 'SELECT * FROM goals WHERE 1=1';
    const params: any[] = [];
    if (filter?.workspaceId !== undefined) {
      sql += ` AND workspace_id = $${params.length + 1}`;
      params.push(filter.workspaceId);
    }
    if (filter?.status) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(filter.status);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(filter?.limit || 50);
    const res = await this.db.query(sql, params);
    return res.rows.map(this.mapGoal);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM goals WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapGoal(row: any): Goal {
    return {
      id: row.id,
      workspaceId: row.workspace_id !== null ? parseInt(row.workspace_id, 10) : null,
      projectId: row.project_id !== null ? parseInt(row.project_id, 10) : null,
      title: row.title,
      description: row.description || undefined,
      status: row.status as GoalStatus,
      priority: row.priority || 'normal',
      deadline: row.deadline !== null ? parseInt(row.deadline, 10) : null,
      progress: parseFloat(row.progress) || 0.0,
      dependencies: parseJson(row.dependencies, []),
      artifacts: parseJson(row.artifacts, []),
      budget: parseJson(row.budget, {}),
      usage: parseJson(row.usage, createInitialGoalUsage()),
      metadata: parseJson(row.metadata, undefined),
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresTaskStore implements TaskStore {
  constructor(private db: PostgresDatabase) {}

  async get(id: string): Promise<Task | null> {
    const res = await this.db.query('SELECT * FROM tasks WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapTask(res.rows[0]);
  }

  async save(task: Task): Promise<Task> {
    const now = Date.now();
    const createdAt = task.createdAt || now;
    const updatedAt = now;
    const saved: Task = { ...task, createdAt, updatedAt };

    await this.db.query(
      `INSERT INTO tasks (
        id, goal_id, parent_task_id, title, description, status,
        priority, dependencies, assigned_agent_id, attempts,
        max_attempts, result, error, recurring, delegated,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT(id) DO UPDATE SET
        goal_id = EXCLUDED.goal_id,
        parent_task_id = EXCLUDED.parent_task_id,
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        priority = EXCLUDED.priority,
        dependencies = EXCLUDED.dependencies,
        assigned_agent_id = EXCLUDED.assigned_agent_id,
        attempts = EXCLUDED.attempts,
        max_attempts = EXCLUDED.max_attempts,
        result = EXCLUDED.result,
        error = EXCLUDED.error,
        recurring = EXCLUDED.recurring,
        delegated = EXCLUDED.delegated,
        updated_at = EXCLUDED.updated_at`,
      [
        saved.id,
        saved.goalId,
        saved.parentTaskId || null,
        saved.title,
        saved.description || null,
        saved.status,
        saved.priority,
        JSON.stringify(saved.dependencies || []),
        saved.assignedAgentId || null,
        saved.attempts ?? 0,
        saved.maxAttempts ?? 3,
        saved.result ? JSON.stringify(saved.result) : null,
        saved.error || null,
        saved.recurring ? JSON.stringify(saved.recurring) : null,
        saved.delegated ? 1 : 0,
        saved.createdAt,
        saved.updatedAt
      ]
    );

    return saved;
  }

  async update(id: string, updates: Partial<Task>): Promise<Task> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`Task not found: ${id}`);
    const merged: Task = { ...existing, ...updates, updatedAt: Date.now() };
    return this.save(merged);
  }

  async listByGoal(goalId: string): Promise<Task[]> {
    const res = await this.db.query('SELECT * FROM tasks WHERE goal_id = $1 ORDER BY created_at ASC', [goalId]);
    return res.rows.map(this.mapTask);
  }

  async getReadyTasks(goalId: string): Promise<Task[]> {
    const tasks = await this.listByGoal(goalId);
    const completedIds = new Set(tasks.filter(t => t.status === 'completed').map(t => t.id));
    return tasks.filter(t => t.status === 'pending' && (!t.dependencies || t.dependencies.every(dep => completedIds.has(dep))));
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM tasks WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapTask(row: any): Task {
    return {
      id: row.id,
      goalId: row.goal_id,
      parentTaskId: row.parent_task_id || null,
      title: row.title,
      description: row.description || undefined,
      status: row.status as TaskStatus,
      priority: (row.priority || 'normal') as GoalPriority,
      dependencies: parseJson(row.dependencies, []),
      assignedAgentId: row.assigned_agent_id || null,
      attempts: row.attempts !== undefined ? parseInt(row.attempts, 10) : 0,
      maxAttempts: row.max_attempts !== undefined ? parseInt(row.max_attempts, 10) : 3,
      result: parseJson(row.result, null),
      error: row.error || null,
      recurring: parseJson(row.recurring, null),
      delegated: Boolean(row.delegated),
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresRunWaitStore implements RunWaitStore {
  constructor(private db: PostgresDatabase) {}

  async create(wait: RunWait): Promise<RunWait> {
    const now = Date.now();
    const saved: RunWait = {
      ...wait,
      createdAt: wait.createdAt || now,
      updatedAt: now
    };

    await this.db.query(
      `INSERT INTO run_waits (
        id, run_id, wait_type, status, event_pattern,
        matcher_criteria, deadline, wait_result, metadata,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT(id) DO UPDATE SET
        status = EXCLUDED.status,
        wait_result = EXCLUDED.wait_result,
        updated_at = EXCLUDED.updated_at`,
      [
        saved.id,
        saved.runId,
        saved.waitType,
        saved.status,
        saved.eventPattern || null,
        saved.matcherCriteria ? JSON.stringify(saved.matcherCriteria) : null,
        saved.deadline ?? null,
        saved.waitResult ? JSON.stringify(saved.waitResult) : null,
        saved.metadata ? JSON.stringify(saved.metadata) : null,
        saved.createdAt,
        saved.updatedAt
      ]
    );

    return saved;
  }

  async get(id: string): Promise<RunWait | null> {
    const res = await this.db.query('SELECT * FROM run_waits WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapRunWait(res.rows[0]);
  }

  async getByRunId(runId: string): Promise<RunWait | null> {
    const res = await this.db.query('SELECT * FROM run_waits WHERE run_id = $1 ORDER BY created_at DESC LIMIT 1', [runId]);
    if (res.rows.length === 0) return null;
    return this.mapRunWait(res.rows[0]);
  }

  async listActive(): Promise<RunWait[]> {
    const res = await this.db.query("SELECT * FROM run_waits WHERE status = 'waiting' ORDER BY created_at ASC");
    return res.rows.map(this.mapRunWait);
  }

  async update(id: string, updates: Partial<RunWait>): Promise<RunWait> {
    const existing = await this.get(id);
    if (!existing) throw new Error(`RunWait not found: ${id}`);
    const merged = { ...existing, ...updates, updatedAt: Date.now() };
    await this.create(merged);
    return merged;
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM run_waits WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapRunWait(row: any): RunWait {
    return {
      id: row.id,
      runId: row.run_id,
      waitType: row.wait_type as WaitType,
      status: row.status as WaitStatus,
      eventPattern: row.event_pattern || null,
      matcherCriteria: parseJson(row.matcher_criteria, null),
      deadline: row.deadline !== null ? parseInt(row.deadline, 10) : null,
      waitResult: parseJson(row.wait_result, undefined),
      metadata: parseJson(row.metadata, null),
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresMemoryStore implements MemoryStore {
  constructor(private db: PostgresDatabase) {}

  async save(item: Omit<ScopedMemoryItem, 'id' | 'createdAt' | 'updatedAt'>): Promise<number> {
    const now = Date.now();
    const tagsStr = item.tags && item.tags.length > 0 ? item.tags.join(',') : null;
    const confidence = item.confidence !== undefined ? Math.max(0.0, Math.min(1.0, item.confidence)) : 1.0;
    const embeddingStr = item.embedding ? JSON.stringify(item.embedding) : null;
    const memoryType = item.type || 'fact';
    const securityStatus = item.securityStatus || 'clean';

    const res = await this.db.query(
      `INSERT INTO scoped_memory (
        scope, fact, tags, confidence, lifecycle, provenance, session_id,
        workspace_id, project_id, agent_id, embedding, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id`,
      [
        item.scope,
        item.fact,
        tagsStr,
        confidence,
        item.lifecycle,
        JSON.stringify(item.provenance || { source: 'user_input', timestamp: now }),
        item.provenance?.sessionId || null,
        item.workspaceId ?? null,
        item.projectId ?? null,
        item.agentId ?? null,
        embeddingStr,
        now,
        now
      ]
    );
    return parseInt(res.rows[0].id, 10);
  }

  async get(id: number): Promise<ScopedMemoryItem | null> {
    const res = await this.db.query('SELECT * FROM scoped_memory WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapItem(res.rows[0]);
  }

  async updateLifecycle(id: number, lifecycle: MemoryLifecycle, supersededBy?: number): Promise<void> {
    await this.db.query('UPDATE scoped_memory SET lifecycle = $1, updated_at = $2 WHERE id = $3', [lifecycle, Date.now(), id]);
  }

  async validate(id: number, evidence?: string): Promise<void> {
    await this.db.query('UPDATE scoped_memory SET confidence = LEAST(1.0, confidence + 0.1), updated_at = $1 WHERE id = $2', [Date.now(), id]);
  }

  async reinforce(id: number, delta = 0.1): Promise<void> {
    await this.db.query('UPDATE scoped_memory SET confidence = LEAST(1.0, confidence + $1), updated_at = $2 WHERE id = $3', [delta, Date.now(), id]);
  }

  async contradict(id: number, evidence?: string): Promise<void> {
    await this.db.query('UPDATE scoped_memory SET confidence = GREATEST(0.0, confidence - 0.2), updated_at = $1 WHERE id = $2', [Date.now(), id]);
  }

  async quarantine(id: number, reason: string): Promise<void> {
    await this.updateLifecycle(id, 'quarantined');
  }

  async search(params: any): Promise<ScopedMemoryItem[]> {
    let sql = 'SELECT * FROM scoped_memory WHERE 1=1';
    const sqlParams: any[] = [];
    if (!params.includeQuarantined) {
      sql += " AND lifecycle != 'quarantined'";
    }
    if (params.query) {
      sql += ` AND fact ILIKE $${sqlParams.length + 1}`;
      sqlParams.push(`%${params.query}%`);
    }
    sql += ` ORDER BY updated_at DESC LIMIT $${sqlParams.length + 1}`;
    sqlParams.push(params.limit || 20);
    const res = await this.db.query(sql, sqlParams);
    return res.rows.map(this.mapItem);
  }

  async inspect(query?: string, scope?: any, limit = 50): Promise<ScopedMemoryItem[]> {
    return this.search({ query, scope, limit, includeQuarantined: true });
  }

  async delete(id: number): Promise<void> {
    await this.db.query('DELETE FROM scoped_memory WHERE id = $1', [id]);
  }

  private mapItem(row: any): ScopedMemoryItem {
    return {
      id: parseInt(row.id, 10),
      scope: row.scope,
      type: row.type || 'fact',
      fact: row.fact,
      tags: row.tags ? (typeof row.tags === 'string' ? row.tags.split(',') : row.tags) : [],
      confidence: parseFloat(row.confidence),
      lifecycle: row.lifecycle,
      provenance: row.provenance ? parseJson(row.provenance, { source: 'user_input', timestamp: parseInt(row.created_at, 10) }) : { source: 'user_input', timestamp: parseInt(row.created_at, 10) },
      workspaceId: row.workspace_id ? parseInt(row.workspace_id, 10) : undefined,
      projectId: row.project_id ? parseInt(row.project_id, 10) : undefined,
      agentId: row.agent_id || undefined,
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresSessionSearchStore implements SessionSearchStore {
  constructor(private db: PostgresDatabase) {}

  async indexEntry(entry: SessionSearchEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO session_search (id, category, content_text, session_id, run_id, goal_id, task_id, workspace_id, project_id, agent_id, metadata, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        entry.id,
        entry.category,
        entry.contentText,
        entry.sessionId || null,
        entry.runId || null,
        entry.goalId || null,
        entry.taskId || null,
        entry.workspaceId || null,
        entry.projectId || null,
        entry.agentId || null,
        JSON.stringify(entry.metadata || {}),
        entry.timestamp || Date.now()
      ]
    );
  }

  async search(filter: SessionSearchFilter): Promise<SessionSearchResult[]> {
    let sql = 'SELECT * FROM session_search WHERE 1=1';
    const params: any[] = [];
    if (filter.query) {
      sql += ` AND content_text ILIKE $${params.length + 1}`;
      params.push(`%${filter.query}%`);
    }
    if (filter.sessionId) {
      sql += ` AND session_id = $${params.length + 1}`;
      params.push(filter.sessionId);
    }
    sql += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
    params.push(filter.limit || 50);
    const res = await this.db.query(sql, params);
    return res.rows.map(r => ({
      id: r.id,
      category: r.category,
      contentText: r.content_text,
      sessionId: r.session_id || undefined,
      runId: r.run_id || undefined,
      goalId: r.goal_id || undefined,
      taskId: r.task_id || undefined,
      workspaceId: r.workspace_id ? parseInt(r.workspace_id, 10) : undefined,
      projectId: r.project_id ? parseInt(r.project_id, 10) : undefined,
      agentId: r.agent_id || undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
      timestamp: parseInt(r.timestamp, 10)
    }));
  }

  async deleteByRun(runId: string): Promise<void> {
    await this.db.query('DELETE FROM session_search WHERE run_id = $1', [runId]);
  }

  async deleteBySession(sessionId: string): Promise<void> {
    await this.db.query('DELETE FROM session_search WHERE session_id = $1', [sessionId]);
  }
}

export class PostgresVectorStore implements VectorStore {
  constructor(private db: PostgresDatabase) {}

  async upsert(record: VectorEmbeddingRecord): Promise<void> {
    const now = Date.now();
    await this.db.query(
      `INSERT INTO vector_embeddings (id, namespace, ref_id, text, embedding, dims, model, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         namespace = EXCLUDED.namespace,
         ref_id = EXCLUDED.ref_id,
         text = EXCLUDED.text,
         embedding = EXCLUDED.embedding,
         dims = EXCLUDED.dims,
         model = EXCLUDED.model,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.namespace,
        record.refId || null,
        record.text,
        JSON.stringify(record.embedding),
        record.dims,
        record.model,
        JSON.stringify(record.metadata || {}),
        record.createdAt || now,
        now
      ]
    );
  }

  async get(id: string): Promise<VectorEmbeddingRecord | null> {
    const res = await this.db.query('SELECT * FROM vector_embeddings WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    const r = res.rows[0];
    return {
      id: r.id,
      namespace: r.namespace,
      refId: r.ref_id || undefined,
      text: r.text,
      embedding: JSON.parse(r.embedding),
      dims: r.dims,
      model: r.model,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
      createdAt: parseInt(r.created_at, 10),
      updatedAt: parseInt(r.updated_at, 10)
    };
  }

  async delete(id: string): Promise<void> {
    await this.db.query('DELETE FROM vector_embeddings WHERE id = $1', [id]);
  }

  async deleteByRef(refId: string): Promise<void> {
    await this.db.query('DELETE FROM vector_embeddings WHERE ref_id = $1', [refId]);
  }

  async deleteByNamespace(namespace: string): Promise<void> {
    await this.db.query('DELETE FROM vector_embeddings WHERE namespace = $1', [namespace]);
  }

  async search(queryEmbedding: number[], options?: VectorSearchOptions): Promise<VectorSearchResult[]> {
    let sql = 'SELECT * FROM vector_embeddings WHERE 1=1';
    const params: any[] = [];
    if (options?.namespace) {
      sql += ` AND namespace = $${params.length + 1}`;
      params.push(options.namespace);
    }
    if (options?.refId) {
      sql += ` AND ref_id = $${params.length + 1}`;
      params.push(options.refId);
    }
    const res = await this.db.query(sql, params);
    const results: VectorSearchResult[] = [];

    for (const r of res.rows) {
      const vec: number[] = JSON.parse(r.embedding);
      let dot = 0;
      let magA = 0;
      let magB = 0;
      for (let i = 0; i < Math.min(vec.length, queryEmbedding.length); i++) {
        dot += vec[i] * queryEmbedding[i];
        magA += vec[i] * vec[i];
        magB += queryEmbedding[i] * queryEmbedding[i];
      }
      const score = (magA > 0 && magB > 0) ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
      if (options?.threshold === undefined || score >= options.threshold) {
        results.push({
          id: r.id,
          namespace: r.namespace,
          refId: r.ref_id || undefined,
          text: r.text,
          score,
          metadata: r.metadata ? JSON.parse(r.metadata) : {}
        });
      }
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options?.limit || 10);
  }

  async count(namespace?: string): Promise<number> {
    let sql = 'SELECT COUNT(*) as count FROM vector_embeddings';
    const params: any[] = [];
    if (namespace) {
      sql += ' WHERE namespace = $1';
      params.push(namespace);
    }
    const res = await this.db.query(sql, params);
    return parseInt(res.rows[0]?.count || '0', 10);
  }
}

export class PostgresResearchDocumentStore implements ResearchDocumentStore {
  constructor(private db: PostgresDatabase) {}

  async save(doc: ResearchDocument): Promise<ResearchDocument> {
    const now = Date.now();
    await this.db.query(
      `INSERT INTO research_documents (id, source_type, source_uri, title, format, content_hash, chunk_count, char_count, workspace_id, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id) DO UPDATE SET
         source_type = EXCLUDED.source_type,
         source_uri = EXCLUDED.source_uri,
         title = EXCLUDED.title,
         format = EXCLUDED.format,
         content_hash = EXCLUDED.content_hash,
         chunk_count = EXCLUDED.chunk_count,
         char_count = EXCLUDED.char_count,
         workspace_id = EXCLUDED.workspace_id,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        doc.id,
        doc.sourceType,
        doc.sourceUri,
        doc.title || null,
        doc.format || null,
        doc.contentHash,
        doc.chunkCount,
        doc.charCount,
        doc.workspaceId || null,
        JSON.stringify(doc.metadata || {}),
        doc.createdAt || now,
        now
      ]
    );
    return { ...doc, updatedAt: now };
  }

  async get(id: string): Promise<ResearchDocument | null> {
    const res = await this.db.query('SELECT * FROM research_documents WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapDoc(res.rows[0]);
  }

  async findBySourceUri(uri: string): Promise<ResearchDocument | null> {
    const res = await this.db.query('SELECT * FROM research_documents WHERE source_uri = $1 LIMIT 1', [uri]);
    if (res.rows.length === 0) return null;
    return this.mapDoc(res.rows[0]);
  }

  async findByHash(hash: string): Promise<ResearchDocument | null> {
    const res = await this.db.query('SELECT * FROM research_documents WHERE content_hash = $1 LIMIT 1', [hash]);
    if (res.rows.length === 0) return null;
    return this.mapDoc(res.rows[0]);
  }

  async list(filter?: { workspaceId?: number; sourceType?: string; limit?: number }): Promise<ResearchDocument[]> {
    let sql = 'SELECT * FROM research_documents WHERE 1=1';
    const params: any[] = [];
    if (filter?.workspaceId !== undefined) {
      sql += ` AND workspace_id = $${params.length + 1}`;
      params.push(filter.workspaceId);
    }
    if (filter?.sourceType) {
      sql += ` AND source_type = $${params.length + 1}`;
      params.push(filter.sourceType);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(filter?.limit || 50);
    const res = await this.db.query(sql, params);
    return res.rows.map(this.mapDoc);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM research_documents WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapDoc(row: any): ResearchDocument {
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceUri: row.source_uri,
      title: row.title || undefined,
      format: row.format || undefined,
      contentHash: row.content_hash,
      chunkCount: row.chunk_count,
      charCount: row.char_count,
      workspaceId: row.workspace_id ? parseInt(row.workspace_id, 10) : undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresApprovalStore implements ApprovalStore {
  constructor(private db: PostgresDatabase) {}

  async createRequest(req: ApprovalRequest): Promise<ApprovalRequest> {
    await this.db.query(
      `INSERT INTO approvals (id, action, risk_level, explanation, proposed_action, status, channel_id, run_id, goal_id, task_id, expires_at, created_at, resolved_at, resolution_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        req.id,
        req.action,
        req.riskLevel,
        req.explanation,
        typeof req.proposedAction === 'string' ? req.proposedAction : JSON.stringify(req.proposedAction),
        req.status,
        req.channelId || null,
        req.runId || null,
        req.goalId || null,
        req.taskId || null,
        req.expiresAt || null,
        req.createdAt,
        req.resolvedAt || null,
        req.resolutionReason || null
      ]
    );
    return req;
  }

  async getRequest(id: string): Promise<ApprovalRequest | null> {
    const res = await this.db.query('SELECT * FROM approvals WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapApproval(res.rows[0]);
  }

  async resolveRequest(id: string, status: 'approved' | 'rejected', reason?: string): Promise<ApprovalRequest | null> {
    const now = Date.now();
    const res = await this.db.query(
      `UPDATE approvals SET status = $1, resolved_at = $2, resolution_reason = $3
       WHERE id = $4 AND status = 'pending' RETURNING *`,
      [status, now, reason || null, id]
    );
    if (res.rows.length === 0) return null;
    return this.mapApproval(res.rows[0]);
  }

  async listPending(filter?: { runId?: string; goalId?: string; limit?: number }): Promise<ApprovalRequest[]> {
    let sql = "SELECT * FROM approvals WHERE status = 'pending'";
    const params: any[] = [];
    if (filter?.runId) {
      sql += ` AND run_id = $${params.length + 1}`;
      params.push(filter.runId);
    }
    if (filter?.goalId) {
      sql += ` AND goal_id = $${params.length + 1}`;
      params.push(filter.goalId);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(filter?.limit || 50);
    const res = await this.db.query(sql, params);
    return res.rows.map(this.mapApproval);
  }

  async listAll(filter?: { status?: any; runId?: string; limit?: number }): Promise<ApprovalRequest[]> {
    let sql = 'SELECT * FROM approvals WHERE 1=1';
    const params: any[] = [];
    if (filter?.status) {
      sql += ` AND status = $${params.length + 1}`;
      params.push(filter.status);
    }
    if (filter?.runId) {
      sql += ` AND run_id = $${params.length + 1}`;
      params.push(filter.runId);
    }
    sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(filter?.limit || 50);
    const res = await this.db.query(sql, params);
    return res.rows.map(this.mapApproval);
  }

  private mapApproval(row: any): ApprovalRequest {
    let proposed = row.proposed_action;
    try { proposed = JSON.parse(proposed); } catch { /* keep raw */ }
    return {
      id: row.id,
      action: row.action,
      riskLevel: row.risk_level,
      explanation: row.explanation,
      proposedAction: proposed,
      status: row.status,
      channelId: row.channel_id || undefined,
      runId: row.run_id || undefined,
      goalId: row.goal_id || undefined,
      taskId: row.task_id || undefined,
      expiresAt: row.expires_at ? parseInt(row.expires_at, 10) : undefined,
      createdAt: parseInt(row.created_at, 10),
      resolvedAt: row.resolved_at ? parseInt(row.resolved_at, 10) : undefined,
      resolutionReason: row.resolution_reason || undefined
    };
  }
}

export class PostgresArtifactStore implements ArtifactStore {
  constructor(private db: PostgresDatabase) {}

  async saveArtifact(artifact: any): Promise<Artifact> {
    const now = Date.now();
    const existing = await this.getArtifact(artifact.id);
    const currentVersion = existing ? existing.currentVersion + 1 : (artifact.currentVersion || 1);
    const createdAt = existing ? existing.createdAt : (artifact.createdAt || now);

    const saved: Artifact = {
      ...artifact,
      currentVersion,
      createdAt,
      updatedAt: now
    };

    await this.db.query(
      `INSERT INTO artifacts (id, name, type, mime_type, current_version, content_hash, file_path, content_text, agent_id, run_id, goal_id, task_id, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         type = EXCLUDED.type,
         mime_type = EXCLUDED.mime_type,
         current_version = EXCLUDED.current_version,
         content_hash = EXCLUDED.content_hash,
         file_path = EXCLUDED.file_path,
         content_text = EXCLUDED.content_text,
         metadata = EXCLUDED.metadata,
         updated_at = EXCLUDED.updated_at`,
      [
        saved.id,
        saved.name,
        saved.type,
        saved.mimeType,
        saved.currentVersion,
        saved.contentHash,
        saved.filePath || null,
        saved.contentText || null,
        saved.agentId || null,
        saved.runId || null,
        saved.goalId || null,
        saved.taskId || null,
        JSON.stringify(saved.metadata || {}),
        saved.createdAt,
        saved.updatedAt
      ]
    );

    await this.saveVersion({
      id: `ver_${saved.id}_${saved.currentVersion}`,
      artifactId: saved.id,
      version: saved.currentVersion,
      contentHash: saved.contentHash,
      filePath: saved.filePath,
      contentText: saved.contentText,
      metadata: saved.metadata,
      createdAt: now
    });

    return saved;
  }

  async getArtifact(id: string): Promise<Artifact | null> {
    const res = await this.db.query('SELECT * FROM artifacts WHERE id = $1', [id]);
    if (res.rows.length === 0) return null;
    return this.mapArtifact(res.rows[0]);
  }

  async getArtifactByName(name: string): Promise<Artifact | null> {
    const res = await this.db.query('SELECT * FROM artifacts WHERE name = $1 LIMIT 1', [name]);
    if (res.rows.length === 0) return null;
    return this.mapArtifact(res.rows[0]);
  }

  async saveVersion(version: ArtifactVersion): Promise<ArtifactVersion> {
    await this.db.query(
      `INSERT INTO artifact_versions (id, artifact_id, version, content_hash, file_path, content_text, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO NOTHING`,
      [
        version.id,
        version.artifactId,
        version.version,
        version.contentHash,
        version.filePath || null,
        version.contentText || null,
        JSON.stringify(version.metadata || {}),
        version.createdAt
      ]
    );
    return version;
  }

  async listVersions(artifactId: string): Promise<ArtifactVersion[]> {
    const res = await this.db.query('SELECT * FROM artifact_versions WHERE artifact_id = $1 ORDER BY version ASC', [artifactId]);
    return res.rows.map(r => ({
      id: r.id,
      artifactId: r.artifact_id,
      version: r.version,
      contentHash: r.content_hash,
      filePath: r.file_path || undefined,
      contentText: r.content_text || undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
      createdAt: parseInt(r.created_at, 10)
    }));
  }

  async listArtifacts(filter?: { type?: any; runId?: string; goalId?: string; limit?: number }): Promise<Artifact[]> {
    let sql = 'SELECT * FROM artifacts WHERE 1=1';
    const params: any[] = [];
    if (filter?.type) {
      sql += ` AND type = $${params.length + 1}`;
      params.push(filter.type);
    }
    if (filter?.runId) {
      sql += ` AND run_id = $${params.length + 1}`;
      params.push(filter.runId);
    }
    if (filter?.goalId) {
      sql += ` AND goal_id = $${params.length + 1}`;
      params.push(filter.goalId);
    }
    sql += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
    params.push(filter?.limit || 50);
    const res = await this.db.query(sql, params);
    return res.rows.map(this.mapArtifact);
  }

  async deleteArtifact(id: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM artifacts WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }

  private mapArtifact(row: any): Artifact {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      mimeType: row.mime_type,
      currentVersion: row.current_version,
      contentHash: row.content_hash,
      filePath: row.file_path || undefined,
      contentText: row.content_text || undefined,
      agentId: row.agent_id || undefined,
      runId: row.run_id || undefined,
      goalId: row.goal_id || undefined,
      taskId: row.task_id || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : {},
      createdAt: parseInt(row.created_at, 10),
      updatedAt: parseInt(row.updated_at, 10)
    };
  }
}

export class PostgresReplayStore implements ReplayStore {
  constructor(private db: PostgresDatabase) {}

  async recordStep(entry: ReplayLogEntry): Promise<ReplayLogEntry> {
    await this.db.query(
      `INSERT INTO replay_logs (id, run_id, step_index, model_input, model_output, tool_calls, tool_outputs, state_diff, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        entry.id,
        entry.runId,
        entry.stepIndex,
        entry.modelInput ? JSON.stringify(entry.modelInput) : null,
        entry.modelOutput ? JSON.stringify(entry.modelOutput) : null,
        entry.toolCalls ? JSON.stringify(entry.toolCalls) : null,
        entry.toolOutputs ? JSON.stringify(entry.toolOutputs) : null,
        entry.stateDiff ? JSON.stringify(entry.stateDiff) : null,
        entry.timestamp || Date.now()
      ]
    );
    return entry;
  }

  async getSteps(runId: string): Promise<ReplayLogEntry[]> {
    const res = await this.db.query('SELECT * FROM replay_logs WHERE run_id = $1 ORDER BY step_index ASC', [runId]);
    return res.rows.map(r => ({
      id: r.id,
      runId: r.run_id,
      stepIndex: r.step_index,
      modelInput: r.model_input ? JSON.parse(r.model_input) : undefined,
      modelOutput: r.model_output ? JSON.parse(r.model_output) : undefined,
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      toolOutputs: r.tool_outputs ? JSON.parse(r.tool_outputs) : undefined,
      stateDiff: r.state_diff ? JSON.parse(r.state_diff) : undefined,
      timestamp: parseInt(r.timestamp, 10)
    }));
  }

  async clear(runId: string): Promise<boolean> {
    const res = await this.db.query('DELETE FROM replay_logs WHERE run_id = $1', [runId]);
    return (res.rowCount ?? 0) > 0;
  }
}

export interface PostgresStores {
  agent: PostgresAgentStore;
  user: PostgresUserStore;
  workspace: PostgresWorkspaceStore;
  project: PostgresProjectStore;
  run: PostgresRunStore;
  event: PostgresEventStore;
  goal: PostgresGoalStore;
  task: PostgresTaskStore;
  runWait: PostgresRunWaitStore;
  memory: PostgresMemoryStore;
  sessionSearch: PostgresSessionSearchStore;
  vector: PostgresVectorStore;
  researchDocument: PostgresResearchDocumentStore;
  approval: PostgresApprovalStore;
  artifact: PostgresArtifactStore;
  replay: PostgresReplayStore;
}

export function createPostgresStores(db: PostgresDatabase): PostgresStores {
  return {
    agent: new PostgresAgentStore(db),
    user: new PostgresUserStore(db),
    workspace: new PostgresWorkspaceStore(db),
    project: new PostgresProjectStore(db),
    run: new PostgresRunStore(db),
    event: new PostgresEventStore(db),
    goal: new PostgresGoalStore(db),
    task: new PostgresTaskStore(db),
    runWait: new PostgresRunWaitStore(db),
    memory: new PostgresMemoryStore(db),
    sessionSearch: new PostgresSessionSearchStore(db),
    vector: new PostgresVectorStore(db),
    researchDocument: new PostgresResearchDocumentStore(db),
    approval: new PostgresApprovalStore(db),
    artifact: new PostgresArtifactStore(db),
    replay: new PostgresReplayStore(db),
  };
}
