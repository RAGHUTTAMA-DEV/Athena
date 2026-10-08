import { Database } from 'sqlite';
import { AgentMessage, AgentMessageStatus, AgentMessageStore, AgentMessageType } from '../types.js';

function rowToMessage(row: any): AgentMessage {
  let parsedPayload: any = row.payload;
  try {
    parsedPayload = JSON.parse(row.payload);
  } catch {
    parsedPayload = row.payload;
  }

  return {
    id: row.id,
    senderId: row.sender_id,
    recipientId: row.recipient_id,
    messageType: row.message_type as AgentMessageType,
    goalId: row.goal_id || undefined,
    taskId: row.task_id || undefined,
    runId: row.run_id || undefined,
    payload: parsedPayload,
    status: row.status as AgentMessageStatus,
    replyToId: row.reply_to_id || undefined,
    createdAt: row.created_at,
    processedAt: row.processed_at || undefined
  };
}

export class SqliteAgentMessageStore implements AgentMessageStore {
  constructor(private db: Database) {}

  async save(message: AgentMessage): Promise<AgentMessage> {
    const payloadStr = typeof message.payload === 'string'
      ? message.payload
      : JSON.stringify(message.payload);

    await this.db.run(
      `INSERT OR REPLACE INTO agent_messages (
        id, sender_id, recipient_id, message_type, goal_id,
        task_id, run_id, payload, status, reply_to_id,
        created_at, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.senderId,
      message.recipientId,
      message.messageType,
      message.goalId || null,
      message.taskId || null,
      message.runId || null,
      payloadStr,
      message.status,
      message.replyToId || null,
      message.createdAt || Date.now(),
      message.processedAt || null
    );

    return (await this.get(message.id))!;
  }

  async get(id: string): Promise<AgentMessage | null> {
    const row = await this.db.get(`SELECT * FROM agent_messages WHERE id = ?`, id);
    return row ? rowToMessage(row) : null;
  }

  async listByRecipient(
    recipientId: string,
    filter?: { goalId?: string; taskId?: string; status?: AgentMessageStatus; limit?: number }
  ): Promise<AgentMessage[]> {
    const clauses: string[] = ['(recipient_id = ? OR recipient_id = "all" OR recipient_id = "team")'];
    const params: any[] = [recipientId];

    if (filter?.goalId) {
      clauses.push('goal_id = ?');
      params.push(filter.goalId);
    }
    if (filter?.taskId) {
      clauses.push('task_id = ?');
      params.push(filter.taskId);
    }
    if (filter?.status) {
      clauses.push('status = ?');
      params.push(filter.status);
    }

    const limitClause = filter?.limit ? ` LIMIT ${filter.limit}` : '';
    const query = `SELECT * FROM agent_messages WHERE ${clauses.join(' AND ')} ORDER BY created_at ASC${limitClause}`;
    const rows = await this.db.all(query, ...params);
    return rows.map(rowToMessage);
  }

  async listByThread(replyToId: string): Promise<AgentMessage[]> {
    const rows = await this.db.all(
      `SELECT * FROM agent_messages WHERE id = ? OR reply_to_id = ? ORDER BY created_at ASC`,
      replyToId,
      replyToId
    );
    return rows.map(rowToMessage);
  }

  async listByTask(taskId: string): Promise<AgentMessage[]> {
    const rows = await this.db.all(
      `SELECT * FROM agent_messages WHERE task_id = ? ORDER BY created_at ASC`,
      taskId
    );
    return rows.map(rowToMessage);
  }

  async listByGoal(goalId: string): Promise<AgentMessage[]> {
    const rows = await this.db.all(
      `SELECT * FROM agent_messages WHERE goal_id = ? ORDER BY created_at ASC`,
      goalId
    );
    return rows.map(rowToMessage);
  }

  async updateStatus(id: string, status: AgentMessageStatus): Promise<void> {
    const processedAt = (status === 'processed' || status === 'read') ? Date.now() : null;
    await this.db.run(
      `UPDATE agent_messages SET status = ?, processed_at = COALESCE(?, processed_at) WHERE id = ?`,
      status,
      processedAt,
      id
    );
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM agent_messages WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
