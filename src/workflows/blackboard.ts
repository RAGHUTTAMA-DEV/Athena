import { Database } from 'sqlite';

/**
 * WorkflowBlackboard provides execution-scoped shared artifact storage
 * across all nodes and agents in a workflow run.
 */
export class WorkflowBlackboard {
  constructor(private db: Database, private runId: string) {}

  async set(key: string, value: any, createdBy?: string): Promise<void> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    await this.db.run(
      `INSERT INTO workflow_blackboard (run_id, key, value, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(run_id, key) DO UPDATE SET
         value = excluded.value,
         created_by = excluded.created_by,
         updated_at = excluded.updated_at`,
      this.runId,
      key,
      serialized,
      createdBy || null,
      Date.now()
    );
  }

  async get(key: string): Promise<any> {
    const row = await this.db.get(
      `SELECT value FROM workflow_blackboard WHERE run_id = ? AND key = ?`,
      this.runId,
      key
    );
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return row.value;
    }
  }

  async getAll(): Promise<Record<string, any>> {
    const rows = await this.db.all(
      `SELECT key, value FROM workflow_blackboard WHERE run_id = ?`,
      this.runId
    );
    const result: Record<string, any> = {};
    for (const r of rows) {
      try {
        result[r.key] = JSON.parse(r.value);
      } catch {
        result[r.key] = r.value;
      }
    }
    return result;
  }

  async delete(key: string): Promise<void> {
    await this.db.run(
      `DELETE FROM workflow_blackboard WHERE run_id = ? AND key = ?`,
      this.runId,
      key
    );
  }

  async clear(): Promise<void> {
    await this.db.run(
      `DELETE FROM workflow_blackboard WHERE run_id = ?`,
      this.runId
    );
  }
}
