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

export function createEventEnvelope<T = any>(
  type: AthenaEventFamily,
  data: T,
  meta?: { runId?: string; sessionId?: string; workspaceId?: string }
): AthenaEventEnvelope<T> {
  const counter = Math.random().toString(36).substring(2, 8);
  return {
    eventId: `evt_${Date.now()}_${counter}`,
    schemaVersion: 1,
    type,
    timestamp: new Date().toISOString(),
    runId: meta?.runId,
    sessionId: meta?.sessionId,
    workspaceId: meta?.workspaceId,
    data
  };
}
