import * as dotenv from 'dotenv';
dotenv.config();

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  TaskClassifier,
  Planner,
  VerificationGate,
  DynamicEscalator,
  ExecutionPlan
} from '../core/orchestration.js';
import { Agent } from '../core/agent.js';
import { EpisodicMemory } from '../core/memory.js';
import { AgentEvent } from '../core/events.js';

const TEST_SCRATCH_DIR = path.resolve(process.cwd(), 'scratch', 'test_p4_orchestration');
const TEST_DB_PATH = path.resolve(TEST_SCRATCH_DIR, 'p4_orchestration.db');

function cleanup() {
  if (fs.existsSync(TEST_SCRATCH_DIR)) {
    try {
      fs.rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

async function runPhase4Tests() {
  cleanup();
  fs.mkdirSync(TEST_SCRATCH_DIR, { recursive: true });

  console.log('=== STARTING PHASE 4 ADAPTIVE ORCHESTRATION TESTS ===\n');

  // --- TEST 1: Task Classification Heuristics ---
  console.log('--- TEST 1: Task Classification Heuristics ---');
  const simpleQuery = 'calculate 15 * 12';
  const simpleClass = TaskClassifier.classify(simpleQuery);
  assert.strictEqual(simpleClass.complexity, 'simple', 'Math question must be classified as simple');
  assert.strictEqual(simpleClass.requiresVerification, false, 'Simple query must not require verification overhead');
  assert.ok(simpleClass.suggestedMaxTurns <= 5, 'Simple query should have low max turns');

  const complexQuery = 'Please create a comprehensive step-by-step plan and architecture to refactor the database schema and migrate users';
  const complexClass = TaskClassifier.classify(complexQuery);
  assert.strictEqual(complexClass.complexity, 'complex', 'Architecture / planning task must be classified as complex');
  assert.strictEqual(complexClass.requiresVerification, true, 'Complex task must require verification');

  const riskyQuery = 'rm -rf / --no-preserve-root';
  const riskyClass = TaskClassifier.classify(riskyQuery);
  assert.strictEqual(riskyClass.complexity, 'high_risk', 'Destructive command must be classified as high_risk');
  assert.strictEqual(riskyClass.requiresVerification, true);
  console.log('✓ TEST 1 PASSED: Simple, complex, and high-risk queries classified accurately.\n');

  // --- TEST 2: Plan DAG Generation & Dependency Resolution ---
  console.log('--- TEST 2: Plan DAG Generation & Dependency Resolution ---');
  const plan = Planner.createPlanFromGoal('Build a notification microservice', [
    { description: 'Design database schema for notifications', dependencies: [] },
    { description: 'Implement dispatch queue handler', dependencies: ['step_1'] },
    { description: 'Write integration test suite', dependencies: ['step_2'] }
  ]);

  assert.strictEqual(plan.steps.length, 3);
  let executable = Planner.getExecutableSteps(plan);
  assert.strictEqual(executable.length, 1, 'Only step 1 should be executable initially');
  assert.strictEqual(executable[0].stepId, 'step_1');

  // Complete step 1
  plan.steps[0].status = 'completed';
  executable = Planner.getExecutableSteps(plan);
  assert.strictEqual(executable.length, 1, 'Step 2 should become executable once step 1 completes');
  assert.strictEqual(executable[0].stepId, 'step_2');

  // Complete step 2
  plan.steps[1].status = 'completed';
  executable = Planner.getExecutableSteps(plan);
  assert.strictEqual(executable.length, 1, 'Step 3 should become executable once step 2 completes');
  assert.strictEqual(executable[0].stepId, 'step_3');
  console.log('✓ TEST 2 PASSED: Plan DAG dependency resolution verified.\n');

  // --- TEST 3: Dynamic Runtime Escalation ---
  console.log('--- TEST 3: Dynamic Runtime Escalation ---');
  const escalator = new DynamicEscalator('simple');
  assert.strictEqual(escalator.getComplexity(), 'simple');

  // 1 failure should not escalate yet
  escalator.recordToolResult(false);
  assert.strictEqual(escalator.shouldEscalate(1).escalate, false);

  // 2nd consecutive failure in simple mode should escalate to medium
  escalator.recordToolResult(false);
  const check1 = escalator.shouldEscalate(2);
  assert.strictEqual(check1.escalate, true);
  assert.strictEqual(check1.targetComplexity, 'medium');

  escalator.escalate('medium');
  assert.strictEqual(escalator.getComplexity(), 'medium');

  // 3rd failure in medium mode should escalate to complex (plan DAG mode)
  escalator.recordToolResult(false);
  const check2 = escalator.shouldEscalate(5);
  assert.strictEqual(check2.escalate, true);
  assert.strictEqual(check2.targetComplexity, 'complex');
  console.log('✓ TEST 3 PASSED: Dynamic escalator transitioned simple ➔ medium ➔ complex on repeated errors.\n');

  // --- TEST 4: Verification Gate Criteria Checking ---
  console.log('--- TEST 4: Verification Gate Evaluation ---');
  const goodOutput = 'Here is the completed solution: The calculation yields 180 and the file src/index.ts has been validated.';
  const verifyGood = VerificationGate.verify('Calculate 15 * 12 and validate file', goodOutput, ['calculation', 'validated']);
  assert.strictEqual(verifyGood.passed, true);
  assert.ok(verifyGood.score >= 0.70);

  const flawedOutput = 'I could not access the server. An error occurred while executing the database query.';
  const verifyFlawed = VerificationGate.verify('Query database', flawedOutput);
  assert.strictEqual(verifyFlawed.passed, false);
  assert.ok(verifyFlawed.issues.length > 0);
  console.log(`✓ TEST 4 PASSED: Verification gate passed complete output and flagged errors with score ${verifyFlawed.score.toFixed(2)}.\n`);

  // --- TEST 5: End-to-End Simple Query Zero-Overhead Execution ---
  console.log('--- TEST 5: Simple Query Zero-Overhead Execution ---');
  const memory = new EpisodicMemory(TEST_DB_PATH);
  await memory.init();

  const agent = new Agent({
    provider: 'gemini',
    modelName: 'gemini-2.5-flash',
    maxTurns: 5,
    systemPrompt: 'You are an agent. Solve questions directly.',
    dbPath: TEST_DB_PATH,
    allowedTools: ['calculate', 'systemTime']
  });
  await agent.init();

  const simpleEvents: AgentEvent[] = [];
  const simpleResult = await agent.run(
    'calculate 10 + 20',
    [],
    {
      onUpdate: () => {},
      events: {
        emit: (ev: AgentEvent) => { simpleEvents.push(ev); },
        on: () => () => {}
      } as any
    }
  );

  const planEvents = simpleEvents.filter(e => e.type === 'plan_created');
  assert.strictEqual(planEvents.length, 0, 'Simple query must NOT create a plan or add planning token overhead');
  assert.ok(simpleResult.includes('30'), 'Result must include 30');
  console.log(`✓ TEST 5 PASSED: Simple query completed in direct loop with 0 planning overhead: "${simpleResult.trim()}".\n`);

  // --- TEST 6: End-to-End Complex Plan & Verification Event Stream ---
  console.log('--- TEST 6: Complex Plan & Verification Event Stream ---');
  const complexEvents: AgentEvent[] = [];
  const complexResult = await agent.run(
    'Please formulate a step-by-step plan to investigate and compare the prime numbers between 10 and 20.',
    [],
    {
      onUpdate: () => {},
      events: {
        emit: (ev: AgentEvent) => { complexEvents.push(ev); },
        on: () => () => {}
      } as any
    }
  );

  const complexPlanEvents = complexEvents.filter(e => e.type === 'plan_created');
  assert.ok(complexPlanEvents.length > 0, 'Complex query must emit plan_created event');

  const verificationEvents = complexEvents.filter(e => e.type === 'verification');
  assert.ok(verificationEvents.length > 0, 'Complex query must emit verification event');

  console.log(`✓ TEST 6 PASSED: Complex query emitted plan (${complexPlanEvents.length}) and verification (${verificationEvents.length}) events.\n`);

  await memory.close();
  cleanup();

  console.log('ALL PHASE 4 ADAPTIVE ORCHESTRATION TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runPhase4Tests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
