import { Database } from 'sqlite';
import {
  DurableAgentEvent,
  DurableAgentEventFilter,
  DurableAgentEventStore,
  DurableEventStatus
} from '../types.js';

function rowToEvent(row: any): DurableAgentEvent {
  return {
    id: row.id,
    topic: row.topic,
    traceId: row.trace_id || undefined,
    agentId: row.agent_id || undefined,
    goalId: row.goal_id || undefined,
    taskId: row.task_id || undefined,
    runId: row.run_id || undefined,
    idempotencyKey: row.idempotency_key || undefined,
    payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
    priority: row.priority,
    source: row.source,
    status: row.status,
    retryCount: row.retry_count ?? 0,
    maxRetries: row.max_retries ?? 3,
    errorMessage: row.error_message || undefined,
    timestamp: row.timestamp,
    processedAt: row.processed_at || undefined
  };
}

export class SqliteDurableAgentEventStore implements DurableAgentEventStore {
  constructor(private db: Database) {}

  async save(event: DurableAgentEvent): Promise<DurableAgentEvent> {
    const payloadStr = typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload);
    await this.db.run(
      `INSERT INTO durable_agent_events (
        id, topic, trace_id, agent_id, goal_id, task_id, run_id,
        idempotency_key, payload, priority, source, status,
        retry_count, max_retries, error_message, timestamp, processed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        topic = excluded.topic,
        trace_id = excluded.trace_id,
        agent_id = excluded.agent_id,
        goal_id = excluded.goal_id,
        task_id = excluded.task_id,
        run_id = excluded.run_id,
        idempotency_key = excluded.idempotency_key,
        payload = excluded.payload,
        priority = excluded.priority,
        source = excluded.source,
        status = excluded.status,
        retry_count = excluded.retry_count,
        max_retries = excluded.max_retries,
        error_message = excluded.error_message,
        processed_at = excluded.processed_at`,
      event.id,
      event.topic,
      event.traceId || null,
      event.agentId || null,
      event.goalId || null,
      event.taskId || null,
      event.runId || null,
      event.idempotencyKey || null,
      payloadStr,
      event.priority,
      event.source,
      event.status,
      event.retryCount ?? 0,
      event.maxRetries ?? 3,
      event.errorMessage || null,
      event.timestamp,
      event.processedAt || null
    );
    return event;
  }

  async get(id: string): Promise<DurableAgentEvent | null> {
    const row = await this.db.get(`SELECT * FROM durable_agent_events WHERE id = ?`, id);
    return row ? rowToEvent(row) : null;
  }

  async getByIdempotencyKey(key: string, windowMs?: number): Promise<DurableAgentEvent | null> {
    let query = `SELECT * FROM durable_agent_events WHERE idempotency_key = ?`;
    const params: any[] = [key];
    if (windowMs !== undefined) {
      query += ` AND timestamp >= ?`;
      params.push(Date.now() - windowMs);
    }
    query += ` ORDER BY timestamp DESC LIMIT 1`;
    const row = await this.db.get(query, ...params);
    return row ? rowToEvent(row) : null;
  }

  async updateStatus(id: string, status: DurableEventStatus, errorMessage?: string, processedAt?: number): Promise<void> {
    await this.db.run(
      `UPDATE durable_agent_events
       SET status = ?, error_message = ?, processed_at = ?
       WHERE id = ?`,
      status,
      errorMessage || null,
      processedAt ?? (status === 'processed' ? Date.now() : null),
      id
    );
  }

  async incrementRetry(id: string, errorMessage: string): Promise<void> {
    const event = await this.get(id);
    if (!event) return;
    const newRetryCount = event.retryCount + 1;
    const newStatus: DurableEventStatus = newRetryCount >= event.maxRetries ? 'dead_letter' : 'pending';
    await this.db.run(
      `UPDATE durable_agent_events
       SET retry_count = ?, status = ?, error_message = ?
       WHERE id = ?`,
      newRetryCount,
      newStatus,
      errorMessage,
      id
    );
  }

  async list(filter?: DurableAgentEventFilter): Promise<DurableAgentEvent[]> {
    let query = `SELECT * FROM durable_agent_events WHERE 1=1`;
    const params: any[] = [];

    if (filter?.topic) {
      query += ` AND topic = ?`;
      params.push(filter.topic);
    }
    if (filter?.topicPrefix) {
      query += ` AND topic LIKE ?`;
      params.push(`${filter.topicPrefix}%`);
    }
    if (filter?.status) {
      query += ` AND status = ?`;
      params.push(filter.status);
    }
    if (filter?.goalId) {
      query += ` AND goal_id = ?`;
      params.push(filter.goalId);
    }
    if (filter?.agentId) {
      query += ` AND agent_id = ?`;
      params.push(filter.agentId);
    }
    if (filter?.priority) {
      query += ` AND priority = ?`;
      params.push(filter.priority);
    }
    if (filter?.since !== undefined) {
      query += ` AND timestamp >= ?`;
      params.push(filter.since);
    }
    if (filter?.until !== undefined) {
      query += ` AND timestamp <= ?`;
      params.push(filter.until);
    }

    query += ` ORDER BY timestamp DESC`;
    if (filter?.limit) {
      query += ` LIMIT ?`;
      params.push(filter.limit);
    }

    const rows = await this.db.all(query, ...params);
    return rows.map(rowToEvent);
  }

  async listPending(limit = 100): Promise<DurableAgentEvent[]> {
    const rows = await this.db.all(
      `SELECT * FROM durable_agent_events WHERE status = 'pending' ORDER BY timestamp ASC LIMIT ?`,
      limit
    );
    return rows.map(rowToEvent);
  }

  async listDeadLetters(limit = 100): Promise<DurableAgentEvent[]> {
    const rows = await this.db.all(
      `SELECT * FROM durable_agent_events WHERE status = 'dead_letter' ORDER BY timestamp DESC LIMIT ?`,
      limit
    );
    return rows.map(rowToEvent);
  }
}
