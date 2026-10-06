import { open, Database } from 'sqlite';
import sqlite3 from 'sqlite3';
import * as path from 'path';
import { MIGRATIONS, Migration } from './migrations/index.js';

/**
 * Shared SQLite database handle for Athena (V2).
 *
 * Responsibilities:
 *  - Open a single connection with an absolute path (cwd-independent).
 *  - Enable foreign key enforcement.
 *  - Run versioned migrations (PRAGMA user_version + schema_migrations audit table).
 *
 * Every store (AgentStore, RunStore, EventStore, ...) operates on the raw
 * `Database` handle exposed by this class so the PostgreSQL adapter in P12
 * only needs to swap this layer plus the store implementations.
 */
export interface MigrationRecord {
  version: number;
  name: string;
  appliedAt: number;
}

export interface AthenaDatabaseOptions {
  /** Override the built-in migration list (used by tests to simulate failures). */
  migrations?: Migration[];
}

export class AthenaDatabase {
  private db: Database;
  private dbPath: string;

  private constructor(db: Database, dbPath: string) {
    this.db = db;
    this.dbPath = dbPath;
  }

  get path(): string {
    return this.dbPath;
  }

  getHandle(): Database {
    return this.db;
  }

  static async open(dbPath: string, options?: AthenaDatabaseOptions): Promise<AthenaDatabase> {
    const resolvedPath = path.resolve(dbPath);
    const db = await open({
      filename: resolvedPath,
      driver: sqlite3.Database
    });
    await db.exec('PRAGMA foreign_keys = ON;');
    const handle = new AthenaDatabase(db, resolvedPath);
    await handle.migrate(options?.migrations ?? MIGRATIONS);
    return handle;
  }

  async getUserVersion(): Promise<number> {
    const row = await this.db.get('PRAGMA user_version');
    return (row as any)?.user_version ?? 0;
  }

  async getAppliedMigrations(): Promise<MigrationRecord[]> {
    const rows = await this.db.all(
      `SELECT version, name, applied_at as appliedAt FROM schema_migrations ORDER BY version ASC`
    );
    return rows as MigrationRecord[];
  }

  /**
   * Runs all pending migrations in order. Each migration is applied inside a
   * single IMMEDIATE transaction together with its schema_migrations record
   * and the PRAGMA user_version bump, so an interrupted (crashed) migration
   * rolls back completely and is retried on the next open.
   */
  private async migrate(migrations: Migration[]): Promise<void> {
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `);

    const current = await this.getUserVersion();
    const pending = migrations
      .filter(m => m.version > current)
      .sort((a, b) => a.version - b.version);

    if (pending.length === 0) return;

    for (const migration of pending) {
      await this.db.exec('BEGIN IMMEDIATE');
      try {
        await migration.up(this.db);
        await this.db.run(
          `INSERT OR REPLACE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`,
          migration.version,
          migration.name,
          Date.now()
        );
        // PRAGMA user_version is transactional in SQLite: it is stored in the
        // database header and rolls back with the transaction on failure.
        await this.db.exec(`PRAGMA user_version = ${migration.version}`);
        await this.db.exec('COMMIT');
      } catch (err: any) {
        await this.db.exec('ROLLBACK').catch(() => { /* connection may already be rolled back */ });
        throw new Error(
          `Migration ${migration.version} ("${migration.name}") failed and was rolled back: ${err?.message || err}`
        );
      }
    }
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null as any;
    }
  }
}

/**
 * Convenience helper: open + migrate and return the raw sqlite handle.
 * This is the integration point used by the EpisodicMemory facade so all
 * existing callers keep working unchanged.
 */
export async function openDatabase(dbPath: string): Promise<Database> {
  const handle = await AthenaDatabase.open(dbPath);
  return handle.getHandle();
}
