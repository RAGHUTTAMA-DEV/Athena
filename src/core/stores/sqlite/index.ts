import { Database } from 'sqlite';
import { SqliteAgentStore } from './sqliteAgentStore.js';
import { SqliteUserStore } from './sqliteUserStore.js';
import { SqliteWorkspaceStore, SqliteProjectStore } from './sqliteWorkspaceStore.js';
import { SqliteRunStore, SqliteEventStore } from './sqliteRunStore.js';
import { SqliteGoalStore } from './sqliteGoalStore.js';
import { SqliteTaskStore } from './sqliteTaskStore.js';
import { SqliteRunWaitStore } from './sqliteRunWaitStore.js';

export { SqliteAgentStore } from './sqliteAgentStore.js';
export { SqliteUserStore } from './sqliteUserStore.js';
export { SqliteWorkspaceStore, SqliteProjectStore } from './sqliteWorkspaceStore.js';
export { SqliteRunStore, SqliteEventStore } from './sqliteRunStore.js';
export { SqliteGoalStore } from './sqliteGoalStore.js';
export { SqliteTaskStore } from './sqliteTaskStore.js';
export { SqliteRunWaitStore } from './sqliteRunWaitStore.js';

export interface SqliteStores {
  agent: SqliteAgentStore;
  user: SqliteUserStore;
  workspace: SqliteWorkspaceStore;
  project: SqliteProjectStore;
  run: SqliteRunStore;
  event: SqliteEventStore;
  goal: SqliteGoalStore;
  task: SqliteTaskStore;
  runWait: SqliteRunWaitStore;
}

export function createSqliteStores(db: Database): SqliteStores {
  return {
    agent: new SqliteAgentStore(db),
    user: new SqliteUserStore(db),
    workspace: new SqliteWorkspaceStore(db),
    project: new SqliteProjectStore(db),
    run: new SqliteRunStore(db),
    event: new SqliteEventStore(db),
    goal: new SqliteGoalStore(db),
    task: new SqliteTaskStore(db),
    runWait: new SqliteRunWaitStore(db)
  };
}

