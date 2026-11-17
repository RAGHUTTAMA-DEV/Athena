import { WorkflowRegistry } from './registry.js';
import { WorkflowExecutor } from './executor.js';
import { Workflow, TriggerNode } from './types.js';
import { EventBus } from '../background/eventBus.js';
import { getNextCronTime } from '../background/scheduler.js';
import { CancellationTokenSource } from '../runtime/cancellation.js';
import { Database } from 'sqlite';

export interface WorkflowTriggerAdapterConfig {
  registry: WorkflowRegistry;
  executor: WorkflowExecutor;
  db: Database;
  eventBus?: EventBus;
}

export class WorkflowTriggerAdapter {
  private eventBus: EventBus;
  private unsubscribeMap = new Map<string, Array<() => void>>();
  private cronCheckInterval: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(private cfg: WorkflowTriggerAdapterConfig) {
    this.eventBus = cfg.eventBus || EventBus.getInstance();
  }

  /**
   * Initializes the adapter:
   * 1. Scans existing workflows and registers triggers.
   * 2. Starts internal cron trigger evaluation loop.
   * 3. Subscribes to live registry updates on EventBus.
   */
  async init(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    // Register triggers for all active workflows
    await this.syncAllTriggers();

    // Subscribe to workflow definition updates
    this.eventBus.subscribe('workflow:updated:*', async (event) => {
      try {
        const wfId = event.payload?.workflowId;
        if (wfId) {
          const wf = await this.cfg.registry.get(wfId);
          if (wf) {
            await this.unregisterWorkflow(wf.id);
            await this.registerWorkflow(wf);
          }
        }
      } catch (err) {
        console.error('[WorkflowTriggerAdapter] Update handler error:', err);
      }
    });

    this.eventBus.subscribe('workflow:deleted:*', async (event) => {
      const wfId = event.payload?.workflowId;
      if (wfId) {
        await this.unregisterWorkflow(wfId);
      }
    });

    // Start background cron checking loop (checks every 5 seconds)
    this.cronCheckInterval = setInterval(() => {
      this.tickCron().catch(err => {
        console.error('[WorkflowTriggerAdapter] Cron tick error:', err);
      });
    }, 5000);
  }

  /**
   * Shuts down background polling and removes event listeners.
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.cronCheckInterval) {
      clearInterval(this.cronCheckInterval);
      this.cronCheckInterval = null;
    }
    for (const [wfId] of this.unsubscribeMap) {
      await this.unregisterWorkflow(wfId);
    }
  }

  /**
   * Synchronizes all active workflows with the trigger adapter.
   */
  async syncAllTriggers(): Promise<number> {
    const list = await this.cfg.registry.list();
    let count = 0;
    for (const item of list) {
      const wf = await this.cfg.registry.get(item.id);
      if (wf) {
        await this.registerWorkflow(wf);
        count++;
      }
    }
    return count;
  }

  /**
   * Registers triggers for a single workflow definition.
   */
  async registerWorkflow(wf: Workflow): Promise<void> {
    await this.unregisterWorkflow(wf.id);

    const unsubs: Array<() => void> = [];

    // 1. Universal programmatic trigger: "workflow:trigger:<id>"
    const directUnsub = this.eventBus.subscribe(`workflow:trigger:${wf.id}`, async (event) => {
      const inputs = event.payload?.inputs || event.payload || {};
      const cts = new CancellationTokenSource();
      await this.cfg.executor.run(wf, inputs, `event_${event.id}`, cts.token);
    });
    unsubs.push(directUnsub);

    // 2. Discover Trigger nodes in the workflow DAG
    const triggerNodes = wf.nodes.filter(n => n.type === 'trigger') as TriggerNode[];

    for (const tn of triggerNodes) {
      if (tn.triggerType === 'webhook') {
        const path = this.normalizeWebhookPath(tn.webhookPath || wf.id);
        const webhookTopic = `webhook:${path}`;

        const hookUnsub = this.eventBus.subscribe(webhookTopic, async (event) => {
          const cts = new CancellationTokenSource();
          await this.cfg.executor.run(wf, event.payload || {}, `webhook_${path}`, cts.token);
        });
        unsubs.push(hookUnsub);
      } else if (tn.triggerType === 'cron' && tn.schedule) {
        await this.registerCronJob(wf.id, tn.schedule);
      }
    }

    this.unsubscribeMap.set(wf.id, unsubs);
  }

  /**
   * Unregisters all triggers for a workflow ID.
   */
  async unregisterWorkflow(wfId: string): Promise<void> {
    const unsubs = this.unsubscribeMap.get(wfId);
    if (unsubs) {
      for (const unsub of unsubs) {
        try {
          unsub();
        } catch {}
      }
      this.unsubscribeMap.delete(wfId);
    }

    // Remove any cron jobs for this workflow
    await this.cfg.db.run(
      `DELETE FROM scheduled_jobs WHERE id = ?`,
      `wf_cron_${wfId}`
    );
  }

  /**
   * Dispatches an incoming HTTP webhook call to matching workflows.
   */
  async dispatchWebhook(pathStr: string, payload: any): Promise<{ triggered: boolean; path: string }> {
    const normalized = this.normalizeWebhookPath(pathStr);
    const topic = `webhook:${normalized}`;
    const published = await this.eventBus.publish(topic, payload);
    return { triggered: published, path: normalized };
  }

  /**
   * Checks and executes due cron jobs for workflows.
   */
  async tickCron(): Promise<void> {
    const now = Date.now();
    const rows = await this.cfg.db.all(
      `SELECT * FROM scheduled_jobs WHERE id LIKE 'wf_cron_%' AND active = 1 AND next_run <= ?`,
      now
    );

    for (const job of rows) {
      const wfId = job.id.replace('wf_cron_', '');
      const wf = await this.cfg.registry.get(wfId);
      if (!wf) {
        await this.cfg.db.run(`DELETE FROM scheduled_jobs WHERE id = ?`, job.id);
        continue;
      }

      // Calculate next execution time
      let nextRun = now + 60000;
      try {
        nextRun = getNextCronTime(job.schedule, now, job.timezone || 'UTC');
      } catch (err) {
        console.error(`[WorkflowTriggerAdapter] Failed to calculate next cron for ${job.id}:`, err);
      }

      // Update schedule record
      await this.cfg.db.run(
        `UPDATE scheduled_jobs SET last_run = ?, next_run = ? WHERE id = ?`,
        now,
        nextRun,
        job.id
      );

      // Execute workflow asynchronously in background
      const cts = new CancellationTokenSource();
      let defaultInputs = {};
      try {
        defaultInputs = JSON.parse(job.prompt || '{}');
      } catch {}

      this.cfg.executor.run(wf, defaultInputs, `cron_${now}`, cts.token).catch(err => {
        console.error(`[WorkflowTriggerAdapter] Cron execution failed for workflow ${wf.id}:`, err);
      });
    }
  }

  private async registerCronJob(wfId: string, cronSchedule: string): Promise<void> {
    const now = Date.now();
    let nextRun = now;
    try {
      nextRun = getNextCronTime(cronSchedule, now);
    } catch {
      nextRun = now + 60000;
    }

    await this.cfg.db.run(
      `INSERT INTO scheduled_jobs (id, prompt, schedule, session_id, last_run, next_run, active, timezone, priority)
       VALUES (?, ?, ?, ?, NULL, ?, 1, 'UTC', 'normal')
       ON CONFLICT(id) DO UPDATE SET
         schedule = excluded.schedule,
         next_run = excluded.next_run,
         active = 1`,
      `wf_cron_${wfId}`,
      JSON.stringify({ triggeredBy: 'cron', workflowId: wfId }),
      cronSchedule,
      `workflow_${wfId}`,
      nextRun
    );
  }

  private normalizeWebhookPath(pathStr: string): string {
    return pathStr
      .trim()
      .replace(/^\/+/, '')
      .replace(/\/+$/, '')
      .replace(/^hooks\//, '')
      .replace(/^webhooks\//, '');
  }
}
