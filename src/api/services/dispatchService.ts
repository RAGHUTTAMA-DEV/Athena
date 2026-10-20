import { RunStore } from '../../storage/stores/types.js';
import { RunState } from '../../runtime/runState.js';
import { SSEManager } from '../events/sseManager.js';
import { createEventEnvelope } from '../events/eventEnvelope.js';

export interface DispatchMessageInput {
  sessionId: string;
  content: string;
  idempotencyKey?: string;
  attachments?: any[];
  metadata?: Record<string, any>;
  workspaceId?: number;
}

export interface DispatchResult {
  messageId: string;
  runId: string;
  status: string;
  eventsUrl: string;
  isDuplicate?: boolean;
}

export class DispatchService {
  private idempotencyCache: Map<string, DispatchResult> = new Map();

  constructor(
    private runStore: RunStore,
    private sseManager: SSEManager
  ) {}

  async submitMessage(input: DispatchMessageInput): Promise<DispatchResult> {
    if (!input.content || input.content.trim() === '') {
      throw new Error('Message content cannot be empty');
    }

    // 1. Idempotency check
    if (input.idempotencyKey && this.idempotencyCache.has(input.idempotencyKey)) {
      const cached = this.idempotencyCache.get(input.idempotencyKey)!;
      return { ...cached, isDuplicate: true };
    }

    const now = Date.now();
    const runId = `run_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const messageId = `msg_${now}_${Math.random().toString(36).slice(2, 7)}`;

    // 2. Persist Initial Run State
    const runState: RunState = {
      runId,
      rootRunId: runId,
      sessionId: input.sessionId,
      task: input.content,
      status: 'queued',
      currentTurn: 0,
      budget: { maxTurns: 20 },
      usage: {
        elapsedTimeMs: 0,
        tokens: { input: 0, output: 0, total: 0 },
        costUsd: 0,
        toolCallsCount: 0,
        turnsCount: 0
      },
      idempotencyKeys: input.idempotencyKey ? [input.idempotencyKey] : [],
      createdAt: now,
      updatedAt: now
    };

    await this.runStore.save(runState);

    // 3. Emit SSE Lifecycle Events
    this.sseManager.broadcast(
      createEventEnvelope('message.started', { messageId, content: input.content }, {
        runId,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId ? String(input.workspaceId) : undefined
      })
    );

    this.sseManager.broadcast(
      createEventEnvelope('run.queued', { runId, status: 'queued' }, {
        runId,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId ? String(input.workspaceId) : undefined
      })
    );

    const result: DispatchResult = {
      messageId,
      runId,
      status: 'queued',
      eventsUrl: `/api/v1/runs/${runId}/events`
    };

    if (input.idempotencyKey) {
      this.idempotencyCache.set(input.idempotencyKey, result);
    }

    return result;
  }
}
