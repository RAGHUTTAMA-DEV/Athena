import { Database } from 'sqlite';
import { BrowserProfileRecord, BrowserProfileStore } from '../types.js';

function rowToProfile(row: any): BrowserProfileRecord {
  return {
    id: row.id,
    agentId: row.agent_id || null,
    taskId: row.task_id || null,
    name: row.name,
    userDataDir: row.user_data_dir,
    cookiesCount: row.cookies_count || 0,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteBrowserProfileStore implements BrowserProfileStore {
  constructor(private db: Database) {}

  async save(profile: BrowserProfileRecord): Promise<BrowserProfileRecord> {
    const now = Date.now();
    await this.db.run(
      `INSERT OR REPLACE INTO browser_profiles (
        id, agent_id, task_id, name, user_data_dir,
        cookies_count, metadata, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM browser_profiles WHERE id = ?), ?), ?)`,
      profile.id,
      profile.agentId ?? null,
      profile.taskId ?? null,
      profile.name,
      profile.userDataDir,
      profile.cookiesCount ?? 0,
      profile.metadata ? JSON.stringify(profile.metadata) : null,
      profile.id,
      profile.createdAt || now,
      now
    );
    return (await this.get(profile.id))!;
  }

  async get(id: string): Promise<BrowserProfileRecord | null> {
    const row = await this.db.get(`SELECT * FROM browser_profiles WHERE id = ?`, id);
    return row ? rowToProfile(row) : null;
  }

  async findByName(name: string): Promise<BrowserProfileRecord | null> {
    const row = await this.db.get(
      `SELECT * FROM browser_profiles WHERE name = ? ORDER BY updated_at DESC LIMIT 1`,
      name
    );
    return row ? rowToProfile(row) : null;
  }

  async findByAgent(agentId: string): Promise<BrowserProfileRecord[]> {
    const rows = await this.db.all(
      `SELECT * FROM browser_profiles WHERE agent_id = ? ORDER BY updated_at DESC`,
      agentId
    );
    return rows.map(rowToProfile);
  }

  async findByTask(taskId: string): Promise<BrowserProfileRecord[]> {
    const rows = await this.db.all(
      `SELECT * FROM browser_profiles WHERE task_id = ? ORDER BY updated_at DESC`,
      taskId
    );
    return rows.map(rowToProfile);
  }

  async list(filter: { agentId?: string; taskId?: string; limit?: number } = {}): Promise<BrowserProfileRecord[]> {
    let sql = `SELECT * FROM browser_profiles WHERE 1=1`;
    const params: any[] = [];
    if (filter.agentId !== undefined) {
      sql += ` AND agent_id = ?`;
      params.push(filter.agentId);
    }
    if (filter.taskId !== undefined) {
      sql += ` AND task_id = ?`;
      params.push(filter.taskId);
    }
    sql += ` ORDER BY updated_at DESC LIMIT ?`;
    params.push(filter.limit ?? 100);
    const rows = await this.db.all(sql, ...params);
    return rows.map(rowToProfile);
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.db.run(`DELETE FROM browser_profiles WHERE id = ?`, id);
    return (res.changes || 0) > 0;
  }
}
