import * as dotenv from 'dotenv';
dotenv.config();

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { CodingHarnessBridge, CodingAcceptanceGate } from '../harness/codingHarness.js';
import { delegateCodingTaskTool } from '../tools/delegateCodingTask.js';
import { CancellationTokenSource } from '../runtime/cancellation.js';
import { ToolExecutor } from '../tools/toolRuntime.js';

const TEST_SCRATCH_DIR = path.resolve(process.cwd(), 'scratch', 'test_p5_harness');

function cleanup() {
  if (fs.existsSync(TEST_SCRATCH_DIR)) {
    try {
      fs.rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

async function runPhase5Tests() {
  cleanup();
  fs.mkdirSync(TEST_SCRATCH_DIR, { recursive: true });

  console.log('=== STARTING PHASE 5 CODING HARNESS INTEGRATION TESTS ===\n');

  const bridge = CodingHarnessBridge.getInstance();

  // --- TEST 1: Repository Intelligence & Tech Stack Discovery ---
  console.log('--- TEST 1: Repository Intelligence & Tech Stack Discovery ---');
  const repoInfo = await bridge.inspectRepo(process.cwd());
  assert.ok(repoInfo.cwd, 'Repo info must have resolved cwd');
  assert.strictEqual(repoInfo.packageManager, 'npm', 'Athena package manager should be npm');
  assert.strictEqual(repoInfo.hasTests, true, 'Athena has test scripts in package.json');
  assert.ok(repoInfo.gitBranch, 'Git branch should be detected');
  console.log(`✓ TEST 1 PASSED: Repo tech stack discovered (Manager: ${repoInfo.packageManager}, Branch: ${repoInfo.gitBranch}, Tests: ${repoInfo.hasTests}).\n`);

  // --- TEST 2: Pre-Execution Snapshot Coordination ---
  console.log('--- TEST 2: Pre-Execution Snapshot Coordination ---');
  const snapshotLabel = `test_snap_${Date.now()}`;
  const snapshotId = await bridge.createSnapshot(process.cwd(), snapshotLabel);
  assert.ok(snapshotId, 'Snapshot or git stash fallback identifier must be returned');
  console.log(`✓ TEST 2 PASSED: Pre-execution snapshot created with identifier: ${snapshotId}.\n`);

  // --- TEST 3: Coding Acceptance Gate Verification ---
  console.log('--- TEST 3: Coding Acceptance Gate Verification ---');
  const goodResult = {
    status: 'success' as const,
    summary: 'Refactored authentication middleware',
    filesChanged: ['src/auth/jwt.ts', 'src/auth/session.ts'],
    testsPassed: true
  };
  const passCheck = CodingAcceptanceGate.verify(goodResult, {
    requireTests: true,
    requiredFiles: ['src/auth/jwt.ts']
  });
  assert.strictEqual(passCheck.passed, true);

  const failResult = {
    status: 'failed' as const,
    error: 'Build failed on line 42: SyntaxError',
    filesChanged: ['src/auth/jwt.ts'],
    testsPassed: false
  };
  const failCheck = CodingAcceptanceGate.verify(failResult, { requireTests: true });
  assert.strictEqual(failCheck.passed, false);
  assert.ok(failCheck.issues.length >= 2, 'Should flag both failure status and failing tests');
  console.log(`✓ TEST 3 PASSED: Acceptance gate correctly verified success and flagged failing checks: "${failCheck.issues.join('; ')}".\n`);

  // --- TEST 4: Cooperative Cancellation Propagation ---
  console.log('--- TEST 4: Cooperative Cancellation Propagation ---');
  const cts = new CancellationTokenSource();
  const cancelPromise = bridge.executeTask(
    {
      runId: 'test_cancel_run',
      task: 'Perform large refactor and run long test suite',
      cwd: TEST_SCRATCH_DIR,
      timeoutSec: 60
    },
    {
      cancellationToken: cts.token
    }
  );

  // Trigger immediate cancellation
  setTimeout(() => cts.cancel('User stopped the coding task'), 50);

  const cancelResult = await cancelPromise;
  assert.strictEqual(cancelResult.status, 'cancelled', 'Task status must be cancelled');
  assert.ok(cancelResult.error?.includes('User stopped'), 'Error message must reflect cancellation reason');
  console.log(`✓ TEST 4 PASSED: Harness execution aborted cooperatively with status: ${cancelResult.status}.\n`);

  // --- TEST 5: delegateCodingTaskTool Typed Tool Execution via ToolExecutor ---
  console.log('--- TEST 5: delegateCodingTaskTool Typed Tool Execution ---');
  assert.strictEqual(delegateCodingTaskTool.definition.name, 'delegateCodingTask');
  assert.strictEqual(delegateCodingTaskTool.manifest?.riskLevel, 'confirm');
  assert.strictEqual(delegateCodingTaskTool.manifest?.parallelSafe, false);

  const executor = new ToolExecutor();
  const manifest = executor.resolveManifest(delegateCodingTaskTool);
  assert.strictEqual(manifest.riskLevel, 'confirm');
  assert.strictEqual(manifest.name, 'delegateCodingTask');
  console.log(`✓ TEST 5 PASSED: delegateCodingTask manifests and attributes verified (Risk: ${manifest.riskLevel}, Timeout: ${manifest.timeoutMs}ms).\n`);

  cleanup();
  console.log('ALL PHASE 5 CODING HARNESS INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runPhase5Tests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
