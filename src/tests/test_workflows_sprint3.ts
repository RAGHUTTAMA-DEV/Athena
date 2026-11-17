import { AthenaDatabase } from '../storage/database.js';
import {
  Workflow,
  WorkflowRegistry,
  WorkflowExecutor,
  AgentFactory,
  WorkflowTriggerAdapter
} from '../workflows/index.js';
import { EventBus } from '../background/eventBus.js';
import * as path from 'path';
import * as fs from 'fs';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    failedTests++;
    throw new Error(msg);
  } else {
    console.log(`✅ PASSED: ${msg}`);
    passedTests++;
  }
}

async function runSprint3Tests() {
  console.log('====================================================');
  console.log('🚀 Running Athena Workflows (Sprint 3 Triggers) Tests');
  console.log('====================================================\n');

  const tempDbPath = path.resolve(`./test_workflows_sprint3_${Date.now()}.db`);
  const athenaDb = await AthenaDatabase.open(tempDbPath);
  const db = athenaDb.getHandle();
  const registry = new WorkflowRegistry(db);
  const eventBus = EventBus.getInstance();

  let executedWorkflows: Array<{ wfId: string; inputs: any; runId: string }> = [];

  const mockAgentFactory: AgentFactory = {
    create: () => ({
      init: async () => {},
      run: async (prompt: string) => `Executed prompt: ${prompt}`
    } as any)
  };

  const executor = new WorkflowExecutor({
    registry,
    agentFactory: mockAgentFactory
  });

  // Track runs
  const originalRun = executor.run.bind(executor);
  executor.run = async (wf, inputs, parentRunId, token) => {
    const res = await originalRun(wf, inputs, parentRunId, token);
    executedWorkflows.push({ wfId: wf.id, inputs, runId: res.runId });
    return res;
  };

  const triggerAdapter = new WorkflowTriggerAdapter({
    registry,
    executor,
    db,
    eventBus
  });

  // ── 1. Webhook Trigger ────────────────────────────────────────────
  console.log('--- 1. Webhook Triggers ---');

  const webhookWf: Workflow = {
    id: 'github-webhook-handler',
    version: 1,
    name: 'GitHub Webhook Handler',
    inputs: { prNumber: { type: 'number' }, action: { type: 'string' } },
    settings: {},
    nodes: [
      {
        id: 'start',
        type: 'trigger',
        triggerType: 'webhook',
        webhookPath: 'github-prs'
      },
      {
        id: 'process_pr',
        type: 'agent',
        prompt: 'Process PR {{inputs.prNumber}} action: {{inputs.action}}',
        tools: []
      }
    ],
    edges: [['start', 'process_pr']]
  };

  await registry.save(webhookWf);
  await triggerAdapter.init();

  // Dispatch webhook payload
  const dispatchRes = await triggerAdapter.dispatchWebhook('github-prs', {
    prNumber: 9001,
    action: 'opened'
  });

  assert(dispatchRes.triggered === true, 'Webhook was successfully dispatched');
  assert(dispatchRes.path === 'github-prs', 'Webhook path was normalized correctly');

  // Allow async trigger execution to settle
  await new Promise(r => setTimeout(r, 200));

  const triggeredItem = executedWorkflows.find(e => e.wfId === 'github-webhook-handler');
  assert(triggeredItem !== undefined, 'Webhook trigger fired the workflow execution');
  assert(triggeredItem?.inputs?.prNumber === 9001, 'Workflow inputs received webhook payload data');

  // ── 2. Universal Programmatic EventBus Trigger ────────────────────
  console.log('\n--- 2. Programmatic EventBus Triggers ---');

  executedWorkflows = [];
  await eventBus.publish('workflow:trigger:github-webhook-handler', {
    inputs: { prNumber: 4242, action: 'reopened' }
  });

  await new Promise(r => setTimeout(r, 200));

  const busTriggered = executedWorkflows.find(e => e.wfId === 'github-webhook-handler');
  assert(busTriggered !== undefined, 'Direct eventBus topic workflow:trigger:<id> triggered workflow');
  assert(busTriggered?.inputs?.prNumber === 4242, 'Programmatic event payload was routed to inputs');

  // ── 3. Cron Trigger Scheduling & Execution ────────────────────────
  console.log('\n--- 3. Cron Trigger Scheduling & Execution ---');

  const cronWf: Workflow = {
    id: 'nightly-code-audit',
    version: 1,
    name: 'Nightly Code Audit',
    inputs: { mode: { type: 'string' } },
    settings: {},
    nodes: [
      {
        id: 'schedule_start',
        type: 'trigger',
        triggerType: 'cron',
        schedule: '0 2 * * *' // 2:00 AM daily
      },
      {
        id: 'audit_step',
        type: 'agent',
        prompt: 'Perform comprehensive security audit',
        tools: []
      }
    ],
    edges: [['schedule_start', 'audit_step']]
  };

  await registry.save(cronWf);

  // Verify scheduled_jobs row was created
  const jobRow = await db.get(
    `SELECT * FROM scheduled_jobs WHERE id = 'wf_cron_nightly-code-audit'`
  );
  assert(jobRow !== undefined && jobRow.active === 1, 'Cron job was inserted into scheduled_jobs table');
  assert(jobRow.schedule === '0 2 * * *', 'Schedule cron expression recorded accurately');
  assert(jobRow.next_run > Date.now(), 'Calculated next_run time is in the future');

  // Simulate cron tick firing (advance next_run to past)
  await db.run(
    `UPDATE scheduled_jobs SET next_run = ? WHERE id = 'wf_cron_nightly-code-audit'`,
    Date.now() - 1000
  );

  executedWorkflows = [];
  await triggerAdapter.tickCron();
  await new Promise(r => setTimeout(r, 200));

  const cronExecuted = executedWorkflows.find(e => e.wfId === 'nightly-code-audit');
  assert(cronExecuted !== undefined, 'Cron tick executed due scheduled workflow');

  // Verify next_run was updated forward
  const updatedJobRow = await db.get(
    `SELECT * FROM scheduled_jobs WHERE id = 'wf_cron_nightly-code-audit'`
  );
  assert(updatedJobRow.next_run > Date.now(), 'Cron job next_run was automatically updated forward');

  // ── 4. Dynamic Trigger Updates & Cleanup ──────────────────────────
  console.log('\n--- 4. Dynamic Trigger Updates & Cleanup ---');

  // Update workflow: change webhook path
  webhookWf.nodes[0] = {
    id: 'start',
    type: 'trigger',
    triggerType: 'webhook',
    webhookPath: 'updated-pr-path'
  };
  webhookWf.version++;
  await registry.save(webhookWf);

  await new Promise(r => setTimeout(r, 100));

  executedWorkflows = [];
  // Old path should not fire
  await triggerAdapter.dispatchWebhook('github-prs', { prNumber: 1 });
  await new Promise(r => setTimeout(r, 100));
  assert(!executedWorkflows.some(e => e.inputs?.prNumber === 1), 'Old webhook path was unregistered');

  // New path should fire
  await triggerAdapter.dispatchWebhook('updated-pr-path', { prNumber: 2 });
  await new Promise(r => setTimeout(r, 100));
  assert(executedWorkflows.some(e => e.inputs?.prNumber === 2), 'New webhook path was dynamically registered');

  // Delete workflow and verify cleanup
  await registry.delete('nightly-code-audit');
  await new Promise(r => setTimeout(r, 100));

  const deletedJobRow = await db.get(
    `SELECT * FROM scheduled_jobs WHERE id = 'wf_cron_nightly-code-audit'`
  );
  assert(deletedJobRow === undefined, 'Cron job removed from scheduled_jobs when workflow deleted');

  await triggerAdapter.stop();

  // Clean up temporary database
  try {
    await athenaDb.getHandle().close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  } catch (err) {}

  console.log('\n====================================================');
  console.log(`🎉 ALL SPRINT 3 TESTS COMPLETED: ${passedTests} passed, ${failedTests} failed`);
  console.log('====================================================');
}

runSprint3Tests().catch(err => {
  console.error('\n💥 Sprint 3 test run failed with fatal error:', err);
  process.exit(1);
});
