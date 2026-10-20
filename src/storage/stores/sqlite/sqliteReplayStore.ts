import { Database } from 'sqlite';
import { ReplayLogEntry, ReplayStore } from '../types.js';

export class SqliteReplayStore implements ReplayStore {
  constructor(private db: Database) {}

  async recordStep(entry: ReplayLogEntry): Promise<ReplayLogEntry> {
    await this.db.run(
      `INSERT OR REPLACE INTO replay_logs (
        id, run_id, step_index, model_input, model_output, tool_calls, tool_outputs, state_diff, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id,
        entry.runId,
        entry.stepIndex,
        entry.modelInput ? JSON.stringify(entry.modelInput) : null,
        entry.modelOutput ? JSON.stringify(entry.modelOutput) : null,
        entry.toolCalls ? JSON.stringify(entry.toolCalls) : null,
        entry.toolOutputs ? JSON.stringify(entry.toolOutputs) : null,
        entry.stateDiff ? JSON.stringify(entry.stateDiff) : null,
        entry.timestamp
      ]
    );
    return entry;
  }

  async getSteps(runId: string): Promise<ReplayLogEntry[]> {
    const rows = await this.db.all(
      `SELECT * FROM replay_logs WHERE run_id = ? ORDER BY step_index ASC`,
      [runId]
    );
    return rows.map(r => ({
      id: r.id,
      runId: r.run_id,
      stepIndex: r.step_index,
      modelInput: r.model_input ? JSON.parse(r.model_input) : undefined,
      modelOutput: r.model_output ? JSON.parse(r.model_output) : undefined,
      toolCalls: r.tool_calls ? JSON.parse(r.tool_calls) : undefined,
      toolOutputs: r.tool_outputs ? JSON.parse(r.tool_outputs) : undefined,
      stateDiff: r.state_diff ? JSON.parse(r.state_diff) : undefined,
      timestamp: r.timestamp
    }));
  }

  async clear(runId: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM replay_logs WHERE run_id = ?`, [runId]);
    return (res.changes || 0) > 0;
  }
}
