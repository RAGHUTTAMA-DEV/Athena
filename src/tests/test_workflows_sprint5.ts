import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import express from 'express';
import { AthenaDatabase } from '../storage/database.js';
import { WorkflowRegistry } from '../workflows/registry.js';
import { WorkflowExecutor } from '../workflows/executor.js';
import { WorkflowTriggerAdapter } from '../workflows/triggerAdapter.js';
import { registerWorkflowRoutes } from '../api/routes/workflowRoutes.js';
import { Workflow } from '../workflows/types.js';

const TEST_DB = path.resolve('./scratch_test_workflows_sprint5.db');

async function runTests() {
  console.log('=== STARTING WORKFLOWS SPRINT 5: API ROUTES & WEBHOOK INGESTION ===\n');

  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }

  const athenaDb = await AthenaDatabase.open(TEST_DB);
  const db = athenaDb.getHandle();

  const registry = new WorkflowRegistry(db);
  const executor = new WorkflowExecutor({ registry });
  const triggerAdapter = new WorkflowTriggerAdapter({ registry, executor, db });
  await triggerAdapter.init();

  const app = express();
  app.use(express.json());
  registerWorkflowRoutes(app, {
    registry,
    executor,
    triggerAdapter
  });

  async function callApi(options: {
    method: string;
    url: string;
    body?: any;
    headers?: Record<string, string>;
  }): Promise<{ status: number; json: any; text: string }> {
    return new Promise((resolve) => {
      let statusCode = 200;
      let output = '';

      const urlObj = new URL(`http://localhost:3000${options.url}`);
      const req: any = {
        method: options.method.toUpperCase(),
        url: options.url,
        baseUrl: '',
        originalUrl: options.url,
        path: urlObj.pathname,
        query: Object.fromEntries(urlObj.searchParams.entries()),
        body: options.body || {},
        headers: { host: 'localhost:3000', accept: 'application/json', ...(options.headers || {}) }
      };

      const res: any = {
        statusCode: 200,
        status(code: number) {
          statusCode = code;
          this.statusCode = code;
          return this;
        },
        setHeader() {
          return this;
        },
        json(data: any) {
          output = JSON.stringify(data);
          resolve({ status: statusCode, json: data, text: output });
        },
        send(data: any) {
          output = typeof data === 'string' ? data : JSON.stringify(data);
          let json: any = null;
          try { json = JSON.parse(output); } catch {}
          resolve({ status: statusCode, json, text: output });
        }
      };

      (app as any)(req, res, (err: any) => {
        if (err) {
          resolve({ status: 500, json: { error: { message: err.message } }, text: err.message });
        } else {
          resolve({ status: 404, json: { error: { message: 'Not Found' } }, text: 'Not Found' });
        }
      });
    });
  }

  // -------------------------------------------------------------------------
  // TEST 1: Workflow CRUD Endpoints
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Workflow CRUD Endpoints ---');

  // List initially empty
  const list1 = await callApi({ method: 'GET', url: '/api/v1/workflows' });
  assert.strictEqual(list1.status, 200);
  assert.strictEqual(list1.json.workflows.length, 0);

  // Validation failure on invalid workflow (cycle)
  const cyclicWf: Workflow = {
    id: 'cyclic-wf',
    name: 'Cyclic Workflow',
    description: 'Should fail validation',
    version: 1,
    inputs: {},
    settings: { maxTurns: 10 },
    nodes: [
      { id: 'a', type: 'tool', tool: 'echo', args: {} },
      { id: 'b', type: 'tool', tool: 'echo', args: {} }
    ],
    edges: [
      ['a', 'b'],
      ['b', 'a']
    ]
  };

  const createCyclic = await callApi({
    method: 'POST',
    url: '/api/v1/workflows',
    body: cyclicWf
  });
  assert.strictEqual(createCyclic.status, 400);
  assert.ok(createCyclic.json.error.message.includes('validation failed'));
  assert.ok(createCyclic.json.error.details.errors.length > 0);

  // Valid workflow creation
  const validWf: Workflow = {
    id: 'api-test-wf',
    name: 'API Test Workflow',
    description: 'Valid workflow created via REST API',
    version: 1,
    inputs: {
      greeting: { type: 'string', required: true }
    },
    settings: { maxTurns: 10 },
    nodes: [
      { id: 'start', type: 'trigger', triggerType: 'manual' },
      { id: 'step1', type: 'tool', tool: 'noop', args: { msg: '{{inputs.greeting}}' } }
    ],
    edges: [
      ['start', 'step1']
    ]
  };

  const createValid = await callApi({
    method: 'POST',
    url: '/api/v1/workflows',
    body: validWf
  });
  assert.strictEqual(createValid.status, 201);
  assert.strictEqual(createValid.json.workflow.id, 'api-test-wf');
  assert.strictEqual(createValid.json.workflow.version, 1);

  // Get by ID
  const getWf = await callApi({ method: 'GET', url: '/api/v1/workflows/api-test-wf' });
  assert.strictEqual(getWf.status, 200);
  assert.strictEqual(getWf.json.workflow.name, 'API Test Workflow');

  // Update workflow (increments version)
  const updateRes = await callApi({
    method: 'PUT',
    url: '/api/v1/workflows/api-test-wf',
    body: {
      ...validWf,
      name: 'API Test Workflow Updated'
    }
  });
  assert.strictEqual(updateRes.status, 200);
  assert.strictEqual(updateRes.json.workflow.version, 2);
  assert.strictEqual(updateRes.json.workflow.name, 'API Test Workflow Updated');

  console.log('✔ Workflow CRUD endpoints and validation verified.\n');

  // -------------------------------------------------------------------------
  // TEST 2: Workflow Execution Endpoints (Sync & Async)
  // -------------------------------------------------------------------------
  console.log('--- TEST 2: Workflow Execution Endpoints ---');

  // Synchronous run
  const runSync = await callApi({
    method: 'POST',
    url: '/api/v1/workflows/api-test-wf/run',
    body: {
      inputs: { greeting: 'Hello Athena API' },
      sync: true
    }
  });
  assert.strictEqual(runSync.status, 200);
  assert.strictEqual(runSync.json.status, 'completed');
  assert.ok(runSync.json.runId);

  // Check run status and node outputs
  const runDetails = await callApi({
    method: 'GET',
    url: `/api/v1/workflows/runs/${runSync.json.runId}`
  });
  assert.strictEqual(runDetails.status, 200);
  assert.strictEqual(runDetails.json.run.status, 'completed');
  assert.ok(runDetails.json.nodeOutputs['start']);
  assert.ok(runDetails.json.nodeOutputs['step1']);

  // Asynchronous run
  const runAsync = await callApi({
    method: 'POST',
    url: '/api/v1/workflows/api-test-wf/run',
    body: {
      inputs: { greeting: 'Hello Async' },
      sync: false
    }
  });
  assert.strictEqual(runAsync.status, 202);
  assert.strictEqual(runAsync.json.status, 'running');
  assert.ok(runAsync.json.runId);

  // Resume run endpoint
  const resumeRes = await callApi({
    method: 'POST',
    url: `/api/v1/workflows/runs/${runSync.json.runId}/resume`,
    body: { approved: true, notes: 'Looks good' }
  });
  assert.strictEqual(resumeRes.status, 200);
  assert.strictEqual(resumeRes.json.approved, true);

  console.log('✔ Sync/Async execution, run inspection, and resume endpoints verified.\n');

  // -------------------------------------------------------------------------
  // TEST 3: Webhook Ingestion Wildcard Endpoint
  // -------------------------------------------------------------------------
  console.log('--- TEST 3: Webhook Ingestion Wildcard Endpoint ---');

  const webhookWf: Workflow = {
    id: 'webhook-ci-wf',
    name: 'CI Webhook Triggered Workflow',
    description: 'Triggered when Github action finishes',
    version: 1,
    inputs: {
      commit: { type: 'string', required: false }
    },
    settings: { maxTurns: 10 },
    nodes: [
      { id: 'hook', type: 'trigger', triggerType: 'webhook', webhookPath: 'ci/deploy' },
      { id: 'notify', type: 'tool', tool: 'noop', args: { commit: '{{inputs.commit}}' } }
    ],
    edges: [['hook', 'notify']]
  };

  await callApi({
    method: 'POST',
    url: '/api/v1/workflows',
    body: webhookWf
  });

  // Wait a tick for triggerAdapter EventBus listener
  await new Promise(r => setTimeout(r, 100));

  // Dispatch webhook call to /api/v1/webhooks/ci/deploy
  const webhookRes = await callApi({
    method: 'POST',
    url: '/api/v1/webhooks/ci/deploy',
    body: {
      commit: 'git_commit_sha_987654',
      status: 'success'
    }
  });
  assert.strictEqual(webhookRes.status, 200);
  assert.strictEqual(webhookRes.json.success, true);
  assert.strictEqual(webhookRes.json.path, 'ci/deploy');
  assert.strictEqual(webhookRes.json.triggered, true);

  // -------------------------------------------------------------------------
  // TEST 4: Delete Workflow Endpoint
  // -------------------------------------------------------------------------
  console.log('--- TEST 4: Delete Workflow Endpoint ---');
  const deleteRes = await callApi({
    method: 'DELETE',
    url: '/api/v1/workflows/api-test-wf'
  });
  assert.strictEqual(deleteRes.status, 200);
  assert.strictEqual(deleteRes.json.success, true);

  const getDeleted = await callApi({
    method: 'GET',
    url: '/api/v1/workflows/api-test-wf'
  });
  assert.strictEqual(getDeleted.status, 404);

  await triggerAdapter.stop();
  await athenaDb.close();
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  console.log('✔ Workflow deletion and trigger cleanup verified.\n');

  console.log('===============================================================');
  console.log('🎉 ALL WORKFLOWS SPRINT 5 API & WEBHOOK TESTS PASSED! 🎉');
  console.log('===============================================================\n');
}

runTests().catch((err) => {
  console.error('FATAL TEST ERROR in test_workflows_sprint5:', err);
  process.exit(1);
});
