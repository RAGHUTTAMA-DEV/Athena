import pg from 'pg';
const { Pool } = pg;

export interface PostgresConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  maxConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

export interface PostgresMigration {
  version: number;
  name: string;
  up: (client: pg.PoolClient) => Promise<void>;
}

export class PostgresDatabase {
  private pool: pg.Pool;

  constructor(config: PostgresConfig) {
    if (!config.connectionString && !config.host && !config.database) {
      throw new Error('PostgreSQL configuration missing: DATABASE_URL or host/database required');
    }

    this.pool = new Pool({
      connectionString: config.connectionString,
      host: config.host,
      port: config.port || 5432,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.maxConnections || 10,
      idleTimeoutMillis: config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: config.connectionTimeoutMillis || 5000,
    });
  }

  getPool(): pg.Pool {
    return this.pool;
  }

  async query<T extends pg.QueryResultRow = any>(sql: string, params?: any[]): Promise<pg.QueryResult<T>> {
    return this.pool.query<T>(sql, params);
  }

  async withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as ok');
      return res.rows[0]?.ok === 1;
    } catch {
      return false;
    }
  }

  async getUserVersion(): Promise<number> {
    try {
      const res = await this.pool.query(
        'SELECT COALESCE(MAX(version), 0) as version FROM schema_migrations'
      );
      return parseInt(res.rows[0]?.version || '0', 10);
    } catch {
      return 0;
    }
  }

  async migrate(migrations: PostgresMigration[]): Promise<void> {
    await this.withTransaction(async (client) => {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INT PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at BIGINT NOT NULL
        )
      `);
    });

    const currentVersion = await this.getUserVersion();
    const pending = migrations
      .filter((m) => m.version > currentVersion)
      .sort((a, b) => a.version - b.version);

    for (const migration of pending) {
      await this.withTransaction(async (client) => {
        await migration.up(client);
        await client.query(
          'INSERT INTO schema_migrations (version, name, applied_at) VALUES ($1, $2, $3)',
          [migration.version, migration.name, Date.now()]
        );
      });
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
