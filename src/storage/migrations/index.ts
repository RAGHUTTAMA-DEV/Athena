import { Database } from 'sqlite';

/**
 * Athena versioned migrations.
 *
 * Each migration has a monotonically increasing version. The runner
 * (src/storage/database.ts) applies migrations with version > PRAGMA user_version
 * inside one transaction per migration and records them in schema_migrations.
 *
 * Migration 1 ("v1_baseline") reproduces the Athena V1 schema exactly as the
 * V1 code created it (idempotent DDL). It exists so that:
 *   - fresh databases get the full V1 schema through the migration runner, and
 *   - populated V1 databases (user_version = 0, tables already present)
 *     pass through it as a no-op and land on the same baseline.
 *
 * Migration 2 ("v2_p1_agent_foundation") adds the V2 P1 entities:
 * workspaces, projects, users, agent_profiles, agent_profile_versions,
 * and binds scoped_memory rows to workspace/project/agent (nullable;
 * NULL = cross-workspace, which preserves V1 visibility semantics).
 */

export interface Migration {
  version: number;
  name: string;
  up: (db: Database) => Promise<void>;
}

/** Execute DDL that may already be applied (ALTER TABLE ADD COLUMN etc.). */
async function tryExec(db: Database, sql: string): Promise<void> {
  try {
    await db.exec(sql);
  } catch {
    // Idempotent guard: column/table/index already exists.
  }
}

const V1_BASELINE_DDL = `
  CREATE TABLE IF NOT EXISTS episodic_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_episodic_session ON episodic_memory(session_id);

  CREATE VIRTUAL TABLE IF NOT EXISTS episodic_fts USING fts5(
    session_id,
    role,
    content,
    content='episodic_memory',
    content_rowid='id'
  );

  CREATE TRIGGER IF NOT EXISTS episodic_ai AFTER INSERT ON episodic_memory BEGIN
    INSERT INTO episodic_fts(rowid, session_id, role, content)
    VALUES (new.id, new.session_id, new.role, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS episodic_ad AFTER DELETE ON episodic_memory BEGIN
    INSERT INTO episodic_fts(episodic_fts, rowid, session_id, role, content)
    VALUES ('delete', old.id, old.session_id, old.role, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS episodic_au AFTER UPDATE ON episodic_memory BEGIN
    INSERT INTO episodic_fts(episodic_fts, rowid, session_id, role, content)
    VALUES ('delete', old.id, old.session_id, old.role, old.content);
    INSERT INTO episodic_fts(rowid, session_id, role, content)
    VALUES (new.id, new.session_id, new.role, new.content);
  END;

  CREATE TABLE IF NOT EXISTS semantic_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fact TEXT NOT NULL,
    embedding TEXT NOT NULL,
    tags TEXT,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_semantic_timestamp ON semantic_memory(timestamp);

  CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    prompt TEXT NOT NULL,
    schedule TEXT NOT NULL,
    session_id TEXT NOT NULL,
    last_run INTEGER,
    next_run INTEGER NOT NULL,
    active INTEGER DEFAULT 1,
    timezone TEXT DEFAULT 'UTC',
    locked_by TEXT,
    locked_at INTEGER,
    lease_timeout_ms INTEGER DEFAULT 60000,
    priority TEXT DEFAULT 'normal'
  );

  CREATE TABLE IF NOT EXISTS event_log (
    id TEXT PRIMARY KEY,
    topic TEXT NOT NULL,
    idempotency_key TEXT,
    payload TEXT,
    status TEXT DEFAULT 'processed',
    source TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_event_log_topic ON event_log(topic);
  CREATE INDEX IF NOT EXISTS idx_event_log_idempotency ON event_log(idempotency_key);

  CREATE TABLE IF NOT EXISTS runs (
    run_id TEXT PRIMARY KEY,
    parent_run_id TEXT,
    root_run_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    task TEXT NOT NULL,
    status TEXT NOT NULL,
    current_turn INTEGER DEFAULT 0,
    budget TEXT,
    usage TEXT,
    idempotency_keys TEXT,
    termination_reason TEXT,
    error TEXT,
    result TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runs_session ON runs(session_id);
  CREATE INDEX IF NOT EXISTS idx_runs_parent ON runs(parent_run_id);
  CREATE INDEX IF NOT EXISTS idx_runs_root ON runs(root_run_id);
  CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

  CREATE TABLE IF NOT EXISTS run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    timestamp INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_run_events_run_id ON run_events(run_id);

  CREATE TABLE IF NOT EXISTS scoped_memory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    fact TEXT NOT NULL,
    tags TEXT,
    confidence REAL DEFAULT 1.0,
    lifecycle TEXT DEFAULT 'active',
    source TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    run_id TEXT,
    session_id TEXT,
    evidence TEXT,
    superseded_by INTEGER,
    embedding TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_scoped_scope ON scoped_memory(scope);
  CREATE INDEX IF NOT EXISTS idx_scoped_lifecycle ON scoped_memory(lifecycle);
  CREATE INDEX IF NOT EXISTS idx_scoped_session ON scoped_memory(session_id);
  CREATE INDEX IF NOT EXISTS idx_scoped_timestamp ON scoped_memory(timestamp);

  CREATE TABLE IF NOT EXISTS skill_registry (
    name TEXT PRIMARY KEY,
    version TEXT DEFAULT '1.0.0',
    description TEXT,
    tags TEXT,
    dependencies TEXT,
    invocations INTEGER DEFAULT 0,
    successes INTEGER DEFAULT 0,
    failures INTEGER DEFAULT 0,
    last_invoked INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`;

const migrationV1Baseline: Migration = {
  version: 1,
  name: 'v1_baseline',
  up: async (db) => {
    await db.exec(V1_BASELINE_DDL);

    // Column upgrades previously done inline by EpisodicMemory.init().
    for (const alter of [
      'ALTER TABLE episodic_memory ADD COLUMN consolidated INTEGER DEFAULT 0',
      "ALTER TABLE scheduled_jobs ADD COLUMN timezone TEXT DEFAULT 'UTC'",
      'ALTER TABLE scheduled_jobs ADD COLUMN locked_by TEXT',
      'ALTER TABLE scheduled_jobs ADD COLUMN locked_at INTEGER',
      'ALTER TABLE scheduled_jobs ADD COLUMN lease_timeout_ms INTEGER DEFAULT 60000',
      "ALTER TABLE scheduled_jobs ADD COLUMN priority TEXT DEFAULT 'normal'"
    ]) {
      await tryExec(db, alter);
    }

    // Legacy data backfill: unmigrated semantic_memory facts into scoped_memory.
    // Idempotent via the WHERE NOT IN guard.
    await tryExec(db, `
      INSERT INTO scoped_memory (
        scope, fact, tags, confidence, lifecycle, source, timestamp, created_at, updated_at, embedding
      )
      SELECT
        'user' AS scope,
        fact,
        tags,
        0.95 AS confidence,
        'active' AS lifecycle,
        'user' AS source,
        timestamp,
        timestamp AS created_at,
        timestamp AS updated_at,
        embedding
      FROM semantic_memory
      WHERE fact NOT IN (SELECT fact FROM scoped_memory);
    `);
  }
};

const migrationV2P1AgentFoundation: Migration = {
  version: 2,
  name: 'v2_p1_agent_foundation',
  up: async (db) => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL DEFAULT 'personal',
        root_path TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES workspaces(id),
        name TEXT NOT NULL,
        root_path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_workspace ON projects(workspace_id);

      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        preferences TEXT,
        permissions TEXT,
        relationships TEXT,
        routines TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        identity TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT '',
        personality TEXT NOT NULL DEFAULT '',
        capabilities TEXT,
        permissions TEXT,
        preferences TEXT,
        workspace_id INTEGER REFERENCES workspaces(id),
        memory_scope TEXT NOT NULL DEFAULT 'all',
        skills TEXT,
        routines TEXT,
        goals TEXT,
        model_policy TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_profiles_workspace ON agent_profiles(workspace_id);

      CREATE TABLE IF NOT EXISTS agent_profile_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        profile_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        changed_by TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agent_profile_versions_profile ON agent_profile_versions(profile_id, version);
    `);

    // Bind scoped memory to workspace/project/agent entities.
    // NULL = cross-workspace (preserves V1 visibility for pre-existing rows).
    for (const alter of [
      'ALTER TABLE scoped_memory ADD COLUMN workspace_id INTEGER REFERENCES workspaces(id)',
      'ALTER TABLE scoped_memory ADD COLUMN project_id INTEGER REFERENCES projects(id)',
      'ALTER TABLE scoped_memory ADD COLUMN agent_id TEXT'
    ]) {
      await tryExec(db, alter);
    }
    await tryExec(db, 'CREATE INDEX IF NOT EXISTS idx_scoped_workspace ON scoped_memory(workspace_id)');
    await tryExec(db, 'CREATE INDEX IF NOT EXISTS idx_scoped_project ON scoped_memory(project_id)');
  }
};

const migrationV2P2PersistentAutonomy: Migration = {
  version: 3,
  name: 'v2_p2_persistent_autonomy',
  up: async (db) => {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        workspace_id INTEGER REFERENCES workspaces(id),
        project_id INTEGER REFERENCES projects(id),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'proposed',
        priority TEXT NOT NULL DEFAULT 'normal',
        deadline INTEGER,
        progress REAL DEFAULT 0.0,
        dependencies TEXT,
        artifacts TEXT,
        budget TEXT,
        usage TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goals_workspace ON goals(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_goals_project ON goals(project_id);
      CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id),
        parent_task_id TEXT REFERENCES tasks(id),
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'normal',
        dependencies TEXT,
        assigned_agent_id TEXT REFERENCES agent_profiles(id),
        attempts INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 3,
        result TEXT,
        error TEXT,
        recurring TEXT,
        delegated INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_goal ON tasks(goal_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);

      CREATE TABLE IF NOT EXISTS run_waits (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        wait_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'waiting',
        event_pattern TEXT,
        matcher_criteria TEXT,
        deadline INTEGER,
        wait_result TEXT,
        metadata TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_run_waits_run ON run_waits(run_id);
      CREATE INDEX IF NOT EXISTS idx_run_waits_status ON run_waits(status);
      CREATE INDEX IF NOT EXISTS idx_run_waits_deadline ON run_waits(deadline);
    `);

    // Add goal_id and task_id to runs
    for (const alter of [
      'ALTER TABLE runs ADD COLUMN goal_id TEXT REFERENCES goals(id)',
      'ALTER TABLE runs ADD COLUMN task_id TEXT REFERENCES tasks(id)'
    ]) {
      await tryExec(db, alter);
    }
    await tryExec(db, 'CREATE INDEX IF NOT EXISTS idx_runs_goal ON runs(goal_id)');
    await tryExec(db, 'CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id)');
  }
};

const migrationV2P3MemoryContext: Migration = {
  version: 4,
  name: 'v2_p3_memory_context',
  up: async (db) => {
    // 1. Scoped memory enhancements
    for (const alter of [
      "ALTER TABLE scoped_memory ADD COLUMN memory_type TEXT DEFAULT 'fact'",
      'ALTER TABLE scoped_memory ADD COLUMN goal_id TEXT REFERENCES goals(id)',
      "ALTER TABLE scoped_memory ADD COLUMN security_status TEXT DEFAULT 'clean'",
      'ALTER TABLE scoped_memory ADD COLUMN quarantine_reason TEXT'
    ]) {
      await tryExec(db, alter);
    }
    await tryExec(db, 'CREATE INDEX IF NOT EXISTS idx_scoped_memory_type ON scoped_memory(memory_type)');
    await tryExec(db, 'CREATE INDEX IF NOT EXISTS idx_scoped_goal ON scoped_memory(goal_id)');
    await tryExec(db, 'CREATE INDEX IF NOT EXISTS idx_scoped_security ON scoped_memory(security_status)');

    // 2. Universal Session Search backing table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS session_search_entries (
        id TEXT PRIMARY KEY,
        category TEXT NOT NULL,
        content_text TEXT NOT NULL,
        session_id TEXT,
        run_id TEXT,
        goal_id TEXT,
        task_id TEXT,
        workspace_id INTEGER,
        project_id INTEGER,
        agent_id TEXT,
        metadata TEXT,
        timestamp INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sse_category ON session_search_entries(category);
      CREATE INDEX IF NOT EXISTS idx_sse_session ON session_search_entries(session_id);
      CREATE INDEX IF NOT EXISTS idx_sse_run ON session_search_entries(run_id);
      CREATE INDEX IF NOT EXISTS idx_sse_goal ON session_search_entries(goal_id);
      CREATE INDEX IF NOT EXISTS idx_sse_workspace ON session_search_entries(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_sse_project ON session_search_entries(project_id);
      CREATE INDEX IF NOT EXISTS idx_sse_timestamp ON session_search_entries(timestamp);

      CREATE VIRTUAL TABLE IF NOT EXISTS session_search_fts USING fts5(
        entry_id UNINDEXED,
        category,
        content_text,
        session_id,
        run_id,
        goal_id,
        task_id,
        workspace_id,
        project_id,
        agent_id
      );

      CREATE TRIGGER IF NOT EXISTS trg_sse_ai AFTER INSERT ON session_search_entries BEGIN
        INSERT INTO session_search_fts(entry_id, category, content_text, session_id, run_id, goal_id, task_id, workspace_id, project_id, agent_id)
        VALUES (new.id, new.category, new.content_text, new.session_id, new.run_id, new.goal_id, new.task_id, new.workspace_id, new.project_id, new.agent_id);
      END;

      CREATE TRIGGER IF NOT EXISTS trg_sse_ad AFTER DELETE ON session_search_entries BEGIN
        DELETE FROM session_search_fts WHERE entry_id = old.id;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_sse_au AFTER UPDATE ON session_search_entries BEGIN
        DELETE FROM session_search_fts WHERE entry_id = old.id;
        INSERT INTO session_search_fts(entry_id, category, content_text, session_id, run_id, goal_id, task_id, workspace_id, project_id, agent_id)
        VALUES (new.id, new.category, new.content_text, new.session_id, new.run_id, new.goal_id, new.task_id, new.workspace_id, new.project_id, new.agent_id);
      END;
    `);

    // 3. Backfill session_search_entries from existing episodic_memory and run_events if present
    try {
      await db.exec(`
        INSERT OR IGNORE INTO session_search_entries (id, category, content_text, session_id, timestamp)
        SELECT 'msg_' || id, 'message', content, session_id, timestamp FROM episodic_memory;

        INSERT OR IGNORE INTO session_search_entries (id, category, content_text, run_id, timestamp)
        SELECT 'event_' || id, event_type, payload, run_id, timestamp FROM run_events;
      `);
    } catch {
      // Best-effort backfill
    }
  }
};

export const MIGRATIONS: Migration[] = [
  migrationV1Baseline,
  migrationV2P1AgentFoundation,
  migrationV2P2PersistentAutonomy,
  migrationV2P3MemoryContext
];

