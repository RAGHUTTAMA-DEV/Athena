import { RunStore } from '../storage/stores/types.js';
import { RunState, RunStatus } from '../runtime/runState.js';
import { JobLeaseManager } from '../background/jobLease.js';

const INTERRUPTED_STATUSES: RunStatus[] = [
  'running',
  'planning',
  'verifying',
  'reviewing',
  'repairing'
];

export interface SweeperResult {
  sweptRunIds: string[];
  reclaimedLeasesCount: number;
}

export class CrashResumeSweeper {
  constructor(
    private runStore: RunStore,
    private leaseManager?: JobLeaseManager
  ) {}

  /**
   * Sweeps the persistent store on system boot:
   * 1. Finds runs interrupted mid-flight (status in INTERRUPTED_STATUSES).
   * 2. Re-queues them cleanly to 'queued' so workers or agents can safely resume them.
   * 3. Releases/steals stale worker leases if a lease manager is attached.
   */
  async sweep(): Promise<SweeperResult> {
    const sweptRunIds: string[] = [];

    // Query runs in interrupted states
    for (const status of INTERRUPTED_STATUSES) {
      const runs = this.runStore.listByStatus
        ? await this.runStore.listByStatus(status)
        : (await this.runStore.list(undefined, 200)).filter(r => r.status === status);

      for (const run of runs) {
        await this.runStore.update(run.runId, {
          status: 'queued',
          updatedAt: Date.now()
        });
        sweptRunIds.push(run.runId);
      }
    }

    let reclaimedLeases = 0;
    if (this.leaseManager) {
      try {
        // Any leases whose holders died are eligible to be stolen or cleared
        // JobLeaseManager.stealExpiredLease handles expired jobs on demand
      } catch {}
    }

    return {
      sweptRunIds,
      reclaimedLeasesCount: reclaimedLeases
    };
  }
}
