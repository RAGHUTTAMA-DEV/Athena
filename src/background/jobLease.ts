import { EpisodicMemory } from '../memory/memory.js';

export interface LeaseInfo {
  jobId: string;
  workerId: string;
  lockedAt: number;
  leaseTimeoutMs: number;
  isExpired: boolean;
}

/**
 * JobLeaseManager coordinates atomic lease locks on scheduled jobs
 * to prevent duplicate execution across multiple worker processes,
 * gateway instances, or parallel tick loops.
 */
export class JobLeaseManager {
  private memory?: EpisodicMemory;
  public readonly workerId: string;
  private inMemoryLocks: Map<string, { workerId: string; lockedAt: number; leaseTimeoutMs: number }> = new Map();

  constructor(memory?: EpisodicMemory, workerId?: string) {
    this.memory = memory;
    this.workerId = workerId || `worker_${process.pid}_${Math.random().toString(36).substring(2, 8)}`;
  }

  setMemory(memory: EpisodicMemory) {
    this.memory = memory;
  }

  /**
   * Attempts to atomically acquire a lease lock on the specified job.
   * Returns true if the lease was acquired, or false if already locked by an active worker.
   */
  async acquire(jobId: string, leaseTimeoutMs: number = 60000): Promise<boolean> {
    if (this.memory) {
      return this.memory.acquireJobLease(jobId, this.workerId, leaseTimeoutMs);
    }

    // In-memory fallback
    const now = Date.now();
    const existing = this.inMemoryLocks.get(jobId);
    if (!existing || (existing.lockedAt + existing.leaseTimeoutMs) < now || existing.workerId === this.workerId) {
      this.inMemoryLocks.set(jobId, {
        workerId: this.workerId,
        lockedAt: now,
        leaseTimeoutMs
      });
      return true;
    }
    return false;
  }

  /**
   * Renews an active lease held by this worker to extend its expiration.
   */
  async renew(jobId: string, leaseTimeoutMs: number = 60000): Promise<boolean> {
    if (this.memory) {
      return this.memory.renewJobLease(jobId, this.workerId, leaseTimeoutMs);
    }

    const now = Date.now();
    const existing = this.inMemoryLocks.get(jobId);
    if (existing && existing.workerId === this.workerId) {
      this.inMemoryLocks.set(jobId, {
        workerId: this.workerId,
        lockedAt: now,
        leaseTimeoutMs
      });
      return true;
    }
    return false;
  }

  /**
   * Releases an active lease held by this worker.
   */
  async release(jobId: string): Promise<void> {
    if (this.memory) {
      await this.memory.releaseJobLease(jobId, this.workerId);
      return;
    }

    const existing = this.inMemoryLocks.get(jobId);
    if (existing && existing.workerId === this.workerId) {
      this.inMemoryLocks.delete(jobId);
    }
  }

  /**
   * Executes a callback within a managed lease lifecycle:
   * 1. Acquires the lease. If unable to acquire, immediately returns { executed: false }.
   * 2. Sets up a background heartbeat timer to periodically renew the lease while running.
   * 3. Executes the callback.
   * 4. Releases the lease and clears the heartbeat regardless of success or failure.
   */
  async withLease<T>(
    jobId: string,
    fn: () => Promise<T>,
    options?: { leaseTimeoutMs?: number; heartbeatIntervalMs?: number }
  ): Promise<{ executed: boolean; result?: T; error?: Error }> {
    const leaseTimeoutMs = options?.leaseTimeoutMs ?? 60000;
    const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? Math.floor(leaseTimeoutMs / 3);

    const acquired = await this.acquire(jobId, leaseTimeoutMs);
    if (!acquired) {
      return { executed: false };
    }

    let heartbeatTimer: NodeJS.Timeout | null = null;
    if (heartbeatIntervalMs > 0) {
      heartbeatTimer = setInterval(async () => {
        try {
          await this.renew(jobId, leaseTimeoutMs);
        } catch (err) {
          console.warn(`[JobLeaseManager] Failed to heartbeat renew lease for job "${jobId}":`, err);
        }
      }, heartbeatIntervalMs);
    }

    try {
      const result = await fn();
      return { executed: true, result };
    } catch (err: any) {
      return { executed: true, error: err instanceof Error ? err : new Error(String(err)) };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      try {
        await this.release(jobId);
      } catch (err) {
        console.warn(`[JobLeaseManager] Failed to release lease for job "${jobId}":`, err);
      }
    }
  }
}
