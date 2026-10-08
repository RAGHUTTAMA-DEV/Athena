import { Database } from 'sqlite';
import { HeartbeatLog, HeartbeatStore } from '../types.js';

function rowToLog(row: any): HeartbeatLog {
  return {
    id: row.id,
    agentId: row.agent_id || undefined,
    wokeAgent: Boolean(row.woke_agent),
    reason: row.reason || undefined,
    costUsd: Number(row.cost_usd ?? 0),
    tokensUsed: Number(row.tokens_used ?? 0),
    activeGoalsCount: Number(row.active_goals_count ?? 0),
    timestamp: Number(row.timestamp)
  };
}

export class SqliteHeartbeatStore implements HeartbeatStore {
  constructor(private db: Database) {}

  async record(log: HeartbeatLog): Promise<void> {
    await this.db.run(
      `INSERT INTO heartbeat_logs (
        id, agent_id, woke_agent, reason, cost_usd, tokens_used, active_goals_count, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      log.id,
      log.agentId || null,
      log.wokeAgent ? 1 : 0,
      log.reason || null,
      log.costUsd,
      log.tokensUsed,
      log.activeGoalsCount,
      log.timestamp
    );
  }

  async getCostSummary(since: number): Promise<{ totalCostUsd: number; totalTokens: number; totalWakes: number; totalTicks: number }> {
    const row = await this.db.get(
      `SELECT
        COALESCE(SUM(cost_usd), 0) AS total_cost_usd,
        COALESCE(SUM(tokens_used), 0) AS total_tokens,
        COALESCE(SUM(CASE WHEN woke_agent = 1 THEN 1 ELSE 0 END), 0) AS total_wakes,
        COUNT(*) AS total_ticks
       FROM heartbeat_logs
       WHERE timestamp >= ?`,
      since
    );
    return {
      totalCostUsd: Number(row?.total_cost_usd ?? 0),
      totalTokens: Number(row?.total_tokens ?? 0),
      totalWakes: Number(row?.total_wakes ?? 0),
      totalTicks: Number(row?.total_ticks ?? 0)
    };
  }

  async listRecent(limit = 50): Promise<HeartbeatLog[]> {
    const rows = await this.db.all(
      `SELECT * FROM heartbeat_logs ORDER BY timestamp DESC LIMIT ?`,
      limit
    );
    return rows.map(rowToLog);
  }
}
