import { Database } from 'sqlite';
import {
  LearnedWorkflowRecord,
  LearnedWorkflowStore,
  LearnedWorkflowStatus
} from '../types.js';

function rowToLearnedWorkflow(row: any): LearnedWorkflowRecord {
  return {
    id: row.id,
    intent: row.intent,
    steps: row.steps ? JSON.parse(row.steps) : [],
    dependencies: row.dependencies ? JSON.parse(row.dependencies) : undefined,
    conditions: row.conditions ? JSON.parse(row.conditions) : undefined,
    requiredPermissions: row.required_permissions ? JSON.parse(row.required_permissions) : undefined,
    expectedOutcome: row.expected_outcome || undefined,
    failureHandling: row.failure_handling ? JSON.parse(row.failure_handling) : undefined,
    sourceRunId: row.source_run_id || undefined,
    status: row.status as LearnedWorkflowStatus,
    reviewNotes: row.review_notes || undefined,
    reviewedBy: row.reviewed_by || undefined,
    reviewedAt: row.reviewed_at || undefined,
    successRate: typeof row.success_rate === 'number' ? row.success_rate : 1.0,
    invocations: row.invocations || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteLearnedWorkflowStore implements LearnedWorkflowStore {
  constructor(private db: Database) {}

  async save(wf: LearnedWorkflowRecord): Promise<LearnedWorkflowRecord> {
    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO learned_workflows (
        id, intent, steps, dependencies, conditions,
        required_permissions, expected_outcome, failure_handling,
        source_run_id, status, review_notes, reviewed_by, reviewed_at,
        success_rate, invocations, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM learned_workflows WHERE id = ?), ?), ?)`,
      wf.id,
      wf.intent,
      JSON.stringify(wf.steps || []),
      wf.dependencies ? JSON.stringify(wf.dependencies) : null,
      wf.conditions ? JSON.stringify(wf.conditions) : null,
      wf.requiredPermissions ? JSON.stringify(wf.requiredPermissions) : null,
      wf.expectedOutcome ?? null,
      wf.failureHandling ? JSON.stringify(wf.failureHandling) : null,
      wf.sourceRunId ?? null,
      wf.status,
      wf.reviewNotes ?? null,
      wf.reviewedBy ?? null,
      wf.reviewedAt ?? null,
      wf.successRate ?? 1.0,
      wf.invocations ?? 0,
      wf.id,
      wf.createdAt || now,
      now
    );
    return (await this.get(wf.id))!;
  }

  async get(id: string): Promise<LearnedWorkflowRecord | null> {
    const row = await this.db.get(`SELECT * FROM learned_workflows WHERE id = ?`, id);
    return row ? rowToLearnedWorkflow(row) : null;
  }

  async findByStatus(status: LearnedWorkflowStatus): Promise<LearnedWorkflowRecord[]> {
    const rows = await this.db.all(`SELECT * FROM learned_workflows WHERE status = ? ORDER BY updated_at DESC`, status);
    return rows.map(rowToLearnedWorkflow);
  }

  async list(filter?: { status?: LearnedWorkflowStatus; limit?: number }): Promise<LearnedWorkflowRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit || 100;
    const rows = await this.db.all(`SELECT * FROM learned_workflows ${whereClause} ORDER BY updated_at DESC LIMIT ?`, ...params, limit);
    return rows.map(rowToLearnedWorkflow);
  }

  async updateStatus(
    id: string,
    status: LearnedWorkflowStatus,
    review?: { notes?: string; reviewedBy?: string }
  ): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `UPDATE learned_workflows SET
        status = ?,
        review_notes = COALESCE(?, review_notes),
        reviewed_by = COALESCE(?, reviewed_by),
        reviewed_at = ?,
        updated_at = ?
      WHERE id = ?`,
      status,
      review?.notes ?? null,
      review?.reviewedBy ?? null,
      now,
      now,
      id
    );
  }

  async recordOutcome(id: string, success: boolean): Promise<void> {
    const existing = await this.get(id);
    if (!existing) return;

    const invocations = existing.invocations + 1;
    // Exponential moving average or running success rate
    const currentSuccessWeight = existing.successRate * existing.invocations;
    const newSuccessRate = (currentSuccessWeight + (success ? 1 : 0)) / invocations;

    await this.db.run(
      `UPDATE learned_workflows SET
        invocations = ?,
        success_rate = ?,
        updated_at = ?
      WHERE id = ?`,
      invocations,
      newSuccessRate,
      Date.now(),
      id
    );
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM learned_workflows WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
