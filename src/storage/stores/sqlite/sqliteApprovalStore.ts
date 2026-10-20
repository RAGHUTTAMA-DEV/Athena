import { Database } from 'sqlite';
import { ApprovalRequest, ApprovalStore, ApprovalStatus } from '../types.js';

export class SqliteApprovalStore implements ApprovalStore {
  constructor(private db: Database) {}

  async createRequest(req: ApprovalRequest): Promise<ApprovalRequest> {
    const proposedActionStr = typeof req.proposedAction === 'string'
      ? req.proposedAction
      : JSON.stringify(req.proposedAction);

    await this.db.run(
      `INSERT OR REPLACE INTO approvals (
        id, action, risk_level, explanation, proposed_action, status,
        channel_id, run_id, goal_id, task_id, expires_at, created_at,
        resolved_at, resolution_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.id,
        req.action,
        req.riskLevel,
        req.explanation,
        proposedActionStr,
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
    const row = await this.db.get(`SELECT * FROM approvals WHERE id = ?`, [id]);
    if (!row) return null;
    return this.mapRow(row);
  }

  async resolveRequest(
    id: string,
    status: 'approved' | 'rejected',
    reason?: string
  ): Promise<ApprovalRequest | null> {
    const now = Date.now();
    await this.db.run(
      `UPDATE approvals
       SET status = ?, resolved_at = ?, resolution_reason = ?
       WHERE id = ?`,
      [status, now, reason || null, id]
    );
    return this.getRequest(id);
  }

  async listPending(filter?: { runId?: string; goalId?: string; limit?: number }): Promise<ApprovalRequest[]> {
    const conditions: string[] = ["status = 'pending'"];
    const params: any[] = [];

    if (filter?.runId) {
      conditions.push('run_id = ?');
      params.push(filter.runId);
    }
    if (filter?.goalId) {
      conditions.push('goal_id = ?');
      params.push(filter.goalId);
    }

    const limit = filter?.limit || 50;
    const sql = `SELECT * FROM approvals WHERE ${conditions.join(' AND ')} ORDER BY created_at ASC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(sql, params);
    return rows.map(r => this.mapRow(r));
  }

  async listAll(filter?: { status?: ApprovalStatus; runId?: string; limit?: number }): Promise<ApprovalRequest[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }
    if (filter?.runId) {
      conditions.push('run_id = ?');
      params.push(filter.runId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit || 100;
    const sql = `SELECT * FROM approvals ${whereClause} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(sql, params);
    return rows.map(r => this.mapRow(r));
  }

  private mapRow(row: any): ApprovalRequest {
    let proposedAction: any = row.proposed_action;
    try {
      proposedAction = JSON.parse(row.proposed_action);
    } catch {}

    return {
      id: row.id,
      action: row.action,
      riskLevel: row.risk_level,
      explanation: row.explanation,
      proposedAction,
      status: row.status,
      channelId: row.channel_id || undefined,
      runId: row.run_id || undefined,
      goalId: row.goal_id || undefined,
      taskId: row.task_id || undefined,
      expiresAt: row.expires_at || undefined,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at || undefined,
      resolutionReason: row.resolution_reason || undefined
    };
  }
}
