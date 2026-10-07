import {
  SessionSearchStore,
  SessionSearchEntry,
  SessionSearchFilter,
  SessionSearchResult
} from '../storage/stores/types.js';

export type SessionSearchCategory =
  | 'message'
  | 'tool_call'
  | 'tool_output'
  | 'plan'
  | 'decision'
  | 'thought'
  | 'event'
  | 'run'
  | 'artifact'
  | 'error';

export interface IndexEntryParams {
  id?: string;
  category: SessionSearchCategory;
  contentText: string;
  sessionId?: string;
  runId?: string;
  goalId?: string;
  taskId?: string;
  workspaceId?: number;
  projectId?: number;
  agentId?: string;
  metadata?: Record<string, any>;
  timestamp?: number;
}

export class SessionSearchEngine {
  constructor(private store: SessionSearchStore) {}

  async indexEntry(params: IndexEntryParams): Promise<string> {
    const id = params.id || `sse_${params.category}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    await this.store.indexEntry({
      id,
      category: params.category,
      contentText: params.contentText,
      sessionId: params.sessionId,
      runId: params.runId,
      goalId: params.goalId,
      taskId: params.taskId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      agentId: params.agentId,
      metadata: params.metadata,
      timestamp: params.timestamp || Date.now()
    });
    return id;
  }

  async indexToolCall(params: {
    runId: string;
    toolName: string;
    args: Record<string, any>;
    sessionId?: string;
    goalId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
  }): Promise<string> {
    const text = `ToolCall: ${params.toolName} | Args: ${JSON.stringify(params.args)}`;
    return this.indexEntry({
      category: 'tool_call',
      contentText: text,
      runId: params.runId,
      sessionId: params.sessionId,
      goalId: params.goalId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      agentId: params.agentId,
      metadata: { toolName: params.toolName, args: params.args }
    });
  }

  async indexToolOutput(params: {
    runId: string;
    toolName: string;
    output: string;
    sessionId?: string;
    goalId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
  }): Promise<string> {
    const text = `ToolResult: ${params.toolName} | Output: ${params.output}`;
    return this.indexEntry({
      category: 'tool_output',
      contentText: text,
      runId: params.runId,
      sessionId: params.sessionId,
      goalId: params.goalId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      agentId: params.agentId,
      metadata: { toolName: params.toolName, outputLength: params.output.length }
    });
  }

  async indexMessage(params: {
    sessionId: string;
    role: string;
    text: string;
    runId?: string;
    goalId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
  }): Promise<string> {
    const text = `[${params.role.toUpperCase()}]: ${params.text}`;
    return this.indexEntry({
      category: 'message',
      contentText: text,
      sessionId: params.sessionId,
      runId: params.runId,
      goalId: params.goalId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      agentId: params.agentId,
      metadata: { role: params.role }
    });
  }

  async indexPlan(params: {
    runId: string;
    planText: string;
    sessionId?: string;
    goalId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
  }): Promise<string> {
    return this.indexEntry({
      category: 'plan',
      contentText: `Plan: ${params.planText}`,
      runId: params.runId,
      sessionId: params.sessionId,
      goalId: params.goalId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      agentId: params.agentId
    });
  }

  async indexDecision(params: {
    runId: string;
    decisionText: string;
    sessionId?: string;
    goalId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
  }): Promise<string> {
    return this.indexEntry({
      category: 'decision',
      contentText: `Decision: ${params.decisionText}`,
      runId: params.runId,
      sessionId: params.sessionId,
      goalId: params.goalId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      agentId: params.agentId
    });
  }

  async indexThought(params: {
    runId: string;
    thoughtText: string;
    sessionId?: string;
    goalId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
  }): Promise<string> {
    return this.indexEntry({
      category: 'thought',
      contentText: `Thought: ${params.thoughtText}`,
      runId: params.runId,
      sessionId: params.sessionId,
      goalId: params.goalId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      agentId: params.agentId
    });
  }

  async indexError(params: {
    runId: string;
    errorText: string;
    sessionId?: string;
    goalId?: string;
    workspaceId?: number;
    projectId?: number;
    agentId?: string;
  }): Promise<string> {
    return this.indexEntry({
      category: 'error',
      contentText: `Error: ${params.errorText}`,
      runId: params.runId,
      sessionId: params.sessionId,
      goalId: params.goalId,
      workspaceId: params.workspaceId,
      projectId: params.projectId,
      agentId: params.agentId
    });
  }

  async search(filter: SessionSearchFilter): Promise<SessionSearchResult[]> {
    return this.store.search(filter);
  }
}
