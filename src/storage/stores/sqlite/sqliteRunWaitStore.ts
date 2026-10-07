import { Database } from 'sqlite';
import { RunWait, WaitType, WaitStatus } from '../../../autonomy/goalTypes.js';
import { RunWaitStore } from '../types.js';

function rowToRunWait(row: any): RunWait {
  return {
    id: row.id,
    runId: row.run_id,
    waitType: row.wait_type as WaitType,
    status: row.status as WaitStatus,
    eventPattern: row.event_pattern || null,
    matcherCriteria: row.matcher_criteria ? JSON.parse(row.matcher_criteria) : null,
    deadline: row.deadline !== null ? row.deadline : null,
    waitResult: row.wait_result ? JSON.parse(row.wait_result) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteRunWaitStore implements RunWaitStore {
  constructor(private db: Database) {}

  async create(wait: RunWait): Promise<RunWait> {
    const now = Date.now();
    const saved: RunWait = {
      ...wait,
      createdAt: wait.createdAt || now,
      updatedAt: now
    };

    await this.db.run(
      `INSERT OR REPLACE INTO run_waits (
        id, run_id, wait_type, status, event_pattern,
        matcher_criteria, deadline, wait_result, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      saved.id,
      saved.runId,
      saved.waitType,
      saved.status,
      saved.eventPattern || null,
      saved.matcherCriteria ? JSON.stringify(saved.matcherCriteria) : null,
      saved.deadline !== undefined ? saved.deadline : null,
      saved.waitResult !== undefined ? JSON.stringify(saved.waitResult) : null,
      saved.metadata ? JSON.stringify(saved.metadata) : null,
      saved.createdAt,
      saved.updatedAt
    );

    return saved;
  }

  async get(id: string): Promise<RunWait | null> {
    const row = await this.db.get(`SELECT * FROM run_waits WHERE id = ?`, id);
    return row ? rowToRunWait(row) : null;
  }

  async getByRunId(runId: string): Promise<RunWait | null> {
    const row = await this.db.get(
      `SELECT * FROM run_waits WHERE run_id = ? ORDER BY created_at DESC LIMIT 1`,
      runId
    );
    return row ? rowToRunWait(row) : null;
  }

  async listActive(): Promise<RunWait[]> {
    const rows = await this.db.all(
      `SELECT * FROM run_waits WHERE status = 'waiting' ORDER BY created_at ASC`
    );
    return rows.map(rowToRunWait);
  }

  async update(id: string, updates: Partial<RunWait>): Promise<RunWait> {
    const existing = await this.get(id);
    if (!existing) {
      throw new Error(`Cannot update non-existent run wait "${id}"`);
    }
    const merged: RunWait = {
      ...existing,
      ...updates,
      id: existing.id,
      runId: existing.runId,
      createdAt: existing.createdAt,
      updatedAt: Date.now()
    };
    return this.create(merged);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM run_waits WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
