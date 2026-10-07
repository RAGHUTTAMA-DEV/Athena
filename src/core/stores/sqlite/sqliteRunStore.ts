import { Database } from 'sqlite';
import { RunState } from '../../runState.js';
import { AgentEvent } from '../../events.js';
import { RunStore, EventStore } from '../types.js';

const DEFAULT_USAGE = {
  elapsedTimeMs: 0,
  tokens: { input: 0, output: 0, total: 0 },
  costUsd: 0,
  toolCallsCount: 0,
  turnsCount: 0
};

function rowToRunState(row: any): RunState {
  return {
    runId: row.run_id,
    parentRunId: row.parent_run_id || undefined,
    rootRunId: row.root_run_id,
    sessionId: row.session_id,
    task: row.task,
    status: row.status,
    currentTurn: row.current_turn,
    budget: row.budget ? JSON.parse(row.budget) : {},
    usage: row.usage ? JSON.parse(row.usage) : { ...DEFAULT_USAGE, tokens: { ...DEFAULT_USAGE.tokens } },
    idempotencyKeys: row.idempotency_keys ? JSON.parse(row.idempotency_keys) : [],
    terminationReason: row.termination_reason || undefined,
    error: row.error ? JSON.parse(row.error) : undefined,
    result: row.result || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Behavior matches the V1 EpisodicMemory run methods this replaces. */
export class SqliteRunStore implements RunStore {
  constructor(private db: Database) {}

  async save(state: RunState): Promise<void> {
    await this.db.run(
      `INSERT OR REPLACE INTO runs (
        run_id, parent_run_id, root_run_id, session_id, task, status,
        current_turn, budget, usage, idempotency_keys, termination_reason,
        error, result, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      state.runId,
      state.parentRunId || null,
      state.rootRunId,
      state.sessionId,
      state.task,
      state.status,
      state.currentTurn,
      JSON.stringify(state.budget),
      JSON.stringify(state.usage),
      JSON.stringify(state.idempotencyKeys),
      state.terminationReason || null,
      state.error ? JSON.stringify(state.error) : null,
      state.result || null,
      state.createdAt,
      state.updatedAt
    );
  }

  async get(runId: string): Promise<RunState | null> {
    const row = await this.db.get(`SELECT * FROM runs WHERE run_id = ?`, runId);
    return row ? rowToRunState(row) : null;
  }

  async update(runId: string, updates: Partial<RunState>): Promise<void> {
    const existing = await this.get(runId);
    if (!existing) {
      throw new Error(`Cannot update non-existent run "${runId}"`);
    }
    await this.save({ ...existing, ...updates, updatedAt: Date.now() });
  }

  async list(sessionId?: string, limit: number = 50): Promise<RunState[]> {
    let query = `SELECT * FROM runs`;
    const params: any[] = [];
    if (sessionId) {
      query += ` WHERE session_id = ?`;
      params.push(sessionId);
    }
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    const rows = await this.db.all(query, ...params);
    return rows.map(rowToRunState);
  }
}

export class SqliteEventStore implements EventStore {
  constructor(private db: Database) {}

  async saveRunEvent(event: AgentEvent): Promise<void> {
    await this.db.run(
      `INSERT INTO run_events (run_id, event_type, payload, timestamp) VALUES (?, ?, ?, ?)`,
      event.runId,
      event.type,
      JSON.stringify(event),
      event.timestamp
    );
  }

  async getRunEvents(runId: string): Promise<AgentEvent[]> {
    const rows = await this.db.all(
      `SELECT payload FROM run_events WHERE run_id = ? ORDER BY id ASC`,
      runId
    );
    return rows.map((r: any) => JSON.parse(r.payload));
  }
}
