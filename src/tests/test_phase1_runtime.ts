import * as dotenv from 'dotenv';
dotenv.config();

import { Agent } from '../runtime/agent.js';
import { EpisodicMemory } from '../memory/memory.js';
import { createInitialRunState, RunState } from '../runtime/runState.js';
import { CancellationTokenSource } from '../runtime/cancellation.js';
import { AgentEventEmitter, AgentEvent } from '../runtime/events.js';
import * as path from 'path';
import * as fs from 'fs/promises';

async function runPhase1RuntimeTests() {
  console.log('=== STARTING PHASE 1 AGENT RUNTIME TESTS ===\n');

  const testDbDir = path.resolve(process.cwd(), 'scratch/test_phase1_runtime');
  await fs.mkdir(testDbDir, { recursive: true });
  const testDbPath = path.join(testDbDir, `runtime_test_${Date.now()}.db`);

  const memory = new EpisodicMemory(testDbPath);
  await memory.init();

  try {
    // ------------------------------------------------------------
    // TEST 1: RunState Persistence & Events CRUD in SQLite
    // ------------------------------------------------------------
    console.log('--- TEST 1: RunState Persistence & Event Streaming CRUD in SQLite ---');
    const run1 = createInitialRunState({
      runId: 'run-alpha-1',
      parentRunId: undefined,
      rootRunId: 'run-alpha-1',
      sessionId: 'session-alpha',
      task: 'Compute Fibonacci sequence',
      budget: { maxTurns: 10, maxToolCalls: 5, maxTimeMs: 60000 }
    });

    await memory.saveRunState(run1);
    const loadedRun1 = await memory.getRunState('run-alpha-1');

    if (!loadedRun1) throw new Error('Failed to retrieve saved RunState from SQLite');
    if (loadedRun1.runId !== 'run-alpha-1' || loadedRun1.status !== 'queued') {
      throw new Error(`Unexpected loaded run state: ${JSON.stringify(loadedRun1)}`);
    }
    if (loadedRun1.budget.maxTurns !== 10) {
      throw new Error(`Budget maxTurns mismatch: expected 10, got ${loadedRun1.budget.maxTurns}`);
    }

    // Append and retrieve events
    const event1: AgentEvent = {
      type: 'status_change',
      runId: 'run-alpha-1',
      from: 'queued',
      to: 'running',
      timestamp: Date.now()
    };
    await memory.saveRunEvent(event1);

    const event2: AgentEvent = {
      type: 'tool_call',
      runId: 'run-alpha-1',
      turn: 1,
      toolName: 'calculate',
      args: { expression: '1 + 1' },
      idempotencyKey: 'calc:1+1',
      timestamp: Date.now()
    };
    await memory.saveRunEvent(event2);

    const events = await memory.getRunEvents('run-alpha-1');
    if (events.length !== 2) {
      throw new Error(`Expected 2 events, got ${events.length}`);
    }
    if (events[1].type !== 'tool_call' || (events[1] as any).toolName !== 'calculate') {
      throw new Error(`Event payload mismatch: ${JSON.stringify(events[1])}`);
    }

    // Update status and list runs
    await memory.updateRunState('run-alpha-1', {
      status: 'completed',
      result: 'Calculated 2',
      terminationReason: 'goal_achieved'
    });
    const updatedRun1 = await memory.getRunState('run-alpha-1');
    if (updatedRun1?.status !== 'completed' || updatedRun1?.terminationReason !== 'goal_achieved') {
      throw new Error(`Failed to update run status: ${JSON.stringify(updatedRun1)}`);
    }

    const runList = await memory.listRuns('session-alpha');
    if (runList.length !== 1 || runList[0].runId !== 'run-alpha-1') {
      throw new Error(`listRuns failed: ${JSON.stringify(runList)}`);
    }
    console.log('✓ TEST 1 PASSED: RunState and Event CRUD verified in SQLite.\n');

    // ------------------------------------------------------------
    // TEST 2: Authoritative Lifecycle & Event Stream during Agent Run
    // ------------------------------------------------------------
    console.log('--- TEST 2: Lifecycle State Transitions & Event Streaming ---');
    const agent = new Agent({
      modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxTurns: 5,
      systemPrompt: 'You are an agent. Solve user math questions using the calculate tool.',
      allowedTools: ['calculate'],
      dbPath: testDbPath
    });
    await agent.init();

    const capturedEvents: AgentEvent[] = [];
    const eventsEmitter = new AgentEventEmitter();
    eventsEmitter.onAny((e) => {
      capturedEvents.push(e);
    });

    const runId2 = 'run-beta-2';
    const result2 = await agent.run(
      'Calculate 12 * 12',
      [],
      {
        runId: runId2,
        sessionId: 'session-beta',
        events: eventsEmitter,
        budget: { maxTurns: 5, maxToolCalls: 10 }
      }
    );

    const hasStatusChange = capturedEvents.some(e => e.type === 'status_change');
    const hasTurnStart = capturedEvents.some(e => e.type === 'turn_start');
    const hasCompleted = capturedEvents.some(e => e.type === 'completed' && e.status === 'completed');

    if (!hasStatusChange || !hasTurnStart || !hasCompleted) {
      throw new Error(`Missing expected events in stream: ${JSON.stringify(capturedEvents.map(e => e.type))}`);
    }

    const state2 = await agent.getRunState(runId2);
    if (!state2 || state2.status !== 'completed' || state2.terminationReason !== 'goal_achieved') {
      throw new Error(`Expected run2 to be completed with goal_achieved, got ${JSON.stringify(state2)}`);
    }
    if (state2.usage.toolCallsCount < 1) {
      throw new Error(`Expected at least 1 tool call in usage, got ${state2.usage.toolCallsCount}`);
    }
    console.log(`Agent Result: "${result2}"`);
    console.log(`✓ TEST 2 PASSED: Lifecycle completed smoothly, event stream captured ${capturedEvents.length} events.\n`);

    // ------------------------------------------------------------
    // TEST 3: Cooperative Cancellation Propagation
    // ------------------------------------------------------------
    console.log('--- TEST 3: Cooperative Cancellation Propagation ---');
    const cts = new CancellationTokenSource();
    const runId3 = 'run-cancel-3';

    // Cancel token immediately before running
    cts.cancel('User requested abort');

    let wasCancelled = false;
    try {
      await agent.run(
        'Calculate 500 * 500',
        [],
        {
          runId: runId3,
          sessionId: 'session-cancel',
          cancellationToken: cts.token
        }
      );
    } catch (err: any) {
      if (err.name === 'CancellationError' || err.message.includes('cancelled')) {
        wasCancelled = true;
      } else {
        throw err;
      }
    }

    if (!wasCancelled) {
      throw new Error('Expected run to be aborted via cancellation token');
    }

    const state3 = await agent.getRunState(runId3);
    if (!state3 || state3.status !== 'cancelled' || state3.terminationReason !== 'user_cancelled') {
      throw new Error(`Expected state3 to be cancelled, got ${JSON.stringify(state3)}`);
    }
    console.log('✓ TEST 3 PASSED: Cancellation token aborted run and persisted state as "cancelled".\n');

    // ------------------------------------------------------------
    // TEST 4: Budget Enforcement (Tool Call Budget)
    // ------------------------------------------------------------
    console.log('--- TEST 4: Budget Enforcement (maxToolCalls = 0) ---');
    const runId4 = 'run-budget-4';
    const result4 = await agent.run(
      'Calculate 7 + 3 and then calculate 9 * 9',
      [],
      {
        runId: runId4,
        sessionId: 'session-budget',
        budget: { maxToolCalls: 0 } // strictly 0 tool calls permitted
      }
    );

    const state4 = await agent.getRunState(runId4);
    if (!state4 || state4.status !== 'failed' || state4.terminationReason !== 'budget_exceeded') {
      throw new Error(`Expected run4 to fail with budget_exceeded, got: ${JSON.stringify(state4)}`);
    }
    console.log(`Budget Alert output: "${result4}"`);
    console.log('✓ TEST 4 PASSED: Tool call budget strictly enforced.\n');

    // ------------------------------------------------------------
    // TEST 5: Idempotency Key De-duplication
    // ------------------------------------------------------------
    console.log('--- TEST 5: Idempotency Key Handling ---');
    const runId5 = 'run-idempotency-5';
    // Pre-seed an idempotency key into state
    const preSeededState = createInitialRunState({
      runId: runId5,
      sessionId: 'session-idempotency',
      task: 'Test idempotency replay'
    });
    preSeededState.idempotencyKeys.push('calculate:{"expression":"100 + 200"}');
    await memory.saveRunState(preSeededState);

    let idempotencySkipped = false;
    await agent.run(
      'Calculate 100 + 200',
      [],
      {
        runId: runId5,
        sessionId: 'session-idempotency',
        onUpdate: (status) => {
          if (status.message.includes('Idempotency') || status.message.includes('Idempotent Replay')) {
            idempotencySkipped = true;
          }
        }
      }
    );

    if (!idempotencySkipped) {
      throw new Error('Expected idempotency replay check to intercept identical tool call');
    }
    console.log('✓ TEST 5 PASSED: Idempotency key successfully detected and replayed.\n');

    // ------------------------------------------------------------
    // TEST 6: Run Resumption from SQLite
    // ------------------------------------------------------------
    console.log('--- TEST 6: Resuming Run from Persisted State ---');
    const runId6 = 'run-resume-6';
    const state6 = createInitialRunState({
      runId: runId6,
      sessionId: 'session-resume',
      task: 'Calculate 25 * 4',
      budget: { maxTurns: 5 }
    });
    state6.status = 'failed';
    state6.currentTurn = 1;
    await memory.saveRunState(state6);

    const resumedResult = await agent.resumeRun(runId6);
    const postResumeState = await agent.getRunState(runId6);

    if (!postResumeState || postResumeState.status !== 'completed') {
      throw new Error(`Expected resumed run to complete, got ${JSON.stringify(postResumeState)}`);
    }
    console.log(`Resumed Run Result: "${resumedResult}"`);
    console.log('✓ TEST 6 PASSED: Interrupted run successfully resumed and completed.\n');

    console.log('ALL PHASE 1 AGENT RUNTIME TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await memory.close();
    try {
      await fs.rm(testDbDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

runPhase1RuntimeTests().catch((err) => {
  console.error('Phase 1 tests failed:', err);
  process.exit(1);
});
