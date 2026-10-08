import { Database } from 'sqlite';
import {
  WebhookEndpoint,
  WebhookReceipt,
  WebhookStore,
  WebhookReceiptStatus
} from '../types.js';

function rowToEndpoint(row: any): WebhookEndpoint {
  return {
    id: row.id,
    name: row.name,
    secret: row.secret,
    allowedTopics: row.allowed_topics ? JSON.parse(row.allowed_topics) : undefined,
    isActive: Boolean(row.is_active),
    requireSignature: Boolean(row.require_signature),
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function rowToReceipt(row: any): WebhookReceipt {
  return {
    id: row.id,
    endpointId: row.endpoint_id,
    idempotencyKey: row.idempotency_key || undefined,
    signature: row.signature || undefined,
    timestamp: row.timestamp,
    status: row.status as WebhookReceiptStatus,
    sourceIp: row.source_ip || undefined,
    payloadHash: row.payload_hash || undefined,
    createdAt: row.created_at
  };
}

export class SqliteWebhookStore implements WebhookStore {
  constructor(private db: Database) {}

  async saveEndpoint(endpoint: WebhookEndpoint): Promise<WebhookEndpoint> {
    const allowedTopicsStr = endpoint.allowedTopics ? JSON.stringify(endpoint.allowedTopics) : null;
    const metadataStr = endpoint.metadata ? JSON.stringify(endpoint.metadata) : null;
    await this.db.run(
      `INSERT INTO webhook_endpoints (
        id, name, secret, allowed_topics, is_active, require_signature, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        secret = excluded.secret,
        allowed_topics = excluded.allowed_topics,
        is_active = excluded.is_active,
        require_signature = excluded.require_signature,
        metadata = excluded.metadata,
        updated_at = excluded.updated_at`,
      endpoint.id,
      endpoint.name,
      endpoint.secret,
      allowedTopicsStr,
      endpoint.isActive ? 1 : 0,
      endpoint.requireSignature ? 1 : 0,
      metadataStr,
      endpoint.createdAt,
      endpoint.updatedAt
    );
    return endpoint;
  }

  async getEndpoint(id: string): Promise<WebhookEndpoint | null> {
    const row = await this.db.get(`SELECT * FROM webhook_endpoints WHERE id = ?`, id);
    return row ? rowToEndpoint(row) : null;
  }

  async listEndpoints(): Promise<WebhookEndpoint[]> {
    const rows = await this.db.all(`SELECT * FROM webhook_endpoints ORDER BY created_at DESC`);
    return rows.map(rowToEndpoint);
  }

  async deleteEndpoint(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM webhook_endpoints WHERE id = ?`, id);
    return (res.changes ?? 0) > 0;
  }

  async recordReceipt(receipt: WebhookReceipt): Promise<void> {
    await this.db.run(
      `INSERT INTO webhook_receipts (
        id, endpoint_id, idempotency_key, signature, timestamp, status, source_ip, payload_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      receipt.id,
      receipt.endpointId,
      receipt.idempotencyKey || null,
      receipt.signature || null,
      receipt.timestamp,
      receipt.status,
      receipt.sourceIp || null,
      receipt.payloadHash || null,
      receipt.createdAt
    );
  }

  async getReceiptByIdempotencyKey(endpointId: string, key: string, windowMs?: number): Promise<WebhookReceipt | null> {
    let query = `SELECT * FROM webhook_receipts WHERE endpoint_id = ? AND idempotency_key = ?`;
    const params: any[] = [endpointId, key];
    if (windowMs !== undefined) {
      query += ` AND created_at >= ?`;
      params.push(Date.now() - windowMs);
    }
    query += ` ORDER BY created_at DESC LIMIT 1`;
    const row = await this.db.get(query, ...params);
    return row ? rowToReceipt(row) : null;
  }

  async listReceipts(endpointId?: string, limit = 50): Promise<WebhookReceipt[]> {
    let query = `SELECT * FROM webhook_receipts`;
    const params: any[] = [];
    if (endpointId) {
      query += ` WHERE endpoint_id = ?`;
      params.push(endpointId);
    }
    query += ` ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    const rows = await this.db.all(query, ...params);
    return rows.map(rowToReceipt);
  }
}
