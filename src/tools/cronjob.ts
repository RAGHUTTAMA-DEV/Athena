import { Tool } from '../runtime/types.js';
import { Scheduler } from '../background/scheduler.js';
import { JobPriority } from '../background/workerPool.js';

function normalizeSchedule(schedule?: string, intervalSeconds?: number): string | undefined {
  if (intervalSeconds && intervalSeconds > 0) {
    return `every:${intervalSeconds}s`;
  }
  if (!schedule) return undefined;

  const s = schedule.trim().toLowerCase();
  // Check for expressions like "30s", "every 30s", "every 30 seconds", "30 secs", etc.
  const secMatch = s.match(/^(?:every\s+)?(\d+)\s*(?:s|sec|secs|second|seconds)$/);
  if (secMatch) return `every:${secMatch[1]}s`;

  const minMatch = s.match(/^(?:every\s+)?(\d+)\s*(?:m|min|mins|minute|minutes)$/);
  if (minMatch) return `every:${minMatch[1]}m`;

  const hourMatch = s.match(/^(?:every\s+)?(\d+)\s*(?:h|hr|hrs|hour|hours)$/);
  if (hourMatch) return `every:${hourMatch[1]}h`;

  return schedule;
}

export const cronjobTool: Tool = {
  definition: {
    name: 'cronjob',
    description: 'Schedule, modify, cancel, or list recurring agent jobs and delayed timers. Supports standard cron syntax (e.g. "*/5 * * * *"), repeating intervals (e.g. intervalSeconds: 30 or "every:30s"), and one-shot delayed timers (e.g. delaySeconds: 300). Actions: "create", "update", "delete", "list".',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'The action to perform: "create", "update", "delete", or "list"'
        },
        id: {
          type: 'STRING',
          description: 'Unique identifier of the cronjob (required for "delete" and "update", optional for "create")'
        },
        prompt: {
          type: 'STRING',
          description: 'The user prompt or command to run when the schedule triggers (required for "create")'
        },
        schedule: {
          type: 'STRING',
          description: 'Standard 5-field cron expression (e.g. "*/5 * * * *") OR interval string (e.g. "every:30s", "every 15 minutes").'
        },
        intervalSeconds: {
          type: 'INTEGER',
          description: 'Recurring execution interval in seconds (e.g. 30 for every 30 seconds, 60 for every minute).'
        },
        delaySeconds: {
          type: 'INTEGER',
          description: 'Delay in seconds from now for a one-shot execution (e.g. 15 for 15 seconds, 3600 for 1 hour).'
        },
        runAt: {
          type: 'STRING',
          description: 'Specific ISO-8601 timestamp for a one-shot execution (e.g. "2026-10-04T15:30:00Z").'
        },
        timezone: {
          type: 'STRING',
          description: 'IANA timezone for cron evaluation (e.g. "America/New_York", "Asia/Kolkata", "UTC"). Defaults to local system timezone.'
        },
        priority: {
          type: 'STRING',
          description: 'Background worker execution priority: "critical", "high", "normal", or "low". Defaults to "normal".'
        }
      },
      required: ['action']
    }
  },
  execute: async (args: {
    action: 'create' | 'update' | 'delete' | 'list';
    id?: string;
    prompt?: string;
    schedule?: string;
    intervalSeconds?: number;
    delaySeconds?: number;
    runAt?: string;
    timezone?: string;
    priority?: 'critical' | 'high' | 'normal' | 'low';
  }, context?: any) => {
    const scheduler = Scheduler.getInstance();
    const sessionId = context?.parentRunId || 'cli';

    switch (args.action) {
      case 'create': {
        if (!args.prompt) {
          throw new Error('Field "prompt" is required to create a scheduled task.');
        }

        const jobId = args.id || Math.random().toString(36).substring(2, 8);
        const options = {
          timezone: args.timezone,
          priority: args.priority as JobPriority
        };

        // One-shot timer
        if (args.delaySeconds !== undefined || args.runAt) {
          const timing = args.delaySeconds !== undefined ? args.delaySeconds : args.runAt!;
          const job = await scheduler.addOneShotJob(jobId, args.prompt, timing, sessionId, options);
          return {
            success: true,
            message: `Scheduled one-shot task "${job.id}" to run at ${new Date(job.nextRun).toISOString()} (${job.timezone || 'local'}).`,
            job: {
              id: job.id,
              prompt: job.prompt,
              type: 'one-shot',
              timezone: job.timezone,
              priority: job.priority,
              nextRun: new Date(job.nextRun).toISOString()
            }
          };
        }

        const normalizedSchedule = normalizeSchedule(args.schedule, args.intervalSeconds);
        if (!normalizedSchedule) {
          throw new Error('Either "schedule" (cron or interval string), "intervalSeconds", "delaySeconds", or "runAt" must be provided.');
        }

        const job = await scheduler.addJob(jobId, args.prompt, normalizedSchedule, sessionId, options);
        return {
          success: true,
          message: `Scheduled recurring job "${job.id}" successfully with schedule: "${job.schedule}" [Timezone: ${job.timezone}, Priority: ${job.priority}]. Next execution time: ${new Date(job.nextRun).toISOString()}`,
          job: {
            id: job.id,
            prompt: job.prompt,
            type: 'recurring',
            schedule: job.schedule,
            timezone: job.timezone,
            priority: job.priority,
            nextRun: new Date(job.nextRun).toISOString()
          }
        };
      }

      case 'update': {
        if (!args.id) {
          throw new Error('Field "id" is required to update a scheduled job.');
        }

        const jobs = await scheduler.listJobs();
        const existing = jobs.find(j => j.id === args.id);
        if (!existing) {
          throw new Error(`Scheduled job "${args.id}" not found.`);
        }

        const updatedPrompt = args.prompt || existing.prompt;
        const updatedTimezone = args.timezone || existing.timezone;
        const updatedPriority = (args.priority as JobPriority) || existing.priority;

        let updatedSchedule = existing.schedule;
        if (args.delaySeconds !== undefined || args.runAt) {
          const timing = args.delaySeconds !== undefined ? args.delaySeconds : args.runAt!;
          const targetTime = typeof timing === 'number' ? Date.now() + timing * 1000 : Date.parse(timing);
          updatedSchedule = `once:${targetTime}`;
        } else {
          const norm = normalizeSchedule(args.schedule, args.intervalSeconds);
          if (norm) {
            updatedSchedule = norm;
          }
        }

        const updatedJob = await scheduler.updateJob(args.id, {
          prompt: updatedPrompt,
          schedule: updatedSchedule,
          timezone: updatedTimezone,
          priority: updatedPriority
        });

        return {
          success: true,
          message: `Updated scheduled job "${args.id}" to schedule: "${updatedJob.schedule}" [Timezone: ${updatedJob.timezone}, Priority: ${updatedJob.priority}]. Next run: ${new Date(updatedJob.nextRun).toISOString()}`,
          job: {
            id: updatedJob.id,
            prompt: updatedJob.prompt,
            type: updatedJob.schedule.startsWith('once:') ? 'one-shot' : 'recurring',
            schedule: updatedJob.schedule,
            timezone: updatedJob.timezone,
            priority: updatedJob.priority,
            nextRun: new Date(updatedJob.nextRun).toISOString()
          }
        };
      }

      case 'delete': {
        if (!args.id) {
          throw new Error('Field "id" is required to delete a cronjob.');
        }
        await scheduler.cancelJob(args.id);
        return {
          success: true,
          message: `Canceled scheduled job "${args.id}" successfully.`
        };
      }

      case 'list': {
        const jobs = await scheduler.listJobs();
        return {
          success: true,
          jobs: jobs.map(j => ({
            id: j.id,
            prompt: j.prompt,
            schedule: j.schedule,
            sessionId: j.sessionId,
            timezone: j.timezone,
            priority: j.priority,
            lockedBy: j.lockedBy,
            lastRun: j.lastRun ? new Date(j.lastRun).toISOString() : null,
            nextRun: new Date(j.nextRun).toISOString(),
            active: j.active === 1
          }))
        };
      }

      default:
        throw new Error(`Unsupported action "${args.action}" for cronjob tool.`);
    }
  }
};
