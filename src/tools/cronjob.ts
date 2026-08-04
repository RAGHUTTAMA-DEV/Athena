import { Tool } from '../core/types.js';
import { Scheduler } from '../core/scheduler.js';

export const cronjobTool: Tool = {
  definition: {
    name: 'cronjob',
    description: 'Schedule recurring agent runs using standard cron expression syntax (5 fields: minute hour day-of-month month day-of-week). Examples: "*/5 * * * *" runs every 5 minutes, "0 9 * * *" runs daily at 9:00 AM. Actions: "create", "delete", "list".',
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
          description: 'The standard 5-field cron expression to schedule the prompt run (required for "create")'
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
  }, context?: any) => {
    const scheduler = Scheduler.getInstance();
    const sessionId = context?.parentRunId || 'cli';

    switch (args.action) {
      case 'create': {
        if (!args.prompt || !args.schedule) {
          throw new Error('Fields "prompt" and "schedule" are required to create a cronjob.');
        }
        const jobId = args.id || Math.random().toString(36).substring(2, 8);
        const job = await scheduler.addJob(jobId, args.prompt, args.schedule, sessionId);
        return {
          success: true,
          message: `Scheduled recurring job "${job.id}" successfully with cron: "${job.schedule}". Next execution time: ${new Date(job.nextRun).toISOString()}`,
          job: {
            id: job.id,
            prompt: job.prompt,
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
