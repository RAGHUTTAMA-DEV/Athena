import { Database } from 'sqlite';
import { ResearchDocument, ResearchDocumentStore } from '../types.js';

function rowToDoc(row: any): ResearchDocument {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceUri: row.source_uri,
    title: row.title || undefined,
    format: row.format || undefined,
    contentHash: row.content_hash,
    chunkCount: row.chunk_count || 0,
    charCount: row.char_count || 0,
    workspaceId: row.workspace_id !== null ? row.workspace_id : null,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteResearchDocumentStore implements ResearchDocumentStore {
  constructor(private db: Database) {}

  async save(doc: ResearchDocument): Promise<ResearchDocument> {
    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO research_documents (
        id, source_type, source_uri, title, format, content_hash,
        chunk_count, char_count, workspace_id, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM research_documents WHERE id = ?), ?), ?)`,
      doc.id,
      doc.sourceType,
      doc.sourceUri,
      doc.title || null,
      doc.format || null,
      doc.contentHash,
      doc.chunkCount,
      doc.charCount,
      doc.workspaceId ?? null,
      doc.metadata ? JSON.stringify(doc.metadata) : null,
      doc.id,
      doc.createdAt || now,
      now
    );
    return (await this.get(doc.id))!;
  }

  async get(id: string): Promise<ResearchDocument | null> {
    const row = await this.db.get(`SELECT * FROM research_documents WHERE id = ?`, id);
    return row ? rowToDoc(row) : null;
  }

  async findBySourceUri(sourceUri: string): Promise<ResearchDocument | null> {
    const row = await this.db.get(
      `SELECT * FROM research_documents WHERE source_uri = ? ORDER BY updated_at DESC LIMIT 1`,
      sourceUri
    );
    return row ? rowToDoc(row) : null;
  }

  async findByHash(contentHash: string): Promise<ResearchDocument | null> {
    const row = await this.db.get(
      `SELECT * FROM research_documents WHERE content_hash = ? ORDER BY updated_at DESC LIMIT 1`,
      contentHash
    );
    return row ? rowToDoc(row) : null;
  }

  async list(filter: { workspaceId?: number; sourceType?: string; limit?: number } = {}): Promise<ResearchDocument[]> {
    let sql = `SELECT * FROM research_documents WHERE 1=1`;
    const params: any[] = [];
    if (filter.workspaceId !== undefined) {
      sql += ` AND workspace_id = ?`;
      params.push(filter.workspaceId);
    }
    if (filter.sourceType) {
      sql += ` AND source_type = ?`;
      params.push(filter.sourceType);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(filter.limit ?? 100);
    const rows = await this.db.all(sql, ...params);
    return rows.map(rowToDoc);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM research_documents WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
