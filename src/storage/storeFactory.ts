import { Database } from 'sqlite';
import { AthenaDatabase } from './database.js';
import { createSqliteStores, SqliteStores } from './stores/sqlite/index.js';
import { PostgresDatabase } from './postgres/postgresDatabase.js';
import { POSTGRES_MIGRATIONS } from './postgres/postgresMigrations.js';
import { createPostgresStores, PostgresStores } from './postgres/postgresStores/index.js';

export type DatabaseDriver = 'sqlite' | 'postgres';

export interface StorageConfig {
  driver?: DatabaseDriver;
  sqlitePath?: string;
  postgresUrl?: string;
  postgresHost?: string;
  postgresPort?: number;
  postgresDatabase?: string;
  postgresUser?: string;
  postgresPassword?: string;
}

export type StoreBundle = SqliteStores | (PostgresStores & Partial<SqliteStores>);

export interface InitializedStorage {
  driver: DatabaseDriver;
  stores: any;
  sqliteDb?: Database;
  postgresDb?: PostgresDatabase;
  close: () => Promise<void>;
  ping: () => Promise<boolean>;
}

export async function createStorage(config?: StorageConfig): Promise<InitializedStorage> {
  const driver: DatabaseDriver = (
    config?.driver ||
    (process.env.DATABASE_DRIVER as DatabaseDriver) ||
    'sqlite'
  ).toLowerCase() as DatabaseDriver;

  if (driver === 'postgres') {
    const connStr = config?.postgresUrl || process.env.DATABASE_URL;
    if (!connStr && !config?.postgresHost && !process.env.POSTGRES_HOST) {
      throw new Error(
        'PostgreSQL configuration error: DATABASE_DRIVER=postgres selected but DATABASE_URL or POSTGRES_HOST is missing'
      );
    }

    const pgDb = new PostgresDatabase({
      connectionString: connStr,
      host: config?.postgresHost || process.env.POSTGRES_HOST,
      port: config?.postgresPort || (process.env.POSTGRES_PORT ? parseInt(process.env.POSTGRES_PORT, 10) : 5432),
      database: config?.postgresDatabase || process.env.POSTGRES_DB,
      user: config?.postgresUser || process.env.POSTGRES_USER,
      password: config?.postgresPassword || process.env.POSTGRES_PASSWORD,
    });

    await pgDb.migrate(POSTGRES_MIGRATIONS);
    const pgStores = createPostgresStores(pgDb);

    return {
      driver: 'postgres',
      stores: pgStores,
      postgresDb: pgDb,
      close: async () => {
        await pgDb.close();
      },
      ping: async () => {
        return pgDb.ping();
      }
    };
  } else {
    // SQLite default
    const dbPath = config?.sqlitePath || process.env.DATABASE_PATH || './state.db';
    const athenaDb = await AthenaDatabase.open(dbPath);
    const sqliteHandle = athenaDb.getHandle();
    const sqliteStores = createSqliteStores(sqliteHandle);

    return {
      driver: 'sqlite',
      stores: sqliteStores,
      sqliteDb: sqliteHandle,
      close: async () => {
        await sqliteHandle.close();
      },
      ping: async () => {
        try {
          const res = await sqliteHandle.get('SELECT 1 as ok');
          return (res as any)?.ok === 1;
        } catch {
          return false;
        }
      }
    };
  }
}
