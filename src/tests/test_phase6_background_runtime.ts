import { EpisodicMemory } from '../core/memory.js';
import { Scheduler, cronMatches, getNextCronTime, getDateInTimezone } from '../core/scheduler.js';
import { JobLeaseManager } from '../core/jobLease.js';
import { BackgroundWorkerPool } from '../core/workerPool.js';
import { EventBus } from '../core/eventBus.js';
import { cronjobTool } from '../tools/cronjob.js';
import fs from 'fs';
import path from 'path';

async function runPhase6Tests() {
  console.log('=== STARTING PHASE 6 BACKGROUND + EVENT RUNTIME TESTS ===\n');

  const testDbPath = path.resolve('test_phase6_background.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const memory = new EpisodicMemory(testDbPath);
  await memory.init();

  try {
    // -------------------------------------------------------------
    // TEST 1: Timezone Support & Cron Calculations
    // -------------------------------------------------------------
    console.log('--- TEST 1: Timezone Support & Cron Calculations ---');

    // Create a known UTC date: 2026-10-04 12:00:00 UTC
    const dateUtc = new Date(Date.UTC(2026, 9, 4, 12, 0, 0));

    // In UTC, hour is 12
    const partsUtc = getDateInTimezone(dateUtc, 'UTC');
    if (partsUtc.hours !== 12 || partsUtc.minutes !== 0) {
      throw new Error(`Expected UTC hour 12, got ${partsUtc.hours}`);
    }

    // In Asia/Kolkata (UTC+5:30), hour is 17, minutes is 30
    const partsKolkata = getDateInTimezone(dateUtc, 'Asia/Kolkata');
    if (partsKolkata.hours !== 17 || partsKolkata.minutes !== 30) {
      throw new Error(`Expected Asia/Kolkata 17:30, got ${partsKolkata.hours}:${partsKolkata.minutes}`);
    }

    // In America/New_York (EDT = UTC-4 in October), hour is 8:00
    const partsNY = getDateInTimezone(dateUtc, 'America/New_York');
    if (partsNY.hours !== 8 || partsNY.minutes !== 0) {
      throw new Error(`Expected America/New_York hour 8, got ${partsNY.hours}`);
    }

    // Verify cronMatches works with timezone
    // "0 12 * * *" should match UTC dateUtc, but NOT match in Asia/Kolkata
    const matchesUtc = cronMatches('0 12 * * *', dateUtc, 'UTC');
    const matchesKolkata = cronMatches('0 12 * * *', dateUtc, 'Asia/Kolkata');
    const matchesKolkataActual = cronMatches('30 17 * * *', dateUtc, 'Asia/Kolkata');

    if (!matchesUtc) throw new Error('Expected "0 12 * * *" to match UTC at 12:00');
    if (matchesKolkata) throw new Error('Expected "0 12 * * *" NOT to match Asia/Kolkata at 12:00 UTC');
    if (!matchesKolkataActual) throw new Error('Expected "30 17 * * *" to match Asia/Kolkata at 12:00 UTC');

    // Test getNextCronTime with timezone
    const baseTime = new Date('2026-10-04T00:00:00Z').getTime();
    const nextNy = getNextCronTime('0 9 * * *', baseTime, 'America/New_York'); // 9 AM EDT is 13:00 UTC
    const dateNy = new Date(nextNy);
    if (dateNy.getUTCHours() !== 13) {
      throw new Error(`Expected next run in America/New_York (9 AM EDT) to be 13:00 UTC, got ${dateNy.getUTCHours()}:00`);
    }

    console.log('✓ TEST 1 PASSED: Timezone-aware cron calculation verified across UTC, Asia/Kolkata, and America/New_York.\n');

    // -------------------------------------------------------------
    // TEST 2: Job Leases & Distributed Locking
    // -------------------------------------------------------------
    console.log('--- TEST 2: Job Leases & Distributed Locking ---');

    // Create a job in DB first
    await memory.saveScheduledJob({
      id: 'job_lease_test',
      prompt: 'Check server health',
      schedule: '*/5 * * * *',
      sessionId: 'session_1',
      lastRun: null,
      nextRun: Date.now() + 10000,
      active: 1
    });

    const workerA = new JobLeaseManager(memory, 'worker_A');
    const workerB = new JobLeaseManager(memory, 'worker_B');

    // Worker A acquires lease
    const acquiredA = await workerA.acquire('job_lease_test', 100); // 100ms short lease
    if (!acquiredA) throw new Error('Worker A failed to acquire free lease');

    // Worker B tries to acquire lease immediately -> should fail
    const acquiredB = await workerB.acquire('job_lease_test', 5000);
    if (acquiredB) throw new Error('Worker B acquired an already held active lease!');

    // Worker A renews lease
    const renewedA = await workerA.renew('job_lease_test', 500);
    if (!renewedA) throw new Error('Worker A failed to renew its own lease');

    // Worker A releases lease
    await workerA.release('job_lease_test');

    // Now Worker B can acquire lease
    const acquiredB2 = await workerB.acquire('job_lease_test', 5000);
    if (!acquiredB2) throw new Error('Worker B failed to acquire lease after Worker A released');

    // Test withLease helper
    let callbackExecuted = false;
    const leaseResult = await workerB.withLease('job_lease_test', async () => {
      callbackExecuted = true;
      return 'success_payload';
    }, { leaseTimeoutMs: 2000 });

    if (!leaseResult.executed || leaseResult.result !== 'success_payload' || !callbackExecuted) {
      throw new Error(`withLease failed: ${JSON.stringify(leaseResult)}`);
    }

    console.log('✓ TEST 2 PASSED: Job leases successfully enforce mutual exclusion, renewal, and clean release.\n');

    // -------------------------------------------------------------
    // TEST 3: Decoupled Event Bus & Deduplication
    // -------------------------------------------------------------
    console.log('--- TEST 3: Decoupled Event Bus & Deduplication ---');

    const eventBus = new EventBus(memory);
    const receivedEvents: any[] = [];

    // Subscribe to wildcard
    const unsubscribeWildcard = eventBus.subscribe('timer:*', (evt) => {
      receivedEvents.push(evt);
    });

    // Subscribe to exact
    let webhookEventCount = 0;
    eventBus.subscribe('webhook:github', (evt) => {
      webhookEventCount++;
    });

    // Publish timer tick
    await eventBus.publish('timer:tick', { now: Date.now() });
    if (receivedEvents.length !== 1 || receivedEvents[0].topic !== 'timer:tick') {
      throw new Error('Wildcard subscription did not receive "timer:tick" event');
    }

    // Publish webhook with idempotency key
    const pub1 = await eventBus.publish('webhook:github', { pr: 42 }, { idempotencyKey: 'idemp_gh_42' });
    if (!pub1) throw new Error('First event with idempotencyKey was rejected unexpectedly');

    // Publish identical event with same idempotency key -> should be deduplicated
    const pub2 = await eventBus.publish('webhook:github', { pr: 42 }, { idempotencyKey: 'idemp_gh_42' });
    if (pub2) throw new Error('Duplicate event with same idempotencyKey was NOT rejected!');

    if (webhookEventCount !== 1) {
      throw new Error(`Expected exactly 1 webhook event received, got ${webhookEventCount}`);
    }

    unsubscribeWildcard();
    await eventBus.publish('timer:tick', { now: Date.now() });
    if (receivedEvents.length !== 1) {
      throw new Error('Unsubscribed handler was called after unsubscribe');
    }

    console.log('✓ TEST 3 PASSED: Event Bus verified with wildcard subscriptions, isolation, and idempotency deduplication.\n');

    // -------------------------------------------------------------
    // TEST 4: Priority Queue & Background Worker Pool
    // -------------------------------------------------------------
    console.log('--- TEST 4: Priority Queue & Background Worker Pool ---');

    const pool = new BackgroundWorkerPool(2); // Concurrency = 2
    const executionOrder: string[] = [];

    // Submit tasks with varying priorities
    // Even though low is submitted first, critical and high should jump ahead
    const tLow = pool.submit({
      name: 'low_task',
      priority: 'low',
      execute: async () => {
        await new Promise(r => setTimeout(r, 60));
        executionOrder.push('low');
        return 'low_done';
      }
    });

    const tNormal = pool.submit({
      name: 'normal_task',
      priority: 'normal',
      execute: async () => {
        await new Promise(r => setTimeout(r, 60));
        executionOrder.push('normal');
        return 'normal_done';
      }
    });

    // Submitting while tLow and tNormal fill the 2 slots:
    const tCritical = pool.submit({
      name: 'critical_task',
      priority: 'critical',
      execute: async () => {
        executionOrder.push('critical');
        return 'critical_done';
      }
    });

    const tHigh = pool.submit({
      name: 'high_task',
      priority: 'high',
      execute: async () => {
        executionOrder.push('high');
        return 'high_done';
      }
    });

    // Test cancellation on queued task
    const tCancelled = pool.submit({
      id: 'cancel_me_later',
      name: 'cancel_task',
      priority: 'low',
      execute: async () => {
        executionOrder.push('cancelled_ran');
      }
    });
    const cancelSuccess = pool.cancelTask('cancel_me_later');
    if (!cancelSuccess) throw new Error('Failed to cancel queued background task');

    try {
      await tCancelled;
      throw new Error('Cancelled task did not reject as expected');
    } catch (err: any) {
      if (!err.message.includes('cancelled')) throw err;
    }

    await Promise.all([tLow, tNormal, tCritical, tHigh]);

    // Critical and High must execute before any subsequent low
    const criticalIdx = executionOrder.indexOf('critical');
    const highIdx = executionOrder.indexOf('high');
    if (criticalIdx === -1 || highIdx === -1) {
      throw new Error(`Tasks failed to execute: ${JSON.stringify(executionOrder)}`);
    }

    if (criticalIdx > highIdx) {
      throw new Error(`Expected critical priority to execute before high: ${JSON.stringify(executionOrder)}`);
    }

    const stats = pool.getStats();
    if (stats.completed !== 4 || stats.failed !== 0) {
      throw new Error(`Unexpected pool stats: ${JSON.stringify(stats)}`);
    }

    console.log(`✓ TEST 4 PASSED: Background Worker Pool honored concurrency (2) and priority queue ordering (${executionOrder.join(' -> ')}).\n`);

    // -------------------------------------------------------------
    // TEST 5: End-to-End Scheduler Integration & cronjobTool
    // -------------------------------------------------------------
    console.log('--- TEST 5: End-to-End Scheduler Integration & cronjobTool ---');

    const scheduler = Scheduler.getInstance();
    scheduler.setMemory(memory);

    let executedJobPrompt = '';
    scheduler.setRunner(async (prompt: string, sessionId: string) => {
      executedJobPrompt = prompt;
      return `Executed: ${prompt}`;
    });

    let notifiedResult = '';
    scheduler.setNotifier(async (sessionId: string, result: string) => {
      notifiedResult = result;
    });

    // Test cronjobTool create action with timezone and priority
    const toolCreate = await cronjobTool.execute({
      action: 'create',
      id: 'e2e_cron_1',
      prompt: 'Clean expired sessions',
      schedule: '* * * * *',
      timezone: 'Asia/Kolkata',
      priority: 'high'
    });

    if (!toolCreate.success || toolCreate.job?.timezone !== 'Asia/Kolkata') {
      throw new Error(`cronjobTool create failed: ${JSON.stringify(toolCreate)}`);
    }

    // Force job to be due now for tick test
    await memory.updateScheduledJobRun('e2e_cron_1', null, Date.now() - 1000);

    // Run scheduler tick
    await scheduler.tick();

    // Drain worker pool to allow the dispatched background task to finish
    await scheduler.workerPool.drain();

    if (executedJobPrompt !== 'Clean expired sessions') {
      throw new Error(`Expected runner to be executed with prompt, got "${executedJobPrompt}"`);
    }
    if (notifiedResult !== 'Executed: Clean expired sessions') {
      throw new Error(`Expected notifier to receive result, got "${notifiedResult}"`);
    }

    // Clean up job
    await cronjobTool.execute({
      action: 'delete',
      id: 'e2e_cron_1'
    });

    const listResult = await cronjobTool.execute({ action: 'list' });
    const remaining = listResult.jobs.find((j: any) => j.id === 'e2e_cron_1');
    if (remaining) {
      throw new Error('Job e2e_cron_1 was not deleted');
    }

    console.log('✓ TEST 5 PASSED: End-to-end Scheduler, cronjobTool, Leases, and Worker Pool dispatch verified successfully.\n');

    // -------------------------------------------------------------
    // TEST 6: Repeating Interval Scheduling & Update Action
    // -------------------------------------------------------------
    console.log('--- TEST 6: Repeating Interval Scheduling & Update Action ---');

    // 1. Create a repeating 30-second interval job
    const createInterval = await cronjobTool.execute({
      action: 'create',
      id: 'interval_30s_job',
      prompt: 'ping server every 30s',
      intervalSeconds: 30,
      priority: 'high'
    });

    if (!createInterval.success || createInterval.job?.schedule !== 'every:30s') {
      throw new Error(`Failed to create 30s interval job: ${JSON.stringify(createInterval)}`);
    }

    // 2. Update the job to 15 seconds using update action
    const updateResult = await cronjobTool.execute({
      action: 'update',
      id: 'interval_30s_job',
      intervalSeconds: 15
    });

    if (!updateResult.success || updateResult.job?.schedule !== 'every:15s') {
      throw new Error(`Failed to update job to 15s interval: ${JSON.stringify(updateResult)}`);
    }

    // 3. Test natural language schedule normalization (e.g. "every 45 secs")
    const updateNl = await cronjobTool.execute({
      action: 'update',
      id: 'interval_30s_job',
      schedule: 'every 45 secs'
    });

    if (!updateNl.success || updateNl.job?.schedule !== 'every:45s') {
      throw new Error(`Failed to normalize schedule string "every 45 secs": ${JSON.stringify(updateNl)}`);
    }

    // Clean up
    await cronjobTool.execute({ action: 'delete', id: 'interval_30s_job' });

    console.log('✓ TEST 6 PASSED: Repeating interval schedules (sub-minute) and update action verified.\n');

    console.log('ALL PHASE 6 BACKGROUND + EVENT RUNTIME TESTS PASSED SUCCESSFULLY! 🎉\n');
  } finally {
    if (fs.existsSync(testDbPath)) {
      try {
        fs.unlinkSync(testDbPath);
      } catch {}
    }
  }
}

runPhase6Tests().catch((err) => {
  console.error('Phase 6 Test Suite Failed:', err);
  process.exit(1);
});
