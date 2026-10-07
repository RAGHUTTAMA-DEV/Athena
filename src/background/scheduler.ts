import { EpisodicMemory } from '../memory/memory.js';
import { JobLeaseManager } from './jobLease.js';
import { BackgroundWorkerPool, JobPriority } from './workerPool.js';
import { EventBus } from './eventBus.js';

export interface ScheduledJob {
  id: string;
  prompt: string;
  schedule: string;
  sessionId: string;
  lastRun: number | null;
  nextRun: number;
  active: number;
  timezone?: string;
  lockedBy?: string | null;
  lockedAt?: number | null;
  leaseTimeoutMs?: number;
  priority?: JobPriority;
}

export function parseCronField(field: string, min: number, max: number): number[] {
  if (field === '*') {
    const arr = [];
    for (let i = min; i <= max; i++) arr.push(i);
    return arr;
  }
  
  const values: number[] = [];
  const parts = field.split(',');
  for (const part of parts) {
    if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr, 10);
      let start = min;
      let end = max;
      if (range !== '*') {
        const [rStart, rEnd] = range.split('-');
        start = parseInt(rStart, 10);
        end = rEnd ? parseInt(rEnd, 10) : max;
      }
      for (let i = start; i <= end; i += step) {
        values.push(i);
      }
    } else if (part.includes('-')) {
      const [rStart, rEnd] = part.split('-');
      const start = parseInt(rStart, 10);
      const end = parseInt(rEnd, 10);
      for (let i = start; i <= end; i++) {
        values.push(i);
      }
    } else {
      values.push(parseInt(part, 10));
    }
  }
  return values;
}

/**
 * Extracts date components for any valid IANA timezone using standard Intl.DateTimeFormat.
 */
export function getDateInTimezone(date: Date, timeZone?: string): {
  minutes: number;
  hours: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
} {
  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });

    const parts = formatter.formatToParts(date);
    let curMin = 0;
    let curHour = 0;
    let curDayOfMonth = 1;
    let curMonth = 1;
    let curDayOfWeek = 0;

    for (const part of parts) {
      if (part.type === 'minute') curMin = parseInt(part.value, 10);
      else if (part.type === 'hour') curHour = parseInt(part.value, 10);
      else if (part.type === 'day') curDayOfMonth = parseInt(part.value, 10);
      else if (part.type === 'month') curMonth = parseInt(part.value, 10);
      else if (part.type === 'weekday') {
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        curDayOfWeek = days.indexOf(part.value);
        if (curDayOfWeek === -1) curDayOfWeek = 0;
      }
    }
    return { minutes: curMin, hours: curHour, dayOfMonth: curDayOfMonth, month: curMonth, dayOfWeek: curDayOfWeek };
  } catch {
    // If invalid timezone, fallback to UTC
    return {
      minutes: date.getUTCMinutes(),
      hours: date.getUTCHours(),
      dayOfMonth: date.getUTCDate(),
      month: date.getUTCMonth() + 1,
      dayOfWeek: date.getUTCDay()
    };
  }
}

export function cronMatches(cronExpression: string, date: Date, timeZone?: string): boolean {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  
  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const daysOfMonth = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const daysOfWeek = parseCronField(fields[4], 0, 6); // 0 = Sunday, 1 = Monday, etc.
  
  const parts = getDateInTimezone(date, timeZone);
  
  return minutes.includes(parts.minutes) &&
         hours.includes(parts.hours) &&
         daysOfMonth.includes(parts.dayOfMonth) &&
         months.includes(parts.month) &&
         (daysOfWeek.includes(parts.dayOfWeek) || (fields[4] === '*' ? true : false));
}

export function getNextCronTime(cronExpression: string, fromTime: number, timeZone?: string): number {
  const date = new Date(fromTime);
  // Round down to minutes, then start evaluating from next minute
  date.setSeconds(0);
  date.setMilliseconds(0);
  
  // Loop minute by minute up to 1 year (525600 minutes)
  for (let i = 1; i <= 525600; i++) {
    date.setMinutes(date.getMinutes() + 1);
    if (cronMatches(cronExpression, date, timeZone)) {
      return date.getTime();
    }
  }
  throw new Error(`Could not find next execution time within 1 year for cron expression: ${cronExpression}`);
}

export class Scheduler {
  private static instance: Scheduler | null = null;
  private memory: EpisodicMemory | null = null;
  private runner: ((prompt: string, sessionId: string) => Promise<string>) | null = null;
  private notifier: ((sessionId: string, result: string) => Promise<void>) | null = null;
  private timer: NodeJS.Timeout | null = null;

  public readonly leaseManager: JobLeaseManager;
  public readonly workerPool: BackgroundWorkerPool;
  public readonly eventBus: EventBus;

  private constructor() {
    this.leaseManager = new JobLeaseManager();
    this.workerPool = BackgroundWorkerPool.getInstance();
    this.eventBus = EventBus.getInstance();
  }

  static getInstance(): Scheduler {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
    }
    return Scheduler.instance;
  }

  setMemory(memory: EpisodicMemory) {
    this.memory = memory;
    this.leaseManager.setMemory(memory);
    this.eventBus.setMemory(memory);
  }

  setRunner(runner: (prompt: string, sessionId: string) => Promise<string>) {
    this.runner = runner;
  }

  setNotifier(notifier: (sessionId: string, result: string) => Promise<void>) {
    this.notifier = notifier;
  }

  async start() {
    if (this.timer) return;
    
    this.timer = setInterval(() => {
      this.tick().catch(err => {
        console.error('[Scheduler Tick Error]', err);
      });
    }, 10000); // Check every 10 seconds
  }

  async stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async tick() {
    if (!this.memory || !this.runner) return;

    const now = new Date();
    const currentTime = now.getTime();

    // Emit timer tick event
    this.eventBus.publish('timer:tick', { timestamp: currentTime }).catch(() => {});

    const jobs = await this.memory.getScheduledJobs();

    for (const job of jobs) {
      if (job.active && currentTime >= job.nextRun) {
        // 1. Attempt atomic lease acquisition to prevent split-brain / duplicate execution
        const acquired = await this.leaseManager.acquire(job.id, 60000);
        if (!acquired) {
          console.log(`[Scheduler] Job "${job.id}" is locked by another worker, skipping.`);
          continue;
        }

        console.log(`[Scheduler] Acquired lease for job "${job.id}" (Prompt: "${job.prompt}")`);
        
        const lastRun = currentTime;
        const isOneShot = job.schedule.startsWith('once:');

        if (isOneShot) {
          // Deactivate and remove one-shot job so it does not repeat
          job.active = 0;
          await this.memory.updateScheduledJobRun(job.id, lastRun, 0);
          await this.memory.deleteScheduledJob(job.id);
        } else if (job.schedule.startsWith('every:') || job.schedule.startsWith('interval:')) {
          const match = job.schedule.match(/(?:every|interval):(\d+)(s|m|h|d)?/);
          let nextRun = currentTime + 60000;
          if (match) {
            const amount = parseInt(match[1], 10);
            const unit = match[2] || 's';
            const mult = unit === 'm' ? 60000 : unit === 'h' ? 3600000 : unit === 'd' ? 86400000 : 1000;
            nextRun = currentTime + amount * mult;
          }
          await this.memory.updateScheduledJobRun(job.id, lastRun, nextRun);
        } else {
          let nextRun = currentTime;
          try {
            nextRun = getNextCronTime(job.schedule, currentTime, job.timezone);
          } catch (e: any) {
            console.error(`[Scheduler] Failed to calculate next cron time for job ${job.id}:`, e.message);
            job.active = 0;
          }
          await this.memory.updateScheduledJobRun(job.id, lastRun, nextRun);
        }

        // 2. Dispatch job into BackgroundWorkerPool with designated priority
        const priority: JobPriority = job.priority || 'normal';

        this.workerPool.submit({
          id: `job_${job.id}_${currentTime}`,
          name: `Job: ${job.id}`,
          priority,
          execute: async () => {
            await this.eventBus.publish('scheduler:job_started', {
              jobId: job.id,
              prompt: job.prompt,
              sessionId: job.sessionId
            });

            // Heartbeat lease renewal while task runs
            const heartbeat = setInterval(() => {
              this.leaseManager.renew(job.id, 60000).catch(() => {});
            }, 20000);

            try {
              const result = await this.runner!(job.prompt, job.sessionId);
              console.log(`[Scheduler] Job "${job.id}" completed. Notifying...`);
              if (this.notifier) {
                await this.notifier(job.sessionId, result);
              }
              await this.eventBus.publish('scheduler:job_completed', {
                jobId: job.id,
                result
              });
              return result;
            } catch (err: any) {
              console.error(`[Scheduler Error] Job "${job.id}" execution failed:`, err);
              if (this.notifier) {
                this.notifier(job.sessionId, `⚠️ Scheduled task "${job.prompt}" failed: ${err.message}`).catch(() => {});
              }
              await this.eventBus.publish('scheduler:job_failed', {
                jobId: job.id,
                error: err.message
              });
              throw err;
            } finally {
              clearInterval(heartbeat);
              await this.leaseManager.release(job.id);
            }
          }
        }).catch(err => {
          console.warn(`[Scheduler] Worker pool dispatch error for job "${job.id}":`, err.message);
        });
      }
    }
  }

  async addJob(
    id: string,
    prompt: string,
    schedule: string,
    sessionId: string,
    options?: { timezone?: string; priority?: JobPriority }
  ): Promise<ScheduledJob> {
    if (!this.memory) {
      throw new Error('Scheduler memory not set. Call setMemory() first.');
    }

    const timezone = options?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const priority = options?.priority || 'normal';
    
    let nextRun: number;
    if (schedule.startsWith('once:')) {
      nextRun = parseInt(schedule.substring(5), 10);
      if (isNaN(nextRun)) {
        throw new Error(`Invalid one-shot schedule format: ${schedule}`);
      }
    } else if (schedule.startsWith('every:') || schedule.startsWith('interval:')) {
      const match = schedule.match(/(?:every|interval):(\d+)(s|m|h|d)?/);
      if (match) {
        const amount = parseInt(match[1], 10);
        const unit = match[2] || 's';
        const mult = unit === 'm' ? 60000 : unit === 'h' ? 3600000 : unit === 'd' ? 86400000 : 1000;
        nextRun = Date.now() + amount * mult;
      } else {
        nextRun = Date.now() + 60000;
      }
    } else {
      nextRun = getNextCronTime(schedule, Date.now(), timezone);
    }

    const job: ScheduledJob = {
      id,
      prompt,
      schedule,
      sessionId,
      lastRun: null,
      nextRun,
      active: 1,
      timezone,
      priority
    };

    await this.memory.saveScheduledJob(job);
    return job;
  }

  async addOneShotJob(
    id: string,
    prompt: string,
    delaySecondsOrIso: number | string,
    sessionId: string,
    options?: { timezone?: string; priority?: JobPriority }
  ): Promise<ScheduledJob> {
    let targetTime: number;
    if (typeof delaySecondsOrIso === 'number') {
      targetTime = Date.now() + Math.max(1, delaySecondsOrIso) * 1000;
    } else {
      const parsed = Date.parse(delaySecondsOrIso);
      if (isNaN(parsed)) {
        throw new Error(`Invalid ISO date format for one-shot timer: "${delaySecondsOrIso}"`);
      }
      targetTime = parsed;
    }

    const schedule = `once:${targetTime}`;
    return this.addJob(id, prompt, schedule, sessionId, options);
  }

  async listJobs(): Promise<ScheduledJob[]> {
    if (!this.memory) {
      throw new Error('Scheduler memory not set. Call setMemory() first.');
    }
    return this.memory.getScheduledJobs();
  }

  async cancelJob(id: string): Promise<void> {
    if (!this.memory) {
      throw new Error('Scheduler memory not set. Call setMemory() first.');
    }
    await this.memory.deleteScheduledJob(id);
    await this.leaseManager.release(id);
  }

  async updateJob(
    id: string,
    updates: {
      prompt?: string;
      schedule?: string;
      timezone?: string;
      priority?: JobPriority;
    }
  ): Promise<ScheduledJob> {
    if (!this.memory) {
      throw new Error('Scheduler memory not set. Call setMemory() first.');
    }
    const jobs = await this.memory.getScheduledJobs();
    const existing = jobs.find(j => j.id === id);
    if (!existing) {
      throw new Error(`Scheduled job "${id}" not found.`);
    }

    const prompt = updates.prompt || existing.prompt;
    const schedule = updates.schedule || existing.schedule;
    const timezone = updates.timezone || existing.timezone || 'UTC';
    const priority = updates.priority || existing.priority || 'normal';

    await this.cancelJob(id);
    return this.addJob(id, prompt, schedule, existing.sessionId, { timezone, priority });
  }
}
