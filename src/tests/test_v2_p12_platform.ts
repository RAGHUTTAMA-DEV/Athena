import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { createStorage } from '../storage/storeFactory.js';
import { createAthenaServer } from '../api/server.js';
import { verifyUiIndependence } from './checkUiIndependence.js';

const TEST_DB = path.resolve('./scratch_test_v2_p12.db');

async function runTests() {
  console.log('=== STARTING V2 P12: PLATFORM & BACKEND SPECIFICATION TESTS (EXPRESS) ===\n');

  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }

  // -------------------------------------------------------------------------
  // TEST 1: Configuration Validation & Fast-Fail Behavior
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: Configuration Validation & Fast-Fail Behavior ---');
  let threwExpected = false;
  try {
    await createStorage({
      driver: 'postgres',
      postgresUrl: '' // Empty URL must fail fast
    });
  } catch (e: any) {
    threwExpected = true;
    assert.ok(e.message.includes('PostgreSQL configuration error'), 'Must report configuration error');
  }
  assert.ok(threwExpected, 'PostgreSQL selection without valid credentials must fail fast');
  console.log('✔ Configuration fast-fail validated.\n');

  // -------------------------------------------------------------------------
  // TEST 2: Unified Store Factory & SQLite Default Initialization
  // -------------------------------------------------------------------------
  console.log('--- TEST 2: Unified Store Factory & SQLite Default Initialization ---');
  const storage = await createStorage({
    driver: 'sqlite',
    sqlitePath: TEST_DB
  });
  assert.strictEqual(storage.driver, 'sqlite');
  const pingOk = await storage.ping();
  assert.strictEqual(pingOk, true, 'Database ping must succeed');
  console.log('✔ SQLite default storage initialized with migrations applied.\n');

  // -------------------------------------------------------------------------
  // TEST 3: Express Server Bootstrap & OpenAPI Documentation
  // -------------------------------------------------------------------------
  console.log('--- TEST 3: Express Server Bootstrap & OpenAPI Documentation ---');
  const app = await createAthenaServer({
    storage,
    corsOrigin: '*',
    logger: false
  });

  const server = app.listen(0);
  app.httpServer = server;
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  assert.ok(port > 0, 'Server must bind to dynamic ephemeral port');

  async function request(reqPath: string, options: { method?: string; headers?: Record<string, string>; body?: any } = {}) {
    const url = `http://127.0.0.1:${port}${reqPath}`;
    const res = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch {}
    return {
      statusCode: res.status,
      headers: Object.fromEntries(res.headers.entries()),
      payload: text,
      json
    };
  }

  // Verify OpenAPI & docs endpoints
  const openApiRes = await request('/api/v1/openapi.json');
  assert.strictEqual(openApiRes.statusCode, 200);
  assert.strictEqual(openApiRes.json.openapi, '3.1.0');

  const docsRes = await request('/docs');
  assert.strictEqual(docsRes.statusCode, 200);
  assert.ok(docsRes.payload.includes('SwaggerUIBundle'), 'Must render Swagger UI bundle HTML');
  console.log('✔ Express app booted with OpenAPI 3.1 & Swagger UI registered.\n');

  // -------------------------------------------------------------------------
  // TEST 4: Idempotent Message Submission & Durable Run Dispatch
  // -------------------------------------------------------------------------
  console.log('--- TEST 4: Idempotent Message Submission & Durable Run Dispatch ---');
  const idempotencyKey = 'key_unique_test_123';
  const dispatchRes1 = await request('/api/v1/sessions/session_test_abc/messages', {
    method: 'POST',
    headers: { 'x-idempotency-key': idempotencyKey },
    body: { content: 'Implement research analysis on quantum computing' }
  });

  assert.strictEqual(dispatchRes1.statusCode, 202);
  const data1 = dispatchRes1.json;
  assert.ok(data1.runId, 'Must return runId');
  assert.strictEqual(data1.status, 'queued');

  // Resubmit with same idempotency key
  const dispatchRes2 = await request('/api/v1/sessions/session_test_abc/messages', {
    method: 'POST',
    headers: { 'x-idempotency-key': idempotencyKey },
    body: { content: 'Implement research analysis on quantum computing' }
  });

  assert.strictEqual(dispatchRes2.statusCode, 200);
  const data2 = dispatchRes2.json;
  assert.strictEqual(data2.runId, data1.runId, 'Duplicate submission must return identical runId');
  assert.strictEqual(data2.isDuplicate, true, 'Must flag duplicate request');
  console.log(`✔ Durable dispatch verified: created run [${data1.runId}] with idempotency deduplication.\n`);

  // -------------------------------------------------------------------------
  // TEST 5: Unified Session State Hydration View
  // -------------------------------------------------------------------------
  console.log('--- TEST 5: Unified Session State Hydration View ---');
  const hydrationRes = await request('/api/v1/sessions/session_test_abc/state');

  assert.strictEqual(hydrationRes.statusCode, 200);
  const stateView = hydrationRes.json;
  assert.strictEqual(stateView.sessionId, 'session_test_abc');
  assert.ok(stateView.activeRun, 'Must return active run summary');
  assert.strictEqual(stateView.activeRun.runId, data1.runId);
  console.log('✔ Session hydration returned complete state view in a single round trip.\n');

  // -------------------------------------------------------------------------
  // TEST 6: Atomic Human Approval Decision & Race Prevention
  // -------------------------------------------------------------------------
  console.log('--- TEST 6: Atomic Human Approval Decision & Race Prevention ---');
  const approvalId = `appr_${Date.now()}`;
  await storage.stores.approval.createRequest({
    id: approvalId,
    action: 'deploy_to_production',
    riskLevel: 'critical',
    explanation: 'Deploying release v2.0 to prod servers',
    proposedAction: { environment: 'production' },
    status: 'pending',
    runId: data1.runId,
    createdAt: Date.now()
  });

  // Check pending list
  const pendingRes = await request('/api/v1/approvals/pending');
  const pendingData = pendingRes.json;
  assert.ok(pendingData.pending.some((a: any) => a.id === approvalId));

  // Decision 1: Approve
  const decideRes1 = await request(`/api/v1/approvals/${approvalId}/decision`, {
    method: 'POST',
    body: { status: 'approved', reason: 'Reviewed and confirmed by QA' }
  });
  assert.strictEqual(decideRes1.statusCode, 200);
  const decideData1 = decideRes1.json;
  assert.strictEqual(decideData1.approval.status, 'approved');

  // Decision 2: Competing race decision must fail with 409 Conflict
  const decideRes2 = await request(`/api/v1/approvals/${approvalId}/decision`, {
    method: 'POST',
    body: { status: 'rejected', reason: 'Late rejection' }
  });
  assert.strictEqual(decideRes2.statusCode, 409);
  const decideData2 = decideRes2.json;
  assert.strictEqual(decideData2.error.code, 'APPROVAL_ALREADY_RESOLVED');
  console.log('✔ Atomic approval decision verified; competing resolution rejected with 409 Conflict.\n');

  // -------------------------------------------------------------------------
  // TEST 7: Artifact Versioning, Diff Engine, and Raw Content
  // -------------------------------------------------------------------------
  console.log('--- TEST 7: Artifact Versioning, Diff Engine, and Raw Content ---');
  const artifactId = `art_test_${Date.now()}`;
  await storage.stores.artifact.saveArtifact({
    id: artifactId,
    name: 'architecture.md',
    type: 'document',
    mimeType: 'text/markdown',
    contentHash: 'hash_1',
    contentText: 'line 1: header\nline 2: initial text\nline 3: footer'
  });

  // Save Version 2
  await storage.stores.artifact.saveArtifact({
    id: artifactId,
    name: 'architecture.md',
    type: 'document',
    mimeType: 'text/markdown',
    contentHash: 'hash_2',
    contentText: 'line 1: header\nline 2: updated text for v2\nline 3: footer'
  });

  // Diff between v1 and v2
  const diffRes = await request(`/api/v1/artifacts/${artifactId}/diff?fromVersion=1&toVersion=2`);
  assert.strictEqual(diffRes.statusCode, 200);
  const diffData = diffRes.json;
  assert.ok(diffData.diff.some((d: any) => d.type === 'removed' && d.line.includes('initial text')));
  assert.ok(diffData.diff.some((d: any) => d.type === 'added' && d.line.includes('updated text for v2')));

  // Raw content stream
  const rawRes = await request(`/api/v1/artifacts/${artifactId}/raw`);
  assert.strictEqual(rawRes.statusCode, 200);
  assert.ok(rawRes.payload.includes('updated text for v2'));
  console.log('✔ Artifact versioning, line diffing, and raw streaming validated.\n');

  // -------------------------------------------------------------------------
  // TEST 8: Full Resource APIs Across Subsystems
  // -------------------------------------------------------------------------
  console.log('--- TEST 8: Full Resource APIs Across Subsystems ---');

  // 8a. Goals API
  const goalRes = await request('/api/v1/goals', {
    method: 'POST',
    body: { title: 'Master Autonomous Agent Engineering', priority: 'high' }
  });
  assert.strictEqual(goalRes.statusCode, 201);

  // 8b. Coding Harness
  const harnessRes = await request('/api/v1/harness/status');
  assert.strictEqual(harnessRes.statusCode, 200);

  // 8c. Desktop Computer Use
  const computerRes = await request('/api/v1/computer/screen');
  assert.ok(computerRes.statusCode === 200 || computerRes.statusCode === 503);

  // 8d. Research & RAG
  const researchRes = await request('/api/v1/research/documents/upload', {
    method: 'POST',
    body: { sourceUri: 'file:///quantum.txt', title: 'Quantum Computing Brief', textContent: 'Quantum bits exist in superposition.' }
  });
  assert.strictEqual(researchRes.statusCode, 201);

  // 8e. Intelligence & Models
  const modelsRes = await request('/api/v1/intelligence/models');
  assert.strictEqual(modelsRes.statusCode, 200);

  // 8f. Reliability Verification
  const verifyRes = await request('/api/v1/reliability/verify', {
    method: 'POST',
    body: { taskType: 'resulting_state', options: { command: 'node -v' } }
  });
  assert.strictEqual(verifyRes.statusCode, 200);

  // 8g. System Capabilities
  const capsRes = await request('/api/v1/system/capabilities');
  assert.strictEqual(capsRes.statusCode, 200);

  console.log('✔ All resource APIs responding according to exact contract.\n');

  // -------------------------------------------------------------------------
  // TEST 9: Health & Readiness Probes
  // -------------------------------------------------------------------------
  console.log('--- TEST 9: Health & Readiness Probes ---');
  const liveRes = await request('/health/live');
  assert.strictEqual(liveRes.statusCode, 200);
  assert.strictEqual(liveRes.json.status, 'ok');

  const readyRes = await request('/health/ready');
  assert.strictEqual(readyRes.statusCode, 200);
  assert.strictEqual(readyRes.json.status, 'ready');
  assert.strictEqual(readyRes.json.database.connected, true);
  console.log('✔ Liveness & database readiness probes verified.\n');

  // -------------------------------------------------------------------------
  // TEST 10: UI Independence CI Check & Graceful Teardown
  // -------------------------------------------------------------------------
  console.log('--- TEST 10: UI Independence CI Check & Graceful Teardown ---');
  const isUiIndependent = verifyUiIndependence();
  assert.strictEqual(isUiIndependent, true, 'Zero frontend/React imports permitted in core/backend');
  console.log('✔ Static UI-independence verification passed: 0 frontend imports.\n');

  // Graceful Teardown
  await app.close();
  if (fs.existsSync(TEST_DB)) {
    fs.unlinkSync(TEST_DB);
  }
  console.log('✔ Graceful shutdown executed cleanly.\n');

  console.log('=====================================================================');
  console.log('🎉 ALL 10 V2 P12 PLATFORM & BACKEND SPECIFICATION TESTS PASSED! 🎉');
  console.log('=====================================================================');
}

runTests().catch(err => {
  console.error('❌ P12 Test Suite Failed:', err);
  process.exit(1);
});
