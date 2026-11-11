export type AthenaEventFamily =
  | 'run.queued'
  | 'run.started'
  | 'run.progress'
  | 'run.waiting_for_approval'
  | 'run.cancellation_requested'
  | 'run.completed'
  | 'message.started'
  | 'message.delta'
  | 'message.completed'
  | 'agent.progress'
  | 'tool.started'
  | 'tool.progress'
  | 'tool.completed'
  | 'subagent.started'
  | 'subagent.progress'
  | 'subagent.completed'
  | 'approval.required'
  | 'approval.resolved'
  | 'artifact.created'
  | 'artifact.updated'
  | 'task.updated'
  | 'heartbeat';

export interface AthenaEventEnvelope<T = any> {
  eventId: string;
  schemaVersion: 1;
  type: AthenaEventFamily;
  timestamp: string;
  workspaceId?: string;
  sessionId?: string;
  runId?: string;
  data: T;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

