import { EpisodicMemory } from './memory.js';

export interface BusEvent<T = any> {
  id: string;
  topic: string;
  payload: T;
  idempotencyKey?: string;
  timestamp: number;
  source?: string;
}

export type EventHandler<T = any> = (event: BusEvent<T>) => Promise<void> | void;

export interface PublishOptions {
  idempotencyKey?: string;
  dedupWindowMs?: number; // Defaults to 300,000ms (5 minutes)
  source?: string;
}

/**
 * EventBus provides a typed, decoupled event bus with wildcard topic subscriptions,
 * persistent audit logging, and automated idempotency deduplication.
 */
export class EventBus {
  private static instance: EventBus | null = null;
  private memory?: EpisodicMemory;
  private subscribers: Map<string, Set<EventHandler>> = new Map();
  private inMemoryDedup: Map<string, number> = new Map();
  private static readonly DEFAULT_DEDUP_WINDOW_MS = 300000; // 5 minutes

  constructor(memory?: EpisodicMemory) {
    this.memory = memory;
  }

  static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  setMemory(memory: EpisodicMemory) {
    this.memory = memory;
  }

  /**
   * Subscribes a handler to a topic pattern (supports exact match "timer:tick" or wildcards "timer:*", "*").
   * Returns an unsubscribe function.
   */
  subscribe<T = any>(topicPattern: string, handler: EventHandler<T>): () => void {
    if (!this.subscribers.has(topicPattern)) {
      this.subscribers.set(topicPattern, new Set());
    }
    this.subscribers.get(topicPattern)!.add(handler as EventHandler);

    return () => {
      const handlers = this.subscribers.get(topicPattern);
      if (handlers) {
        handlers.delete(handler as EventHandler);
        if (handlers.size === 0) {
          this.subscribers.delete(topicPattern);
        }
      }
    };
  }

  /**
   * Publishes an event to the bus.
   * If an idempotencyKey is supplied, duplicate events within the deduplication window are safely dropped.
   * Returns true if event was processed, false if dropped as duplicate.
   */
  async publish<T = any>(topic: string, payload: T, options?: PublishOptions): Promise<boolean> {
    const now = Date.now();
    const dedupWindowMs = options?.dedupWindowMs ?? EventBus.DEFAULT_DEDUP_WINDOW_MS;

    // 1. Idempotency Check
    if (options?.idempotencyKey) {
      const isDuplicate = await this.checkDuplicate(options.idempotencyKey, dedupWindowMs, now);
      if (isDuplicate) {
        return false;
      }
    }

    const event: BusEvent<T> = {
      id: `evt_${now}_${Math.random().toString(36).substring(2, 7)}`,
      topic,
      payload,
      idempotencyKey: options?.idempotencyKey,
      timestamp: now,
      source: options?.source || 'system'
    };

    // 2. Audit Trail & Persistence
    if (this.memory) {
      try {
        await this.memory.recordEventLog({
          id: event.id,
          topic: event.topic,
          idempotencyKey: event.idempotencyKey,
          payload: typeof event.payload === 'string' ? event.payload : JSON.stringify(event.payload),
          status: 'processed',
          source: event.source
        });
      } catch (err) {
        console.warn(`[EventBus] Failed to persist event log for ${event.id}:`, err);
      }
    }

    // 3. Dispatch to matching subscribers
    const matchingHandlers = this.getMatchingHandlers(topic);
    if (matchingHandlers.length > 0) {
      // Dispatch concurrently without blocking or crashing on single subscriber failures
      await Promise.allSettled(
        matchingHandlers.map(handler => {
          try {
            return Promise.resolve(handler(event));
          } catch (err) {
            return Promise.reject(err);
          }
        })
      );
    }

    return true;
  }

  private async checkDuplicate(key: string, windowMs: number, now: number): Promise<boolean> {
    // In-memory check first
    const lastSeen = this.inMemoryDedup.get(key);
    if (lastSeen && (now - lastSeen) < windowMs) {
      return true;
    }

    // Database check
    if (this.memory) {
      try {
        const existing = await this.memory.getEventByIdempotencyKey(key, windowMs);
        if (existing) {
          this.inMemoryDedup.set(key, existing.created_at || now);
          return true;
        }
      } catch (err) {
        console.warn(`[EventBus] DB idempotency check failed:`, err);
      }
    }

    // Register in in-memory map and clean stale entries
    this.inMemoryDedup.set(key, now);
    this.cleanStaleDedupEntries(now, windowMs);
    return false;
  }

  private cleanStaleDedupEntries(now: number, windowMs: number) {
    if (this.inMemoryDedup.size > 1000) {
      for (const [k, timestamp] of this.inMemoryDedup.entries()) {
        if (now - timestamp > windowMs) {
          this.inMemoryDedup.delete(k);
        }
      }
    }
  }

  private getMatchingHandlers(topic: string): EventHandler[] {
    const matched: EventHandler[] = [];
    for (const [pattern, handlers] of this.subscribers.entries()) {
      if (this.topicMatches(pattern, topic)) {
        for (const handler of handlers) {
          matched.push(handler);
        }
      }
    }
    return matched;
  }

  private topicMatches(pattern: string, topic: string): boolean {
    if (pattern === '*' || pattern === topic) return true;
    if (pattern.endsWith(':*')) {
      const prefix = pattern.slice(0, -1); // e.g. "timer:"
      return topic.startsWith(prefix);
    }
    return false;
  }
}
