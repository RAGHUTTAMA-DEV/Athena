import { Database } from 'sqlite';
import { RoutineRecord, RoutineStore, RoutineTriggerType } from '../types.js';

function rowToRoutine(row: any): RoutineRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description || undefined,
    triggerType: row.trigger_type as RoutineTriggerType,
    triggerConfig: row.trigger_config ? JSON.parse(row.trigger_config) : {},
    workflow: row.workflow ? JSON.parse(row.workflow) : {},
    conditions: row.conditions ? JSON.parse(row.conditions) : undefined,
    permissions: row.permissions ? JSON.parse(row.permissions) : undefined,
    enabled: Boolean(row.enabled),
    successRate: typeof row.success_rate === 'number' ? row.success_rate : 1.0,
    invocations: row.invocations || 0,
    lastRunAt: row.last_run_at || null,
    history: row.history ? JSON.parse(row.history) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteRoutineStore implements RoutineStore {
  constructor(private db: Database) {}

  async save(routine: RoutineRecord): Promise<RoutineRecord> {
    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO routines (
        id, name, description, trigger_type, trigger_config,
        workflow, conditions, permissions, enabled, success_rate,
        invocations, last_run_at, history, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM routines WHERE id = ?), ?), ?)`,
      routine.id,
      routine.name,
      routine.description ?? null,
      routine.triggerType,
      JSON.stringify(routine.triggerConfig || {}),
      JSON.stringify(routine.workflow || {}),
      routine.conditions ? JSON.stringify(routine.conditions) : null,
      routine.permissions ? JSON.stringify(routine.permissions) : null,
      routine.enabled ? 1 : 0,
      routine.successRate ?? 1.0,
      routine.invocations ?? 0,
      routine.lastRunAt ?? null,
      routine.history ? JSON.stringify(routine.history) : JSON.stringify([]),
      routine.id,
      routine.createdAt || now,
      now
    );
    return (await this.get(routine.id))!;
  }

  async get(id: string): Promise<RoutineRecord | null> {
    const row = await this.db.get(`SELECT * FROM routines WHERE id = ?`, id);
    return row ? rowToRoutine(row) : null;
  }

  async findByName(name: string): Promise<RoutineRecord | null> {
    const row = await this.db.get(`SELECT * FROM routines WHERE name = ? ORDER BY updated_at DESC LIMIT 1`, name);
    return row ? rowToRoutine(row) : null;
  }

  async findByTriggerType(triggerType: RoutineTriggerType): Promise<RoutineRecord[]> {
    const rows = await this.db.all(`SELECT * FROM routines WHERE trigger_type = ? AND enabled = 1 ORDER BY updated_at DESC`, triggerType);
    return rows.map(rowToRoutine);
  }

  async list(filter?: { enabled?: boolean; triggerType?: RoutineTriggerType; limit?: number }): Promise<RoutineRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.enabled !== undefined) {
      conditions.push('enabled = ?');
      params.push(filter.enabled ? 1 : 0);
    }
    if (filter?.triggerType) {
      conditions.push('trigger_type = ?');
      params.push(filter.triggerType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit || 100;
    const rows = await this.db.all(`SELECT * FROM routines ${whereClause} ORDER BY updated_at DESC LIMIT ?`, ...params, limit);
    return rows.map(rowToRoutine);
  }

  async recordRun(id: string, outcome: { success: boolean; durationMs?: number; runId?: string; error?: string }): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    const invocations = existing.invocations + 1;
    const history = existing.history || [];
    history.unshift({
      timestamp: Date.now(),
      success: outcome.success,
      durationMs: outcome.durationMs,
      runId: outcome.runId,
      error: outcome.error
    });
    if (history.length > 50) history.pop();

    const successCount = history.filter((h: any) => h.success).length;
    const successRate = invocations > 0 ? successCount / Math.min(invocations, history.length) : 1.0;

    await this.db.run(
      `UPDATE routines SET
        invocations = ?,
        success_rate = ?,
        last_run_at = ?,
        history = ?,
        updated_at = ?
      WHERE id = ?`,
      invocations,
      successRate,
      Date.now(),
      JSON.stringify(history),
      Date.now(),
      id
    );
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM routines WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
