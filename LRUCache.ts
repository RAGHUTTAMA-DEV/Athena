/**
 * Eviction cause payload passed to telemetry listeners.
 */
export type EvictionReason = 'capacity' | 'byte_limit' | 'ttl' | 'manual';

/**
 * Options configuring LRU Cache operational limits.
 */
export interface LRUCacheOptions<K, V> {
  /** Maximum number of key-value pairs allowed in cache. */
  maxCapacity: number;
  /** Default Time-To-Live in milliseconds. Optional. */
  defaultTTLMs?: number;
  /** Maximum memory footprint allowed in bytes. Optional. */
  maxSizeBytes?: number;
  /** Custom sizing calculator for stored values. */
  sizeCalculator?: (value: V, key: K) => number;
  /** Interval in milliseconds for active background cleanup sweep. Default: 60000ms. */
  cleanupIntervalMs?: number;
  /** Eviction callback hook. */
  onEviction?: (key: K, value: V, reason: EvictionReason) => void;
}

/**
 * Cache metrics and telemetry counters.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  evictionsCount: number;
  itemCount: number;
  totalSizeBytes: number;
  hitRatio: number;
}

/**
 * Public Cache Interface definition.
 */
export interface ILRUCache<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V, ttlMs?: number): boolean;
  has(key: K): boolean;
  delete(key: K): boolean;
  peek(key: K): V | undefined;
  getOrFetch(key: K, fetcher: () => Promise<V>, ttlMs?: number): Promise<V>;
  clear(): void;
  purgeExpired(): number;
  getStats(): CacheStats;
  dispose(): void;
}

/**
 * Internal Doubly-Linked List Node representing a cache entry.
 */
export class ListNode<K, V> {
  public key: K;
  public value: V;
  public expiresAt: number | null; // Unix timestamp in ms or null for infinite
  public sizeBytes: number;
  public prev: ListNode<K, V> | null = null;
  public next: ListNode<K, V> | null = null;

  constructor(key: K, value: V, expiresAt: number | null, sizeBytes: number = 1) {
    this.key = key;
    this.value = value;
    this.expiresAt = expiresAt;
    this.sizeBytes = sizeBytes;
  }

  /**
   * Checks whether this node has passed its expiration time.
   */
  public isExpired(now: number = Date.now()): boolean {
    return this.expiresAt !== null && this.expiresAt <= now;
  }
}

/**
 * Lightweight asynchronous Mutex for managing async microtask critical sections.
 */
export class AsyncMutex {
  private locked = false;
  private queue: Array<(release: () => void) => void> = [];

  /**
   * Acquires lock, returning a promise that resolves to the release function.
   */
  public acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        if (this.queue.length > 0) {
          const next = this.queue.shift()!;
          next(release);
        } else {
          this.locked = false;
        }
      };

      if (!this.locked) {
        this.locked = true;
        resolve(release);
      } else {
        this.queue.push(resolve);
      }
    });
  }
}

/**
 * High-performance concurrent-safe LRU Cache implementation with per-key TTL.
 */
export class LRUCache<K, V> implements ILRUCache<K, V> {
  private readonly maxCapacity: number;
  private readonly defaultTTLMs?: number;
  private readonly maxSizeBytes?: number;
  private readonly sizeCalculator: (value: V, key: K) => number;
  private readonly onEviction?: (key: K, value: V, reason: EvictionReason) => void;

  private readonly map = new Map<K, ListNode<K, V>>();
  private readonly headSentinel: ListNode<K, V>;
  private readonly tailSentinel: ListNode<K, V>;

  private currentSizeBytes = 0;
  private hits = 0;
  private misses = 0;
  private evictionsCount = 0;

  private cleanupTimer?: NodeJS.Timeout;
  private readonly mutex = new AsyncMutex();
  private readonly pendingFetches = new Map<K, Promise<V>>();

  constructor(options: LRUCacheOptions<K, V>) {
    if (options.maxCapacity <= 0) {
      throw new Error("InvalidCapacityError: maxCapacity must be > 0");
    }
    this.maxCapacity = options.maxCapacity;
    this.defaultTTLMs = options.defaultTTLMs;
    this.maxSizeBytes = options.maxSizeBytes;
    this.sizeCalculator = options.sizeCalculator ?? (() => 1);
    this.onEviction = options.onEviction;

    // Initialize Sentinel Nodes
    this.headSentinel = new ListNode<K, V>(null as unknown as K, null as unknown as V, null);
    this.tailSentinel = new ListNode<K, V>(null as unknown as K, null as unknown as V, null);
    this.headSentinel.next = this.tailSentinel;
    this.tailSentinel.prev = this.headSentinel;

    if (options.cleanupIntervalMs && options.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => this.purgeExpired(), options.cleanupIntervalMs);
      if (this.cleanupTimer.unref) {
        this.cleanupTimer.unref(); // Avoid holding Node process open
      }
    }
  }

  // --- Core Cache Operations ---

  /**
   * Retrieves an item from the cache. Updates LRU order if found and valid.
   */
  public get(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node) {
      this.misses++;
      return undefined;
    }

    if (node.isExpired()) {
      this.misses++;
      this.removeNodeInternal(node, 'ttl');
      return undefined;
    }

    this.hits++;
    this.moveToHead(node);
    return node.value;
  }

  /**
   * Inserts or updates a value in the cache with an optional TTL override.
   */
  public set(key: K, value: V, ttlMs?: number): boolean {
    const effectiveTTL = ttlMs ?? this.defaultTTLMs;
    const expiresAt = effectiveTTL !== undefined ? Date.now() + effectiveTTL : null;
    const sizeBytes = this.sizeCalculator(value, key);

    const existingNode = this.map.get(key);
    if (existingNode) {
      this.currentSizeBytes -= existingNode.sizeBytes;
      existingNode.value = value;
      existingNode.expiresAt = expiresAt;
      existingNode.sizeBytes = sizeBytes;
      this.currentSizeBytes += sizeBytes;
      this.moveToHead(existingNode);
    } else {
      const newNode = new ListNode<K, V>(key, value, expiresAt, sizeBytes);
      this.map.set(key, newNode);
      this.addNodeToHead(newNode);
      this.currentSizeBytes += sizeBytes;
    }

    this.evictIfNecessary();
    return true;
  }

  /**
   * Returns true if key exists and has not expired.
   */
  public has(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    if (node.isExpired()) {
      this.removeNodeInternal(node, 'ttl');
      return false;
    }
    return true;
  }

  /**
   * Retrieves an item without modifying LRU positioning or hit/miss statistics.
   */
  public peek(key: K): V | undefined {
    const node = this.map.get(key);
    if (!node || node.isExpired()) return undefined;
    return node.value;
  }

  /**
   * Explicitly removes an item from the cache.
   */
  public delete(key: K): boolean {
    const node = this.map.get(key);
    if (!node) return false;
    this.removeNodeInternal(node, 'manual');
    return true;
  }

  /**
   * Thread-safe and stampede-proof read/fetch operation.
   * If a fetch is already in flight for the given key, reuses the pending Promise.
   */
  public async getOrFetch(
    key: K,
    fetcher: () => Promise<V>,
    ttlMs?: number
  ): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    // Check single-flight promise map
    const existingFetch = this.pendingFetches.get(key);
    if (existingFetch) {
      return existingFetch;
    }

    const fetchPromise = (async () => {
      const release = await this.mutex.acquire();
      try {
        // Re-check cache inside critical section
        const recheck = this.get(key);
        if (recheck !== undefined) return recheck;

        const freshValue = await fetcher();
        this.set(key, freshValue, ttlMs);
        return freshValue;
      } finally {
        this.pendingFetches.delete(key);
        release();
      }
    })();

    this.pendingFetches.set(key, fetchPromise);
    return fetchPromise;
  }

  /**
   * Manually purges all expired keys.
   */
  public purgeExpired(): number {
    const now = Date.now();
    let purgedCount = 0;

    for (const node of this.map.values()) {
      if (node.isExpired(now)) {
        this.removeNodeInternal(node, 'ttl');
        purgedCount++;
      }
    }
    return purgedCount;
  }

  /**
   * Clears all entries and resets memory tracking.
   */
  public clear(): void {
    this.map.clear();
    this.headSentinel.next = this.tailSentinel;
    this.tailSentinel.prev = this.headSentinel;
    this.currentSizeBytes = 0;
  }

  /**
   * Retrieves current telemetry statistics.
   */
  public getStats(): CacheStats {
    const totalReqs = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      evictionsCount: this.evictionsCount,
      itemCount: this.map.size,
      totalSizeBytes: this.currentSizeBytes,
      hitRatio: totalReqs > 0 ? this.hits / totalReqs : 0
    };
  }

  /**
   * Disposes background timers and clears cache memory.
   */
  public dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clear();
  }

  // --- Private Linked List Manipulations ---

  private addNodeToHead(node: ListNode<K, V>): void {
    node.next = this.headSentinel.next;
    node.prev = this.headSentinel;
    this.headSentinel.next!.prev = node;
    this.headSentinel.next = node;
  }

  private unlinkNode(node: ListNode<K, V>): void {
    node.prev!.next = node.next;
    node.next!.prev = node.prev;
  }

  private moveToHead(node: ListNode<K, V>): void {
    this.unlinkNode(node);
    this.addNodeToHead(node);
  }

  private removeNodeInternal(node: ListNode<K, V>, reason: EvictionReason): void {
    this.unlinkNode(node);
    this.map.delete(node.key);
    this.currentSizeBytes -= node.sizeBytes;
    if (reason !== 'manual') {
      this.evictionsCount++;
    }
    if (this.onEviction) {
      this.onEviction(node.key, node.value, reason);
    }
  }

  private evictIfNecessary(): void {
    while (
      (this.map.size > this.maxCapacity) ||
      (this.maxSizeBytes !== undefined && this.currentSizeBytes > this.maxSizeBytes)
    ) {
      const lruNode = this.tailSentinel.prev;
      if (!lruNode || lruNode === this.headSentinel) break;

      const reason: EvictionReason = 
        this.maxSizeBytes !== undefined && this.currentSizeBytes > this.maxSizeBytes 
          ? 'byte_limit' 
          : 'capacity';

      this.removeNodeInternal(lruNode, reason);
    }
  }
}
