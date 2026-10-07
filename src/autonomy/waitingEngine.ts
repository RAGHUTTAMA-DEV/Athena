import { EventBus, BusEvent } from '../background/eventBus.js';
import { RunWaitStore, RunStore } from '../storage/stores/types.js';
import { RunWait, WaitType, WaitStatus } from './goalTypes.js';

export function matchesTopic(pattern: string, topic: string): boolean {
  if (pattern === '*' || pattern === topic) return true;
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -2);
    return topic === prefix || topic.startsWith(prefix + ':');
  }
  return false;
}

export function matchesCriteria(criteria: Record<string, any> | null | undefined, payload: any): boolean {
  if (!criteria || Object.keys(criteria).length === 0) return true;
  if (!payload || typeof payload !== 'object') return false;

  for (const [key, expectedValue] of Object.entries(criteria)) {
    if (payload[key] !== expectedValue) {
      return false;
    }
  }
  return true;
}

export class WaitingEngine {
  private unsubscribeBus?: () => void;

  constructor(
    private runWaitStore: RunWaitStore,
    private runStore: RunStore,
    private eventBus?: EventBus
  ) {
    if (this.eventBus) {
      this.attachEventBus(this.eventBus);
    }
  }

  attachEventBus(bus: EventBus): void {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
    }
    this.eventBus = bus;
    this.unsubscribeBus = bus.subscribe('*', async (event: BusEvent) => {
      await this.handleBusEvent(event);
    });
  }

  detach(): void {
    if (this.unsubscribeBus) {
      this.unsubscribeBus();
      this.unsubscribeBus = undefined;
    }
  }

  /**
   * Parks a run into durable waiting state. No setTimeout.
   */
  async parkRun(params: {
    runId: string;
    waitType: WaitType;
    eventPattern?: string | null;
    matcherCriteria?: Record<string, any> | null;
    deadline?: number | null;
    metadata?: Record<string, any> | null;
  }): Promise<RunWait> {
    const waitId = `wait_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    const wait: RunWait = {
      id: waitId,
      runId: params.runId,
      waitType: params.waitType,
      status: 'waiting',
      eventPattern: params.eventPattern || null,
      matcherCriteria: params.matcherCriteria || null,
      deadline: params.deadline || null,
      metadata: params.metadata || null,
      createdAt: now,
      updatedAt: now
    };

    const saved = await this.runWaitStore.create(wait);
    await this.runStore.update(params.runId, {
      status: 'waiting',
      updatedAt: now
    });

    return saved;
  }

  /**
   * Evaluates incoming EventBus events against all active waits.
   */
  async handleBusEvent(event: BusEvent): Promise<RunWait[]> {
    const activeWaits = await this.runWaitStore.listActive();
    const satisfiedWaits: RunWait[] = [];

    for (const wait of activeWaits) {
      if (wait.waitType !== 'WAITING_FOR_EVENT') continue;
      if (!wait.eventPattern) continue;

      if (matchesTopic(wait.eventPattern, event.topic) && matchesCriteria(wait.matcherCriteria, event.payload)) {
        const updated = await this.runWaitStore.update(wait.id, {
          status: 'satisfied',
          waitResult: {
            eventId: event.id,
            topic: event.topic,
            payload: event.payload,
            timestamp: event.timestamp
          }
        });

        await this.runStore.update(wait.runId, {
          status: 'queued',
          updatedAt: Date.now()
        });

        satisfiedWaits.push(updated);
      }
    }

    return satisfiedWaits;
  }

  /**
   * Resolves an approval wait (CLI/gateway/user channel).
   */
  async resolveApproval(
    waitIdOrRunId: string,
    approved: boolean,
    note?: string
  ): Promise<RunWait> {
    const wait = await this.findWait(waitIdOrRunId);
    if (!wait) {
      throw new Error(`Wait record not found for "${waitIdOrRunId}"`);
    }

    const newStatus: WaitStatus = approved ? 'satisfied' : 'cancelled';
    const updatedWait = await this.runWaitStore.update(wait.id, {
      status: newStatus,
      waitResult: { approved, note, resolvedAt: Date.now() }
    });

    await this.runStore.update(wait.runId, {
      status: approved ? 'queued' : 'cancelled',
      terminationReason: approved ? undefined : 'user_cancelled',
      updatedAt: Date.now()
    });

    return updatedWait;
  }

  /**
   * Resolves a user reply wait.
   */
  async resolveUserReply(
    waitIdOrRunId: string,
    replyText: string
  ): Promise<RunWait> {
    const wait = await this.findWait(waitIdOrRunId);
    if (!wait) {
      throw new Error(`Wait record not found for "${waitIdOrRunId}"`);
    }

    const updatedWait = await this.runWaitStore.update(wait.id, {
      status: 'satisfied',
      waitResult: { reply: replyText, resolvedAt: Date.now() }
    });

    await this.runStore.update(wait.runId, {
      status: 'queued',
      updatedAt: Date.now()
    });

    return updatedWait;
  }

  /**
   * Scans active waits and marks expired deadlines as timed out.
   */
  async checkTimeouts(now: number = Date.now()): Promise<RunWait[]> {
    const activeWaits = await this.runWaitStore.listActive();
    const timedOutWaits: RunWait[] = [];

    for (const wait of activeWaits) {
      if (wait.deadline && wait.deadline <= now) {
        const updated = await this.runWaitStore.update(wait.id, {
          status: 'timed_out',
          waitResult: { error: 'Wait deadline exceeded', expiredAt: now }
        });

        await this.runStore.update(wait.runId, {
          status: 'failed',
          terminationReason: 'timeout',
          error: {
            category: 'timeout',
            code: 'WAIT_DEADLINE_EXCEEDED',
            message: `Wait deadline (${wait.deadline}) reached without satisfaction.`,
            retryable: false
          },
          updatedAt: now
        });

        timedOutWaits.push(updated);
      }
    }

    return timedOutWaits;
  }

  private async findWait(waitIdOrRunId: string): Promise<RunWait | null> {
    let wait = await this.runWaitStore.get(waitIdOrRunId);
    if (!wait) {
      wait = await this.runWaitStore.getByRunId(waitIdOrRunId);
    }
    return wait;
  }
}
