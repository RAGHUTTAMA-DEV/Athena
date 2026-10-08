import { Database } from 'sqlite';
import { MediaType, MultimodalArtifact, MultimodalStore } from '../types.js';

function rowToArtifact(row: any): MultimodalArtifact {
  return {
    id: row.id,
    mediaType: row.media_type as MediaType,
    mimeType: row.mime_type,
    filePath: row.file_path,
    source: row.source || undefined,
    transcription: row.transcription || undefined,
    caption: row.caption || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: Number(row.created_at)
  };
}

export class SqliteMultimodalStore implements MultimodalStore {
  constructor(private db: Database) {}

  async saveArtifact(artifact: MultimodalArtifact): Promise<MultimodalArtifact> {
    await this.db.run(
      `INSERT INTO multimodal_artifacts (
        id, media_type, mime_type, file_path, source, transcription, caption, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        mime_type = excluded.mime_type,
        file_path = excluded.file_path,
        source = excluded.source,
        transcription = excluded.transcription,
        caption = excluded.caption,
        metadata = excluded.metadata`,
      artifact.id,
      artifact.mediaType,
      artifact.mimeType,
      artifact.filePath,
      artifact.source || null,
      artifact.transcription || null,
      artifact.caption || null,
      artifact.metadata ? JSON.stringify(artifact.metadata) : null,
      artifact.createdAt
    );
    return artifact;
  }

  async getArtifact(id: string): Promise<MultimodalArtifact | null> {
    const row = await this.db.get(`SELECT * FROM multimodal_artifacts WHERE id = ?`, id);
    return row ? rowToArtifact(row) : null;
  }

  async deleteArtifact(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM multimodal_artifacts WHERE id = ?`, id);
    return (res.changes ?? 0) > 0;
  }

  async listArtifacts(filter?: { mediaType?: MediaType; source?: string; limit?: number }): Promise<MultimodalArtifact[]> {
    const limit = filter?.limit || 50;
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.mediaType) {
      conditions.push('media_type = ?');
      params.push(filter.mediaType);
    }
    if (filter?.source) {
      conditions.push('source = ?');
      params.push(filter.source);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `SELECT * FROM multimodal_artifacts ${whereClause} ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(query, ...params);
    return rows.map(rowToArtifact);
  }
}
