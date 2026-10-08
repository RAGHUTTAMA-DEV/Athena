import { Database } from 'sqlite';
import { SqliteAgentStore } from './sqliteAgentStore.js';
import { SqliteUserStore } from './sqliteUserStore.js';
import { SqliteWorkspaceStore, SqliteProjectStore } from './sqliteWorkspaceStore.js';
import { SqliteRunStore, SqliteEventStore } from './sqliteRunStore.js';
import { SqliteGoalStore } from './sqliteGoalStore.js';
import { SqliteTaskStore } from './sqliteTaskStore.js';
import { SqliteRunWaitStore } from './sqliteRunWaitStore.js';
import { SqliteMemoryStore } from './sqliteMemoryStore.js';
import { SqliteSessionSearchStore } from './sqliteSessionSearchStore.js';
import { SqliteVectorStore } from './sqliteVectorStore.js';
import { SqliteResearchDocumentStore } from './sqliteResearchDocumentStore.js';
import { SqliteBrowserProfileStore } from './sqliteBrowserProfileStore.js';
import { SqliteRoutineStore } from './sqliteRoutineStore.js';
import { SqliteLearnedWorkflowStore } from './sqliteLearnedWorkflowStore.js';
import { SqliteSkillStore } from './sqliteSkillStore.js';
import { SqliteAgentMessageStore } from './sqliteAgentMessageStore.js';
import { SqliteAgentTeamStore } from './sqliteAgentTeamStore.js';
import { SqliteDurableAgentEventStore } from './sqliteDurableAgentEventStore.js';
import { SqliteWebhookStore } from './sqliteWebhookStore.js';
import { SqliteHeartbeatStore } from './sqliteHeartbeatStore.js';
import { SqliteCommunicationStore } from './sqliteCommunicationStore.js';
import { SqliteCalendarStore } from './sqliteCalendarStore.js';

export { SqliteAgentStore } from './sqliteAgentStore.js';
export { SqliteUserStore } from './sqliteUserStore.js';
export { SqliteWorkspaceStore, SqliteProjectStore } from './sqliteWorkspaceStore.js';
export { SqliteRunStore, SqliteEventStore } from './sqliteRunStore.js';
export { SqliteGoalStore } from './sqliteGoalStore.js';
export { SqliteTaskStore } from './sqliteTaskStore.js';
export { SqliteRunWaitStore } from './sqliteRunWaitStore.js';
export { SqliteMemoryStore } from './sqliteMemoryStore.js';
export { SqliteSessionSearchStore } from './sqliteSessionSearchStore.js';
export { SqliteVectorStore } from './sqliteVectorStore.js';
export { SqliteResearchDocumentStore } from './sqliteResearchDocumentStore.js';
export { SqliteBrowserProfileStore } from './sqliteBrowserProfileStore.js';
export { SqliteRoutineStore } from './sqliteRoutineStore.js';
export { SqliteLearnedWorkflowStore } from './sqliteLearnedWorkflowStore.js';
export { SqliteSkillStore } from './sqliteSkillStore.js';
export { SqliteAgentMessageStore } from './sqliteAgentMessageStore.js';
export { SqliteAgentTeamStore } from './sqliteAgentTeamStore.js';
export { SqliteDurableAgentEventStore } from './sqliteDurableAgentEventStore.js';
export { SqliteWebhookStore } from './sqliteWebhookStore.js';
export { SqliteHeartbeatStore } from './sqliteHeartbeatStore.js';
export { SqliteCommunicationStore } from './sqliteCommunicationStore.js';
export { SqliteCalendarStore } from './sqliteCalendarStore.js';

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
  memory: SqliteMemoryStore;
  sessionSearch: SqliteSessionSearchStore;
  vector: SqliteVectorStore;
  researchDocument: SqliteResearchDocumentStore;
  browserProfile: SqliteBrowserProfileStore;
  routine: SqliteRoutineStore;
  learnedWorkflow: SqliteLearnedWorkflowStore;
  skill: SqliteSkillStore;
  agentMessage: SqliteAgentMessageStore;
  agentTeam: SqliteAgentTeamStore;
  durableEvent: SqliteDurableAgentEventStore;
  webhook: SqliteWebhookStore;
  heartbeat: SqliteHeartbeatStore;
  communication: SqliteCommunicationStore;
  calendar: SqliteCalendarStore;
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
    runWait: new SqliteRunWaitStore(db),
    memory: new SqliteMemoryStore(db),
    sessionSearch: new SqliteSessionSearchStore(db),
    vector: new SqliteVectorStore(db),
    researchDocument: new SqliteResearchDocumentStore(db),
    browserProfile: new SqliteBrowserProfileStore(db),
    routine: new SqliteRoutineStore(db),
    learnedWorkflow: new SqliteLearnedWorkflowStore(db),
    skill: new SqliteSkillStore(db),
    agentMessage: new SqliteAgentMessageStore(db),
    agentTeam: new SqliteAgentTeamStore(db),
    durableEvent: new SqliteDurableAgentEventStore(db),
    webhook: new SqliteWebhookStore(db),
    heartbeat: new SqliteHeartbeatStore(db),
    communication: new SqliteCommunicationStore(db),
    calendar: new SqliteCalendarStore(db)
  };
}


