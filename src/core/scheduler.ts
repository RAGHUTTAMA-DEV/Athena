import { EpisodicMemory } from './memory.js';

export interface ScheduledJob {
  id: string;
  prompt: string;
  schedule: string;
  sessionId: string;
  lastRun: number | null;
  nextRun: number;
  active: number;
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

export function cronMatches(cronExpression: string, date: Date): boolean {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  
  const minutes = parseCronField(fields[0], 0, 59);
  const hours = parseCronField(fields[1], 0, 23);
  const daysOfMonth = parseCronField(fields[2], 1, 31);
  const months = parseCronField(fields[3], 1, 12);
  const daysOfWeek = parseCronField(fields[4], 0, 6); // 0 = Sunday, 1 = Monday, etc.
  
  const curMin = date.getMinutes();
  const curHour = date.getHours();
  const curDayOfMonth = date.getDate();
  const curMonth = date.getMonth() + 1; // getMonth is 0-indexed
  const curDayOfWeek = date.getDay(); // 0 = Sunday
  
  return minutes.includes(curMin) &&
         hours.includes(curHour) &&
         daysOfMonth.includes(curDayOfMonth) &&
         months.includes(curMonth) &&
         (daysOfWeek.includes(curDayOfWeek) || (fields[4] === '*' ? true : false));
}

export function getNextCronTime(cronExpression: string, fromTime: number): number {
  const date = new Date(fromTime);
  // Round down to minutes, then start evaluating from next minute
  date.setSeconds(0);
  date.setMilliseconds(0);
  
  // Loop minute by minute up to 1 year (525600 minutes)
  for (let i = 1; i <= 525600; i++) {
    date.setMinutes(date.getMinutes() + 1);
    if (cronMatches(cronExpression, date)) {
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
  private lastCheckedMinute: number = -1;

  private constructor() {}

  static getInstance(): Scheduler {
    if (!Scheduler.instance) {
      Scheduler.instance = new Scheduler();
    }
    return Scheduler.instance;
  }

  setMemory(memory: EpisodicMemory) {
    this.memory = memory;
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
    const currentMinute = now.getMinutes();
    if (currentMinute === this.lastCheckedMinute) return;
    this.lastCheckedMinute = currentMinute;

    const currentTime = now.getTime();
    const jobs = await this.memory.getScheduledJobs();

    for (const job of jobs) {
      if (job.active && currentTime >= job.nextRun) {
        console.log(`[Scheduler] Triggering scheduled job "${job.id}" (Prompt: "${job.prompt}")`);
        
        // Update runs immediately to prevent duplicate triggers
        const lastRun = currentTime;
        let nextRun = currentTime;
        try {
          nextRun = getNextCronTime(job.schedule, currentTime);
        } catch (e: any) {
          console.error(`[Scheduler] Failed to calculate next cron time for job ${job.id}:`, e.message);
          // deactivate job on error
          job.active = 0;
        }

        await this.memory.updateScheduledJobRun(job.id, lastRun, nextRun);

        // Run the agent prompt asynchronously
        this.runner(job.prompt, job.sessionId)
          .then(async (result) => {
            console.log(`[Scheduler] Job "${job.id}" completed. Notifying...`);
            if (this.notifier) {
              await this.notifier(job.sessionId, result);
            }
          })
          .catch((err) => {
            console.error(`[Scheduler Error] Job "${job.id}" execution failed:`, err);
            if (this.notifier) {
              this.notifier(job.sessionId, `⚠️ Scheduled task "${job.prompt}" failed: ${err.message}`).catch(() => {});
            }
          });
      }
    }
  }

  async addJob(id: string, prompt: string, schedule: string, sessionId: string): Promise<ScheduledJob> {
    if (!this.memory) {
      throw new Error('Scheduler memory not set. Call setMemory() first.');
    }
    
    // Verify cron expression format is valid
    const nextRun = getNextCronTime(schedule, Date.now());

    const job: ScheduledJob = {
      id,
      prompt,
      schedule,
      sessionId,
      lastRun: null,
      nextRun,
      active: 1
    };

    await this.memory.saveScheduledJob(job);
    return job;
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
  }
}
