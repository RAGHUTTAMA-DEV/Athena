import { Database } from 'sqlite';
import * as crypto from 'crypto';
import { Artifact, ArtifactStore, ArtifactVersion, ArtifactType } from '../types.js';

export class SqliteArtifactStore implements ArtifactStore {
  constructor(private db: Database) {}

  async saveArtifact(
    artifact: Omit<Artifact, 'currentVersion' | 'updatedAt' | 'createdAt'> & { currentVersion?: number; createdAt?: number; updatedAt?: number }
  ): Promise<Artifact> {
    const now = Date.now();
    const existing = await this.getArtifact(artifact.id);

    const version = artifact.currentVersion ?? (existing ? existing.currentVersion + 1 : 1);
    const contentHash = artifact.contentHash || this.computeHash(artifact.contentText || artifact.filePath || '');
    const metadataStr = artifact.metadata ? JSON.stringify(artifact.metadata) : null;

    const record: Artifact = {
      id: artifact.id,
      name: artifact.name,
      type: artifact.type,
      mimeType: artifact.mimeType,
      currentVersion: version,
      contentHash,
      filePath: artifact.filePath,
      contentText: artifact.contentText,
      agentId: artifact.agentId,
      runId: artifact.runId,
      goalId: artifact.goalId,
      taskId: artifact.taskId,
      metadata: artifact.metadata,
      createdAt: existing ? existing.createdAt : (artifact.createdAt || now),
      updatedAt: now
    };

    if (existing) {
      await this.db.run(
        `UPDATE artifacts SET
          name = ?, type = ?, mime_type = ?, current_version = ?, content_hash = ?,
          file_path = ?, content_text = ?, agent_id = ?, run_id = ?, goal_id = ?, task_id = ?,
          metadata = ?, updated_at = ?
         WHERE id = ?`,
        [
          record.name,
          record.type,
          record.mimeType,
          record.currentVersion,
          record.contentHash,
          record.filePath || null,
          record.contentText || null,
          record.agentId || null,
          record.runId || null,
          record.goalId || null,
          record.taskId || null,
          metadataStr,
          record.updatedAt,
          record.id
        ]
      );
    } else {
      await this.db.run(
        `INSERT INTO artifacts (
          id, name, type, mime_type, current_version, content_hash,
          file_path, content_text, agent_id, run_id, goal_id, task_id,
          metadata, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.name,
          record.type,
          record.mimeType,
          record.currentVersion,
          record.contentHash,
          record.filePath || null,
          record.contentText || null,
          record.agentId || null,
          record.runId || null,
          record.goalId || null,
          record.taskId || null,
          metadataStr,
          record.createdAt,
          record.updatedAt
        ]
      );
    }

    // Save snapshot in artifact_versions
    await this.saveVersion({
      id: `ver_${record.id}_${record.currentVersion}`,
      artifactId: record.id,
      version: record.currentVersion,
      contentHash: record.contentHash,
      filePath: record.filePath,
      contentText: record.contentText,
      metadata: record.metadata,
      createdAt: now
    });

    return record;
  }

  async getArtifact(id: string): Promise<Artifact | null> {
    const row = await this.db.get(`SELECT * FROM artifacts WHERE id = ?`, [id]);
    if (!row) return null;
    return this.mapArtifact(row);
  }

  async getArtifactByName(name: string): Promise<Artifact | null> {
    const row = await this.db.get(`SELECT * FROM artifacts WHERE name = ? ORDER BY updated_at DESC LIMIT 1`, [name]);
    if (!row) return null;
    return this.mapArtifact(row);
  }

  async saveVersion(version: ArtifactVersion): Promise<ArtifactVersion> {
    const metadataStr = version.metadata ? JSON.stringify(version.metadata) : null;
    await this.db.run(
      `INSERT OR REPLACE INTO artifact_versions (
        id, artifact_id, version, content_hash, file_path, content_text, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        version.id,
        version.artifactId,
        version.version,
        version.contentHash,
        version.filePath || null,
        version.contentText || null,
        metadataStr,
        version.createdAt
      ]
    );
    return version;
  }

  async listVersions(artifactId: string): Promise<ArtifactVersion[]> {
    const rows = await this.db.all(
      `SELECT * FROM artifact_versions WHERE artifact_id = ? ORDER BY version ASC`,
      [artifactId]
    );
    return rows.map(r => ({
      id: r.id,
      artifactId: r.artifact_id,
      version: r.version,
      contentHash: r.content_hash,
      filePath: r.file_path || undefined,
      contentText: r.content_text || undefined,
      metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
      createdAt: r.created_at
    }));
  }

  async listArtifacts(filter?: { type?: ArtifactType; runId?: string; goalId?: string; limit?: number }): Promise<Artifact[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.type) {
      conditions.push('type = ?');
      params.push(filter.type);
    }
    if (filter?.runId) {
      conditions.push('run_id = ?');
      params.push(filter.runId);
    }
    if (filter?.goalId) {
      conditions.push('goal_id = ?');
      params.push(filter.goalId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit || 100;
    const sql = `SELECT * FROM artifacts ${whereClause} ORDER BY updated_at DESC LIMIT ?`;
    params.push(limit);

    const rows = await this.db.all(sql, params);
    return rows.map(r => this.mapArtifact(r));
  }

  async deleteArtifact(id: string): Promise<boolean> {
    await this.db.run(`DELETE FROM artifact_versions WHERE artifact_id = ?`, [id]);
    const res = await this.db.run(`DELETE FROM artifacts WHERE id = ?`, [id]);
    return (res.changes || 0) > 0;
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  private mapArtifact(row: any): Artifact {
    return {
      id: row.id,
      name: row.name,
      type: row.type,
      mimeType: row.mime_type,
      currentVersion: row.current_version,
      contentHash: row.content_hash,
      filePath: row.file_path || undefined,
      contentText: row.content_text || undefined,
      agentId: row.agent_id || undefined,
      runId: row.run_id || undefined,
      goalId: row.goal_id || undefined,
      taskId: row.task_id || undefined,
      metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
