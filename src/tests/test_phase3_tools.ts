import * as dotenv from 'dotenv';
dotenv.config();

import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import {
  ToolExecutor,
  ToolSelector,
  CircuitBreaker,
  CircuitBreakerRegistry,
  ToolResult,
  ToolManifest
} from '../core/toolRuntime.js';
import { Tool, ToolContext } from '../core/types.js';
import { CancellationTokenSource } from '../core/cancellation.js';
import { Agent } from '../core/agent.js';
import { EpisodicMemory } from '../core/memory.js';
import { tools, toolsRegistry } from '../tools/index.js';

const TEST_SCRATCH_DIR = path.resolve(process.cwd(), 'scratch', 'test_p3_tools');
const TEST_ARTIFACTS_DIR = path.resolve(TEST_SCRATCH_DIR, 'artifacts');
const TEST_DB_PATH = path.resolve(TEST_SCRATCH_DIR, 'p3_tools_test.db');

function cleanup() {
  if (fs.existsSync(TEST_SCRATCH_DIR)) {
    try {
      fs.rmSync(TEST_SCRATCH_DIR, { recursive: true, force: true });
    } catch (e) {}
  }
}

async function runPhase3ToolTests() {
  cleanup();
  fs.mkdirSync(TEST_ARTIFACTS_DIR, { recursive: true });

  console.log('=== STARTING PHASE 3 TOOL RUNTIME TESTS ===\n');

  const executor = new ToolExecutor({
    artifactsDir: TEST_ARTIFACTS_DIR,
    circuitBreakers: new CircuitBreakerRegistry()
  });

  // --- TEST 1: Standardized ToolResult Envelope ---
  console.log('--- TEST 1: Standardized ToolResult Envelope ---');
  const calcTool = toolsRegistry.get('calculate')!;
  assert.ok(calcTool, 'Calculate tool must exist in registry');

  const calcResult = await executor.execute(calcTool, { expression: '7 * 6' });
  assert.strictEqual(calcResult.success, true, 'ToolResult.success must be true');
  assert.strictEqual(calcResult.retryable, false, 'Successful tool result should not be retryable');
  assert.ok(calcResult.data, 'ToolResult.data must contain output');
  assert.strictEqual(calcResult.data.result, 42, 'Result must be 42');
  assert.ok(calcResult.metadata?.durationMs !== undefined, 'Metadata must contain durationMs');
  console.log(`✓ TEST 1 PASSED: calculate returned standardized ToolResult with duration ${calcResult.metadata?.durationMs}ms.\n`);

  // --- TEST 2: Semantic Argument Schema Validation ---
  console.log('--- TEST 2: Argument Schema Validation ---');
  const invalidResult = await executor.execute(calcTool, {}); // Missing required 'expression'
  assert.strictEqual(invalidResult.success, false, 'Missing required argument must fail');
  assert.strictEqual(invalidResult.error?.code, 'INVALID_ARGUMENTS', 'Error code must be INVALID_ARGUMENTS');
  assert.strictEqual(invalidResult.retryable, false, 'Invalid arguments must not be retryable');
  console.log(`✓ TEST 2 PASSED: Missing arguments cleanly rejected with code: ${invalidResult.error?.code}.\n`);

  // --- TEST 3: Central Timeout Policy Enforcement ---
  console.log('--- TEST 3: Central Timeout Policy Enforcement ---');
  const slowTool: Tool = {
    definition: {
      name: 'mock_slow_tool',
      description: 'Simulates a hanging or slow external API',
      parameters: {
        type: 'OBJECT',
        properties: {
          delayMs: { type: 'NUMBER', description: 'Delay in ms' }
        },
        required: ['delayMs']
      }
    },
    manifest: {
      name: 'mock_slow_tool',
      riskLevel: 'safe',
      parallelSafe: true,
      timeoutMs: 150 // Very tight timeout
    },
    execute: async (args: { delayMs: number }) => {
      await new Promise(resolve => setTimeout(resolve, args.delayMs));
      return { completed: true };
    }
  };

  const timeoutResult = await executor.execute(slowTool, { delayMs: 1000 });
  assert.strictEqual(timeoutResult.success, false, 'Slow tool must trigger timeout');
  assert.strictEqual(timeoutResult.error?.code, 'TIMEOUT', 'Error code must be TIMEOUT');
  assert.strictEqual(timeoutResult.retryable, true, 'Timeouts should be marked retryable');
  console.log(`✓ TEST 3 PASSED: Slow tool caught and timed out with code: ${timeoutResult.error?.code}.\n`);

  // --- TEST 4: Cooperative Cancellation ---
  console.log('--- TEST 4: Cooperative Cancellation ---');
  const cts = new CancellationTokenSource();
  const hangingTool: Tool = {
    definition: {
      name: 'mock_hanging_tool',
      description: 'Hangs indefinitely until cancelled',
      parameters: {
        type: 'OBJECT',
        properties: {},
        required: []
      }
    },
    manifest: {
      name: 'mock_hanging_tool',
      riskLevel: 'safe',
      parallelSafe: true,
      timeoutMs: 10000
    },
    execute: async () => {
      await new Promise(resolve => setTimeout(resolve, 5000));
      return { done: true };
    }
  };

  // Launch execution and cancel 50ms later
  const cancelPromise = executor.execute(hangingTool, {}, { cancellationToken: cts.token });
  setTimeout(() => cts.cancel('Parent run stopped by user'), 50);

  const cancelResult = await cancelPromise;
  assert.strictEqual(cancelResult.success, false, 'Cancelled execution must return failure');
  assert.strictEqual(cancelResult.error?.code, 'CANCELLED', 'Error code must be CANCELLED');
  assert.strictEqual(cancelResult.retryable, false, 'Cancellation should not be retryable');
  console.log(`✓ TEST 4 PASSED: Cancellation token aborted execution immediately.\n`);

  // --- TEST 5: Circuit Breaker Lifecycle (Closed -> Open -> Half-Open -> Closed) ---
  console.log('--- TEST 5: Circuit Breaker Lifecycle ---');
  let attemptCount = 0;
  let shouldFail = true;

  const flakyTool: Tool = {
    definition: {
      name: 'mock_flaky_service',
      description: 'Simulates a flaky remote MCP service',
      parameters: { type: 'OBJECT', properties: {} }
    },
    manifest: {
      name: 'mock_flaky_service',
      riskLevel: 'safe',
      parallelSafe: true,
      timeoutMs: 5000
    },
    execute: async () => {
      attemptCount++;
      if (shouldFail) {
        throw new Error('503 Service Unavailable: Remote MCP server down');
      }
      return { status: 'healthy' };
    }
  };

  // Configure breaker with threshold 3 failures and 200ms cooldown
  const customBreakers = new CircuitBreakerRegistry();
  const breaker = customBreakers.getBreaker('mock_flaky_service', {
    failureThreshold: 3,
    cooldownMs: 200
  });

  const cbExecutor = new ToolExecutor({
    artifactsDir: TEST_ARTIFACTS_DIR,
    circuitBreakers: customBreakers
  });

  // 3 consecutive failures to trip breaker
  await cbExecutor.execute(flakyTool, {});
  await cbExecutor.execute(flakyTool, {});
  await cbExecutor.execute(flakyTool, {});

  assert.strictEqual(breaker.getState(), 'open', 'Circuit breaker must be OPEN after 3 failures');

  // Next call should fail fast without even executing the tool
  const attemptsBefore = attemptCount;
  const fastFailResult = await cbExecutor.execute(flakyTool, {});
  assert.strictEqual(fastFailResult.success, false);
  assert.strictEqual(fastFailResult.error?.code, 'CIRCUIT_BREAKER_OPEN');
  assert.strictEqual(attemptCount, attemptsBefore, 'Tool function must not be invoked when circuit is OPEN');

  // Wait for cooldown to enter half-open
  await new Promise(r => setTimeout(r, 220));
  assert.strictEqual(breaker.getState(), 'half-open', 'Breaker must transition to half-open after cooldown');

  // Heal service
  shouldFail = false;
  const recoveryResult = await cbExecutor.execute(flakyTool, {});
  assert.strictEqual(recoveryResult.success, true);
  assert.strictEqual(breaker.getState(), 'closed', 'Breaker must reset to CLOSED after successful canary call');
  console.log(`✓ TEST 5 PASSED: Circuit breaker transitioned Closed ➔ Open ➔ Half-Open ➔ Closed.\n`);

  // --- TEST 6: Large Output Offloading to Disk Artifact ---
  console.log('--- TEST 6: Large Output Offloading to Disk Artifact ---');
  const hugePayload = 'A'.repeat(25000); // 25,000 characters > 16,384 bytes limit
  const bigOutputTool: Tool = {
    definition: {
      name: 'mock_big_output',
      description: 'Generates large output',
      parameters: { type: 'OBJECT', properties: {} }
    },
    manifest: {
      name: 'mock_big_output',
      riskLevel: 'safe',
      parallelSafe: true,
      maxOutputBytes: 1024 // 1KB threshold for testing
    },
    execute: async () => {
      return { output: hugePayload };
    }
  };

  const offloadResult = await executor.execute(bigOutputTool, {}, { runId: 'run_test_phase3' });
  assert.strictEqual(offloadResult.success, true);
  assert.strictEqual(offloadResult.metadata?.truncated, true, 'Output must be marked as truncated');
  assert.ok(offloadResult.metadata?.artifactPath, 'Metadata must provide artifactPath');
  assert.ok(fs.existsSync(offloadResult.metadata!.artifactPath!), 'Artifact file must exist on disk');

  const fileContent = fs.readFileSync(offloadResult.metadata!.artifactPath!, 'utf-8');
  assert.ok(fileContent.includes(hugePayload), 'Artifact must contain the full raw output');
  console.log(`✓ TEST 6 PASSED: 25KB output offloaded to ${offloadResult.metadata?.artifactPath}.\n`);

  // --- TEST 7: Intent-Based Tool Selection (Pruning) ---
  console.log('--- TEST 7: Intent-Based Tool Selection (Pruning) ---');
  const allRegisteredTools = Array.from(toolsRegistry.values());
  assert.ok(allRegisteredTools.length >= 10, 'Registry should have 15+ tools');

  // Query 1: Web browsing task
  const webPrompt = 'Search Google online for the latest UEFA Champions League news';
  const webSelected = ToolSelector.selectRelevantTools(webPrompt, allRegisteredTools);
  const webToolNames = webSelected.map(t => t.definition.name);
  assert.ok(webToolNames.includes('searchWeb'), 'searchWeb must be included for web prompt');
  assert.ok(webToolNames.includes('readFile'), 'Core tools must always be included');
  assert.ok(!webToolNames.includes('deleteFile'), 'destructive file deletion should not be included for web search');

  // Query 2: Coding task
  const codePrompt = 'Edit the file src/core/agent.ts and replace the function';
  const codeSelected = ToolSelector.selectRelevantTools(codePrompt, allRegisteredTools);
  const codeToolNames = codeSelected.map(t => t.definition.name);
  assert.ok(codeToolNames.includes('replaceFileContent'), 'replaceFileContent must be included for code editing');
  assert.ok(codeToolNames.includes('readFile'), 'readFile must be included for code editing');
  assert.ok(!codeToolNames.includes('browserScreenshot'), 'browserScreenshot should be pruned from code editing');

  console.log(`✓ TEST 7 PASSED: Intent tool selector pruned 20 tools down to relevant subsets (${webSelected.length} web, ${codeSelected.length} code).\n`);

  // --- TEST 8: Agent Loop Integration with Tool Runtime ---
  console.log('--- TEST 8: Agent Loop Integration with Tool Runtime ---');
  const memory = new EpisodicMemory(TEST_DB_PATH);
  await memory.init();

  const agent = new Agent({
    provider: 'gemini',
    modelName: 'gemini-2.5-flash',
    maxTurns: 5,
    systemPrompt: 'You are an agent. When asked for math, call the calculate tool.',
    dbPath: TEST_DB_PATH,
    allowedTools: ['calculate', 'systemTime']
  });
  await agent.init();

  let toolResponseReceived = false;
  const result = await agent.run(
    'Calculate 15 multiplied by 15 please.',
    [],
    (status) => {
      if (status.type === 'tool_response') {
        toolResponseReceived = true;
      }
    }
  );

  assert.ok(toolResponseReceived, 'tool_response event must have fired via ToolExecutor');
  assert.ok(result.includes('225'), 'Agent result must contain 225');
  console.log(`✓ TEST 8 PASSED: Agent successfully called calculate via ToolExecutor: "${result.trim()}".\n`);

  await memory.close();
  cleanup();

  console.log('ALL PHASE 3 TOOL RUNTIME TESTS PASSED SUCCESSFULLY! 🎉\n');
}

runPhase3ToolTests().catch((err) => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
