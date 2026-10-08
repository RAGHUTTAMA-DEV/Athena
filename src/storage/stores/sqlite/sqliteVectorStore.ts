import { Database } from 'sqlite';
import {
  VectorEmbeddingRecord,
  VectorSearchOptions,
  VectorSearchResult,
  VectorStore
} from '../types.js';

function rowToRecord(row: any): VectorEmbeddingRecord {
  return {
    id: row.id,
    namespace: row.namespace,
    refId: row.ref_id || undefined,
    text: row.text,
    embedding: JSON.parse(row.embedding) as number[],
    dims: row.dims,
    model: row.model,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteVectorStore implements VectorStore {
  constructor(private db: Database) {}

  async upsert(record: VectorEmbeddingRecord): Promise<void> {
    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO vector_embeddings (
        id, namespace, ref_id, text, embedding, dims, model, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM vector_embeddings WHERE id = ?), ?), ?)`,
      record.id,
      record.namespace,
      record.refId || null,
      record.text,
      JSON.stringify(record.embedding),
      record.embedding.length,
      record.model,
      record.metadata ? JSON.stringify(record.metadata) : null,
      record.id,
      record.createdAt || now,
      now
    );
  }

  async get(id: string): Promise<VectorEmbeddingRecord | null> {
    const row = await this.db.get(`SELECT * FROM vector_embeddings WHERE id = ?`, id);
    return row ? rowToRecord(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.run(`DELETE FROM vector_embeddings WHERE id = ?`, id);
  }

  async deleteByRef(refId: string): Promise<void> {
    await this.db.run(`DELETE FROM vector_embeddings WHERE ref_id = ?`, refId);
  }

  async deleteByNamespace(namespace: string): Promise<void> {
    await this.db.run(`DELETE FROM vector_embeddings WHERE namespace = ?`, namespace);
  }

  async search(embedding: number[], options: VectorSearchOptions = {}): Promise<VectorSearchResult[]> {
    let sql = `SELECT * FROM vector_embeddings WHERE dims = ?`;
    const params: any[] = [embedding.length];

    if (options.namespace) {
      sql += ` AND namespace = ?`;
      params.push(options.namespace);
    }
    if (options.refId) {
      sql += ` AND ref_id = ?`;
      params.push(options.refId);
    }

    const rows = await this.db.all(sql, ...params);
    const threshold = options.threshold ?? 0.0;

    const results: VectorSearchResult[] = [];
    for (const row of rows) {
      const record = rowToRecord(row);
      const score = cosineSimilarity(embedding, record.embedding);
      if (score >= threshold) {
        results.push({
          id: record.id,
          namespace: record.namespace,
          refId: record.refId,
          text: record.text,
          score,
          metadata: record.metadata
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, options.limit ?? 10);
  }

  async count(namespace?: string): Promise<number> {
    if (namespace) {
      const row = await this.db.get(
        `SELECT COUNT(*) as count FROM vector_embeddings WHERE namespace = ?`,
        namespace
      );
      return row?.count || 0;
    }
    const row = await this.db.get(`SELECT COUNT(*) as count FROM vector_embeddings`);
    return row?.count || 0;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return -1;
  let dotProduct = 0;
  let mA = 0;
  let mB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    mA += a[i] * a[i];
    mB += b[i] * b[i];
  }
  if (mA === 0 || mB === 0) return 0;
  return dotProduct / (Math.sqrt(mA) * Math.sqrt(mB));
}
