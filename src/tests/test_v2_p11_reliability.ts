import * as fs from 'fs/promises';
import * as path from 'path';
import { openDatabase } from '../storage/database.js';
import { createSqliteStores } from '../storage/stores/sqlite/index.js';
import { CapabilityRegistry, seedP11Capabilities } from '../tools/capabilityRegistry.js';
import {
  TaskVerificationEngine,
  IndependentReviewer,
  SelfRepairEngine,
  ApprovalEngine,
  ClarificationManager,
  DeterministicReplayer
} from '../reliability/index.js';
import {
  approvalRequestTool,
  artifactManageTool,
  verificationInspectTool
} from '../tools/reliabilityTools.js';

const TEST_DB_PATH = path.resolve('./scratch/test_v2p11_reliability.db');
const TEST_SCRATCH_DIR = path.resolve('./scratch/test_v2p11_artifacts');

async function cleanup(): Promise<void> {
  try {
    await fs.rm(TEST_DB_PATH, { force: true });
    await fs.rm(`${TEST_DB_PATH}-wal`, { force: true });
    await fs.rm(`${TEST_DB_PATH}-shm`, { force: true });
    await fs.rm(TEST_SCRATCH_DIR, { recursive: true, force: true });
  } catch {}
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests(): Promise<void> {
  console.log('=== STARTING V2 P11: RELIABILITY SUBSYSTEM TESTS ===\n');
  await cleanup();
  await fs.mkdir(TEST_SCRATCH_DIR, { recursive: true });

  const db = await openDatabase(TEST_DB_PATH);
  const stores = createSqliteStores(db);

  try {
    // -------------------------------------------------------------
    // TEST 1: Schema Migration 12 & Store CRUD
    // -------------------------------------------------------------
    console.log('--- TEST 1: Schema Migration 12 & Store CRUD ---');

    // 1a. Approval Store
    const req1 = await stores.approval.createRequest({
      id: 'appr_test_001',
      action: 'fs:delete',
      riskLevel: 'high',
      explanation: 'Deleting obsolete build directory',
      proposedAction: { path: '/tmp/build' },
      status: 'pending',
      runId: 'run_rel_01',
      createdAt: Date.now()
    });
    assert(req1.id === 'appr_test_001', 'Approval request should be created');

    const fetchedAppr = await stores.approval.getRequest('appr_test_001');
    assert(fetchedAppr?.status === 'pending', 'Fetched approval status should be pending');

    // 1b. Artifact Store
    const art1 = await stores.artifact.saveArtifact({
      id: 'art_code_001',
      name: 'databaseConnector.ts',
      type: 'code',
      mimeType: 'text/typescript',
      contentHash: 'hash_v1',
      contentText: 'export const connect = () => {};',
      runId: 'run_rel_01',
      createdAt: Date.now()
    });
    assert(art1.currentVersion === 1, 'Initial artifact version should be 1');

    // 1c. Replay Store
    const step1 = await stores.replay.recordStep({
      id: 'step_001',
      runId: 'run_rel_01',
      stepIndex: 1,
      modelInput: { prompt: 'build artifact' },
      modelOutput: { text: 'Done' },
      stateDiff: { status: 'in_progress' },
      timestamp: Date.now()
    });
    assert(step1.stepIndex === 1, 'Replay step recorded correctly');

    console.log('✔ Migration 12 tables and CRUD operations verified.');

    // -------------------------------------------------------------
    // TEST 2: Multi-Category Task Verification Engine
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Multi-Category Task Verification Engine ---');

    const verifier = new TaskVerificationEngine();

    // 2a: file_verified
    const sampleFilePath = path.join(TEST_SCRATCH_DIR, 'config.json');
    await fs.writeFile(sampleFilePath, JSON.stringify({ mode: 'production', timeout: 30 }));
    const fileRes = await verifier.verify({
      taskType: 'file_verified',
      expectedOutcome: 'production',
      evidence: {},
      options: { filePath: sampleFilePath }
    });
    assert(fileRes.passed, `File verification should pass: ${fileRes.failureReasons.join(', ')}`);
    assert(fileRes.score === 1.0, 'File verification score should be 1.0');

    // 2b: page_inspected
    const pageRes = await verifier.verify({
      taskType: 'page_inspected',
      expectedOutcome: 'Dashboard loaded',
      evidence: '<html><body><div id="dashboard-header">Overview</div><button class="submit-btn">Run</button></body></html>',
      options: { domElements: ['#dashboard-header', '.submit-btn'] }
    });
    assert(pageRes.passed, 'Page inspection verification should pass');

    // 2c: test_build
    const buildRes = await verifier.verify({
      taskType: 'test_build',
      expectedOutcome: 'Build successful',
      evidence: { exitCode: 0, testResults: { passed: 15, failed: 0 } }
    });
    assert(buildRes.passed, 'Build / test verification should pass');

    // 2d: sources_checked
    const sourcesRes = await verifier.verify({
      taskType: 'sources_checked',
      expectedOutcome: 'Research citations valid',
      evidence: [
        { title: 'Google Research Paper', url: 'https://arxiv.org/abs/2301.00000' },
        { title: 'IEEE Spectrum Article', url: 'https://spectrum.ieee.org/ai' }
      ],
      options: { minSources: 2 }
    });
    assert(sourcesRes.passed, 'Sources verification should pass');

    // 2e: delivery_result
    const deliveryRes = await verifier.verify({
      taskType: 'delivery_result',
      expectedOutcome: 'Delivered to user channel',
      evidence: { status: 'delivered' }
    });
    assert(deliveryRes.passed, 'Delivery verification should pass');

    // 2f: resulting_state
    const stateRes = await verifier.verify({
      taskType: 'resulting_state',
      expectedOutcome: 'DB state synced',
      evidence: { currentStatus: 'active', syncedRows: 100 },
      options: {
        expectedState: { currentStatus: 'active', syncedRows: 100 },
        currentState: { currentStatus: 'active', syncedRows: 100 }
      }
    });
    assert(stateRes.passed, 'Resulting state verification should pass');

    console.log('✔ All 6 task verification categories verified successfully.');

    // -------------------------------------------------------------
    // TEST 3: Bounded Five-Stage Self-Repair Loop
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Bounded Five-Stage Self-Repair Loop ---');

    const repairEngine = new SelfRepairEngine();

    // Problem: buggy code with syntax error "const = 42;"
    const buggyCode = 'const = 42;\nconsole.log(result);';
    const errorMsg = 'SyntaxError: missing identifier in const declaration';

    const repairResult = await repairEngine.executeLoop({
      task: 'Assign result variable to 42',
      originalCodeOrAction: buggyCode,
      errorOrFailure: errorMsg,
      maxAttempts: 3,
      verifier: async (candidate: string) => {
        const passed = candidate.includes('const result = 42;');
        return {
          passed,
          message: passed ? undefined : 'Identifier "result" still missing from declaration.'
        };
      }
    });

    assert(repairResult.repaired, 'Self-repair loop should succeed');
    assert(repairResult.attemptsCount === 1, `Expected 1 attempt, got ${repairResult.attemptsCount}`);
    assert(repairResult.attempts[0].failureClassification === 'syntax', 'Failure should be classified as syntax');
    assert(repairResult.finalOutput.includes('const result = 42;'), 'Repaired output must fix the syntax error');
    assert(!repairResult.exhausted, 'Attempts budget must not be exhausted');

    console.log(`  Repair completed in attempt ${repairResult.attemptsCount} with classification [${repairResult.attempts[0].failureClassification}].`);
    console.log('✔ Bounded 5-stage self-repair loop validated.');

    // -------------------------------------------------------------
    // TEST 4: Exit Criterion 2: Independent Reviewer Catches Seeded Defects
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Exit Criterion 2: Independent Reviewer Defect Catching ---');

    const reviewer = new IndependentReviewer();

    // 4a. Clean work: should be approved
    const cleanWork = {
      task: 'Implement binary search algorithm in TypeScript',
      proposedCodeOrAnswer: `
        export function binarySearch(arr: number[], target: number): number {
          let left = 0;
          let right = arr.length - 1;
          while (left <= right) {
            const mid = Math.floor((left + right) / 2);
            if (arr[mid] === target) return mid;
            if (arr[mid] < target) left = mid + 1;
            else right = mid - 1;
          }
          return -1;
        }
      `
    };
    const cleanReview = await reviewer.review(cleanWork);
    assert(cleanReview.approved, `Clean code should be approved by reviewer: ${cleanReview.summary}`);
    assert(cleanReview.defectsCaught.length === 0, 'Clean code should have 0 defects');
    console.log('  Clean work passed review with score 1.0.');

    // 4b. Seeded defects suite
    const defectCases = [
      {
        name: 'Destructive root deletion',
        code: 'async function cleanup() { await exec("rm -rf /"); }',
        expectedKeyword: 'Destructive'
      },
      {
        name: 'Insecure eval execution',
        code: 'function runUserCode(code: string) { return eval(code); }',
        expectedKeyword: 'eval'
      },
      {
        name: 'Exposed API key',
        code: 'const apiKey = "AIzaSyDx9876543210AbCdEfGhIjKlMnOpQrStU";',
        expectedKeyword: 'API key'
      },
      {
        name: 'Syntax defect',
        code: 'function test() { const = 10; }',
        expectedKeyword: 'Syntax'
      },
      {
        name: 'Hallucinated API URL',
        code: 'const endpoint = "https://fake-api-domain-does-not-exist.com/v1/data";',
        expectedKeyword: 'Fabricated'
      }
    ];

    let caughtCount = 0;
    for (const defect of defectCases) {
      const reviewResult = await reviewer.review({
        task: `Execute task: ${defect.name}`,
        proposedCodeOrAnswer: defect.code
      });
      assert(!reviewResult.approved, `Reviewer must reject defect case: "${defect.name}"`);
      assert(reviewResult.defectsCaught.length > 0, `Must record defect for "${defect.name}"`);
      const matched = reviewResult.defectsCaught.some(d => d.includes(defect.expectedKeyword));
      assert(matched, `Expected defect description matching "${defect.expectedKeyword}", got: ${reviewResult.defectsCaught.join(', ')}`);
      caughtCount++;
      console.log(`  Caught defect [${defect.name}]: ${reviewResult.defectsCaught[0]}`);
    }

    assert(caughtCount === defectCases.length, `Expected 100% defect detection, caught ${caughtCount}/${defectCases.length}`);
    console.log('✔ Exit Criterion 2 passed: Independent reviewer caught 100% of seeded defects in eval.');

    // -------------------------------------------------------------
    // TEST 5: Bounded Single-Question Clarification
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Bounded Single-Question Clarification ---');

    const clarification = new ClarificationManager();

    // 5a. Ambiguous deployment prompt
    const ambiguousPrompt = 'Please deploy the application now';
    const q1 = clarification.assessAmbiguity(ambiguousPrompt);
    assert(q1 !== null, 'Should detect critical ambiguity in deployment without target environment');
    assert(q1?.contextKey === 'target_environment', 'Context key should be target_environment');
    assert(q1?.options?.includes('staging') === true, 'Options should include staging');
    console.log(`  Generated clarification question: "${q1?.question}"`);

    // 5b. Integrate answer and resume autonomy
    const resolvedPrompt = clarification.integrateAnswer(ambiguousPrompt, q1!, 'staging');
    assert(resolvedPrompt.includes('staging'), 'Resolved prompt must include user answer');

    // 5c. Resolved prompt no longer triggers ambiguity
    const q2 = clarification.assessAmbiguity(resolvedPrompt);
    assert(q2 === null, 'Resolved prompt must not re-trigger ambiguity question');
    console.log('✔ Single bounded clarification question validated with zero loop recurrence.');

    // -------------------------------------------------------------
    // TEST 6: Versioned Artifact Store with Content Hash Tracking
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Versioned Artifact Store with Content Hash Tracking ---');

    // Save version 1
    const artV1 = await stores.artifact.saveArtifact({
      id: 'doc_athena_spec',
      name: 'architecture_spec.md',
      type: 'document',
      mimeType: 'text/markdown',
      contentHash: 'hash_v1_aaa',
      contentText: '# Athena Architecture\nVersion 1 draft.',
      runId: 'run_rel_02',
      createdAt: Date.now()
    });
    assert(artV1.currentVersion === 1, 'Initial version is 1');

    // Save version 2
    const artV2 = await stores.artifact.saveArtifact({
      id: 'doc_athena_spec',
      name: 'architecture_spec.md',
      type: 'document',
      mimeType: 'text/markdown',
      contentHash: 'hash_v2_bbb',
      contentText: '# Athena Architecture\nVersion 2 updated with P11 reliability.',
      runId: 'run_rel_02'
    });
    assert(artV2.currentVersion === 2, `Version should increment to 2, got ${artV2.currentVersion}`);

    // Verify version history
    const versions = await stores.artifact.listVersions('doc_athena_spec');
    assert(versions.length === 2, `Expected 2 versions in history, got ${versions.length}`);
    assert(versions[0].version === 1 && versions[1].version === 2, 'Version sequence must be [1, 2]');
    assert(versions[0].contentHash !== versions[1].contentHash, 'Content hashes must reflect changes');
    console.log(`  Artifact version history verified: ${versions.length} versions with hashes [${versions[0].contentHash.slice(0, 8)}, ${versions[1].contentHash.slice(0, 8)}].`);
    console.log('✔ Versioned artifact store validated.');

    // -------------------------------------------------------------
    // TEST 7: Exit Criterion 1: Approval Cross-Process Restart Survival
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Exit Criterion 1: Approval Cross-Process Restart Survival ---');

    // Process A: Initiates high-risk action
    const approvalEngineA = new ApprovalEngine(stores.approval, stores.runWait);

    const highRiskAction = {
      action: 'delete_database_records',
      params: { table: 'audit_logs', criteria: 'all' },
      runId: 'run_restart_test_999'
    };

    // Register the run in runStore to satisfy foreign key constraint
    await stores.run.save({
      runId: 'run_restart_test_999',
      rootRunId: 'run_restart_test_999',
      sessionId: 'sess_rel_01',
      task: 'delete_database_records',
      status: 'running',
      currentTurn: 1,
      budget: { maxTurns: 5 },
      usage: { elapsedTimeMs: 0, tokens: { input: 0, output: 0, total: 0 }, costUsd: 0, toolCallsCount: 0, turnsCount: 0 },
      idempotencyKeys: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    const evaluation = approvalEngineA.evaluate(highRiskAction);
    assert(evaluation.requiresApproval, 'Action must require approval');
    assert(evaluation.triggerType === 'destructive', 'Trigger type should be destructive');

    const approvalReq = await approvalEngineA.requestApproval(highRiskAction, evaluation);
    assert(approvalReq.status === 'pending', 'Approval must be pending');

    // Verify active run wait was created in SQLite
    const activeWaitsA = await stores.runWait.listActive();
    const waitRecord = activeWaitsA.find(w => w.runId === 'run_restart_test_999');
    assert(waitRecord !== undefined, 'RunWait must be registered in SQLite for the run');
    assert(waitRecord?.status === 'waiting', 'RunWait status must be waiting');
    console.log(`  Process A created approval request [${approvalReq.id}] and RunWait [${waitRecord?.id}].`);

    // SIMULATED CRASH / PROCESS RESTART:
    // Process A is killed. A brand new process B connects to the same database.
    console.log('  [Simulated Process Kill & Restart]');
    const dbB = await openDatabase(TEST_DB_PATH);
    const storesB = createSqliteStores(dbB);
    const approvalEngineB = new ApprovalEngine(storesB.approval, storesB.runWait);

    // Process B queries pending approvals across the gateway
    const pendingInB = await approvalEngineB.listPending('run_restart_test_999');
    assert(pendingInB.length === 1, 'Pending approval must survive restart in SQLite');
    assert(pendingInB[0].id === approvalReq.id, 'Approval ID must match across restart');

    // User grants approval through Process B
    const resolvedReq = await approvalEngineB.resolveApproval(
      approvalReq.id,
      'approved',
      'Operator authorized database deletion'
    );
    assert(resolvedReq?.status === 'approved', 'Approval status must be updated to approved');

    // Verify run wait in SQLite was satisfied, allowing run to resume
    const waitRecordAfterRestart = await storesB.runWait.get(waitRecord!.id);
    assert(waitRecordAfterRestart?.status === 'satisfied', `RunWait status should be satisfied, got ${waitRecordAfterRestart?.status}`);
    console.log(`  Process B resolved approval [${resolvedReq?.id}] -> RunWait marked [${waitRecordAfterRestart?.status}].`);
    await dbB.close();

    console.log('✔ Exit Criterion 1 passed: Approval survived process restart and resumed run wait.');

    // -------------------------------------------------------------
    // TEST 8: Exit Criterion 3: Deterministic Run Replay from Log
    // -------------------------------------------------------------
    console.log('\n--- TEST 8: Exit Criterion 3: Deterministic Run Replay from Log ---');

    const replayer = new DeterministicReplayer(stores.replay);
    const testRunId = 'run_replay_deterministic_01';

    // Record 3 sequential steps of a run
    await replayer.recordStep(testRunId, 1, {
      modelInput: { prompt: 'Initialize project' },
      modelOutput: { action: 'create_package' },
      toolCalls: [{ tool: 'writeFile', file: 'package.json' }],
      toolOutputs: { success: true, bytesWritten: 128 },
      stateDiff: { step: 1, packageCreated: true }
    });

    await replayer.recordStep(testRunId, 2, {
      modelInput: { prompt: 'Install dependencies' },
      modelOutput: { action: 'run_install' },
      toolCalls: [{ tool: 'terminal', cmd: 'npm install' }],
      toolOutputs: { exitCode: 0, stdout: 'added 5 packages' },
      stateDiff: { step: 2, dependenciesInstalled: true }
    });

    await replayer.recordStep(testRunId, 3, {
      modelInput: { prompt: 'Compile TypeScript' },
      modelOutput: { action: 'run_build' },
      toolCalls: [{ tool: 'terminal', cmd: 'npm run build' }],
      toolOutputs: { exitCode: 0, stdout: 'Compiled successfully' },
      stateDiff: { step: 3, buildPassed: true }
    });

    // Replay run offline using logged steps
    const replayOutcome = await replayer.replayRun(testRunId, async (step) => {
      // Mock playback that returns the recorded tool outputs deterministically
      return step.toolOutputs;
    });

    assert(replayOutcome.deterministic, `Replay must be deterministic: ${replayOutcome.divergences.join('; ')}`);
    assert(replayOutcome.totalSteps === 3, `Expected 3 steps, replayed ${replayOutcome.totalSteps}`);
    assert(replayOutcome.matchedSteps === 3, `Expected 3 matched steps, got ${replayOutcome.matchedSteps}`);
    assert(replayOutcome.divergences.length === 0, 'Must have zero divergences during deterministic replay');
    assert(replayOutcome.finalStateMatches, 'Final state must match recorded state');

    console.log(`  Replay verified ${replayOutcome.totalSteps}/${replayOutcome.totalSteps} steps with 0 divergences.`);
    console.log('✔ Exit Criterion 3 passed: Run replayed deterministically from log.');

    // -------------------------------------------------------------
    // TEST 9: Reliability Tools Execution
    // -------------------------------------------------------------
    console.log('\n--- TEST 9: Reliability Tools Execution ---');

    const toolContext: any = {
      memory: {
        getApprovalStore: () => stores.approval,
        getArtifactStore: () => stores.artifact
      },
      runId: 'run_tool_exec_01'
    };

    // 9a. approvalRequestTool
    const appToolRes = await approvalRequestTool.execute(
      {
        action: 'cmd:restart_service',
        riskLevel: 'medium',
        explanation: 'Restarting background telemetry daemon'
      },
      toolContext
    );
    assert(appToolRes.success === true, 'approvalRequestTool should succeed');
    assert(appToolRes.approvalId !== undefined, 'approvalId should be returned');

    // 9b. artifactManageTool
    const artToolRes = await artifactManageTool.execute(
      {
        action: 'save',
        name: 'release_report.md',
        type: 'report',
        contentText: '# Release 2.0 Report\nAll gates passed.'
      },
      toolContext
    );
    assert(artToolRes.success === true, 'artifactManageTool save should succeed');
    assert(artToolRes.artifact?.name === 'release_report.md', 'Artifact name must match');

    // 9c. verificationInspectTool
    const verifyToolRes = await verificationInspectTool.execute(
      {
        taskType: 'test_build',
        expectedOutcome: 'Build passes cleanly',
        evidence: { exitCode: 0 }
      },
      toolContext
    );
    assert(verifyToolRes.success === true, 'verificationInspectTool should succeed');
    assert(verifyToolRes.score === 1.0, 'Score should be 1.0');

    console.log('✔ All 3 reliability tools executed successfully through ToolContext.');

    // -------------------------------------------------------------
    // TEST 10: Capability Registry Reflection for P11
    // -------------------------------------------------------------
    console.log('\n--- TEST 10: Capability Registry Reflection for P11 ---');

    const registry = new CapabilityRegistry();
    seedP11Capabilities(registry);

    const p11Caps = registry.list('P11');
    const p11Ids = p11Caps.map(c => c.id);

    assert(p11Ids.includes('reliability.task_verification'), 'Missing reliability.task_verification');
    assert(p11Ids.includes('reliability.independent_reviewer'), 'Missing reliability.independent_reviewer');
    assert(p11Ids.includes('reliability.self_repair'), 'Missing reliability.self_repair');
    assert(p11Ids.includes('reliability.approvals_gateway'), 'Missing reliability.approvals_gateway');
    assert(p11Ids.includes('reliability.versioned_artifacts'), 'Missing reliability.versioned_artifacts');
    assert(p11Ids.includes('reliability.deterministic_replay'), 'Missing reliability.deterministic_replay');

    const allReal = p11Caps.every(c => c.status === 'real');
    assert(allReal, 'All P11 capabilities must be registered with status "real"');

    console.log(`  Found ${p11Caps.length} P11 capabilities registered honestly.`);
    console.log('✔ CapabilityRegistry reflection validated for P11.');

    console.log('\n=============================================================');
    console.log('🎉 ALL 10 V2 P11 RELIABILITY TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('=============================================================');
  } finally {
    await db.close();
    await cleanup();
  }
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
