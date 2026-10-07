import { Database } from 'sqlite';
import { UserAccount, UserPreferences, PermissionModel } from '../../identityTypes.js';
import { UserStore } from '../types.js';

function parseJson<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return fallback;
  }
}

function rowToUser(row: any): UserAccount {
  return {
    id: row.id,
    name: row.name,
    preferences: parseJson<UserPreferences>(row.preferences, {}),
    permissions: parseJson<PermissionModel>(row.permissions, { toolPermissions: [] }),
    relationships: parseJson<Record<string, string>>(row.relationships, {}),
    routines: parseJson<string[]>(row.routines, []),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export class SqliteUserStore implements UserStore {
  constructor(private db: Database) {}

  async get(id: string): Promise<UserAccount | null> {
    const row = await this.db.get(`SELECT * FROM users WHERE id = ?`, id);
    return row ? rowToUser(row) : null;
  }

  async list(): Promise<UserAccount[]> {
    const rows = await this.db.all(`SELECT * FROM users ORDER BY created_at ASC`);
    return rows.map(rowToUser);
  }

  async save(user: UserAccount): Promise<UserAccount> {
    const existing = await this.get(user.id);
    const now = Date.now();
    const stored: UserAccount = {
      ...user,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };

    await this.db.run(
      `INSERT INTO users (id, name, preferences, permissions, relationships, routines, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         preferences = excluded.preferences,
         permissions = excluded.permissions,
         relationships = excluded.relationships,
         routines = excluded.routines,
         updated_at = excluded.updated_at`,
      stored.id,
      stored.name,
      JSON.stringify(stored.preferences),
      JSON.stringify(stored.permissions),
      JSON.stringify(stored.relationships),
      JSON.stringify(stored.routines),
      stored.createdAt,
      stored.updatedAt
    );

    return stored;
  }
}
