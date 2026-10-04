import { Tool } from '../core/types.js';
import { Scheduler } from '../core/scheduler.js';

export const cronjobTool: Tool = {
  definition: {
    name: 'cronjob',
    description: 'Schedule recurring agent runs using standard cron expression syntax (e.g. "*/5 * * * *" or "0 9 * * *") OR schedule one-shot delayed timers (e.g. delaySeconds: 300 for 5 minutes, or runAt ISO timestamp). Actions: "create", "delete", "list".',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'The action to perform: "create", "delete", or "list"'
        },
        id: {
          type: 'STRING',
          description: 'Unique identifier of the cronjob to cancel (required for "delete")'
        },
        prompt: {
          type: 'STRING',
          description: 'The user prompt or command to run when the schedule triggers (required for "create")'
        },
        schedule: {
          type: 'STRING',
          description: 'Standard 5-field cron expression for recurring runs (e.g. "*/5 * * * *" or "0 9 * * *").'
        },
        delaySeconds: {
          type: 'INTEGER',
          description: 'Delay in seconds from now for a one-shot execution (e.g. 60 for 1 minute, 3600 for 1 hour).'
        },
        runAt: {
          type: 'STRING',
          description: 'Specific ISO-8601 timestamp for a one-shot execution (e.g. "2026-10-04T15:30:00Z").'
        }
      },
      required: ['action']
    }
  },
  execute: async (args: {
    action: 'create' | 'delete' | 'list';
    id?: string;
    prompt?: string;
    schedule?: string;
    delaySeconds?: number;
    runAt?: string;
  }, context?: any) => {
    const scheduler = Scheduler.getInstance();
    const sessionId = context?.parentRunId || 'cli';

    switch (args.action) {
      case 'create': {
        if (!args.prompt) {
          throw new Error('Field "prompt" is required to create a scheduled task.');
        }

        const jobId = args.id || Math.random().toString(36).substring(2, 8);

        if (args.delaySeconds !== undefined || args.runAt) {
          const timing = args.delaySeconds !== undefined ? args.delaySeconds : args.runAt!;
          const job = await scheduler.addOneShotJob(jobId, args.prompt, timing, sessionId);
          return {
            success: true,
            message: `Scheduled one-shot task "${job.id}" to run at ${new Date(job.nextRun).toISOString()}.`,
            job: {
              id: job.id,
              prompt: job.prompt,
              type: 'one-shot',
              nextRun: new Date(job.nextRun).toISOString()
            }
          };
        }

        if (!args.schedule) {
          throw new Error('Either "schedule" (cron string), "delaySeconds" (number), or "runAt" (ISO timestamp) must be provided.');
        }

        const job = await scheduler.addJob(jobId, args.prompt, args.schedule, sessionId);
        return {
          success: true,
          message: `Scheduled recurring job "${job.id}" successfully with cron: "${job.schedule}". Next execution time: ${new Date(job.nextRun).toISOString()}`,
          job: {
            id: job.id,
            prompt: job.prompt,
            type: 'recurring',
            schedule: job.schedule,
            nextRun: new Date(job.nextRun).toISOString()
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
