import { Database } from 'sqlite';
import { SqliteAgentStore } from './sqliteAgentStore.js';
import { SqliteUserStore } from './sqliteUserStore.js';
import { SqliteWorkspaceStore, SqliteProjectStore } from './sqliteWorkspaceStore.js';
import { SqliteRunStore, SqliteEventStore } from './sqliteRunStore.js';

export { SqliteAgentStore } from './sqliteAgentStore.js';
export { SqliteUserStore } from './sqliteUserStore.js';
export { SqliteWorkspaceStore, SqliteProjectStore } from './sqliteWorkspaceStore.js';
export { SqliteRunStore, SqliteEventStore } from './sqliteRunStore.js';

export interface SqliteStores {
  agent: SqliteAgentStore;
  user: SqliteUserStore;
  workspace: SqliteWorkspaceStore;
  project: SqliteProjectStore;
  run: SqliteRunStore;
  event: SqliteEventStore;
}

export function createSqliteStores(db: Database): SqliteStores {
  return {
    agent: new SqliteAgentStore(db),
    user: new SqliteUserStore(db),
    workspace: new SqliteWorkspaceStore(db),
    project: new SqliteProjectStore(db),
    run: new SqliteRunStore(db),
    event: new SqliteEventStore(db)
  };
}
