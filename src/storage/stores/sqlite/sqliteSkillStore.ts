import { Database } from 'sqlite';
import {
  SkillRecord,
  SkillStore,
  SkillLifecycleStatus
} from '../types.js';

function rowToSkill(row: any): SkillRecord {
  return {
    id: row.id,
    name: row.name,
    version: row.version || '1.0.0',
    description: row.description || undefined,
    tags: row.tags ? JSON.parse(row.tags) : [],
    dependencies: row.dependencies ? JSON.parse(row.dependencies) : undefined,
    permissions: row.permissions ? JSON.parse(row.permissions) : undefined,
    triggers: row.triggers ? JSON.parse(row.triggers) : undefined,
    contentPath: row.content_path || undefined,
    status: row.status as SkillLifecycleStatus,
    invocations: row.invocations || 0,
    successCount: row.success_count || 0,
    failureCount: row.failure_count || 0,
    successRate: typeof row.success_rate === 'number' ? row.success_rate : 1.0,
    lastUsedAt: row.last_used_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteSkillStore implements SkillStore {
  constructor(private db: Database) {}

  async save(skill: SkillRecord): Promise<SkillRecord> {
    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO skill_records (
        id, name, version, description, tags,
        dependencies, permissions, triggers, content_path,
        status, invocations, success_count, failure_count,
        success_rate, last_used_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM skill_records WHERE id = ? OR name = ?), ?), ?)`,
      skill.id,
      skill.name,
      skill.version || '1.0.0',
      skill.description ?? null,
      JSON.stringify(skill.tags || []),
      skill.dependencies ? JSON.stringify(skill.dependencies) : null,
      skill.permissions ? JSON.stringify(skill.permissions) : null,
      skill.triggers ? JSON.stringify(skill.triggers) : null,
      skill.contentPath ?? null,
      skill.status,
      skill.invocations ?? 0,
      skill.successCount ?? 0,
      skill.failureCount ?? 0,
      skill.successRate ?? 1.0,
      skill.lastUsedAt ?? null,
      skill.id,
      skill.name,
      skill.createdAt || now,
      now
    );
    return (await this.get(skill.id)) || (await this.findByName(skill.name))!;
  }

  async get(id: string): Promise<SkillRecord | null> {
    const row = await this.db.get(`SELECT * FROM skill_records WHERE id = ?`, id);
    return row ? rowToSkill(row) : null;
  }

  async findByName(name: string): Promise<SkillRecord | null> {
    const row = await this.db.get(`SELECT * FROM skill_records WHERE name = ? LIMIT 1`, name);
    return row ? rowToSkill(row) : null;
  }

  async list(filter?: { status?: SkillLifecycleStatus; limit?: number }): Promise<SkillRecord[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filter?.status) {
      conditions.push('status = ?');
      params.push(filter.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter?.limit || 100;
    const rows = await this.db.all(`SELECT * FROM skill_records ${whereClause} ORDER BY name ASC LIMIT ?`, ...params, limit);
    return rows.map(rowToSkill);
  }

  async updateStatus(idOrName: string, status: SkillLifecycleStatus): Promise<void> {
    await this.db.run(
      `UPDATE skill_records SET status = ?, updated_at = ? WHERE id = ? OR name = ?`,
      status,
      Date.now(),
      idOrName,
      idOrName
    );
  }

  async recordOutcome(nameOrId: string, success: boolean): Promise<void> {
    const existing = (await this.get(nameOrId)) || (await this.findByName(nameOrId));
    if (!existing) return;

    const invocations = existing.invocations + 1;
    const successCount = existing.successCount + (success ? 1 : 0);
    const failureCount = existing.failureCount + (success ? 0 : 1);
    const successRate = invocations > 0 ? successCount / invocations : 1.0;

    await this.db.run(
      `UPDATE skill_records SET
        invocations = ?,
        success_count = ?,
        failure_count = ?,
        success_rate = ?,
        last_used_at = ?,
        updated_at = ?
      WHERE id = ?`,
      invocations,
      successCount,
      failureCount,
      successRate,
      Date.now(),
      Date.now(),
      existing.id
    );
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM skill_records WHERE id = ? OR name = ?`, id, id);
    return (res.changes || 0) > 0;
  }
}
