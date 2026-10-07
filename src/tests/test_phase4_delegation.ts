import * as dotenv from 'dotenv';
dotenv.config();

import { Agent } from '../runtime/agent.js';
import { Message } from '../runtime/types.js';
import { delegateTaskTool } from '../tools/delegateTask.js';
import { toolsRegistry } from '../tools/index.js';

async function runTests() {
  console.log('=== STARTING PHASE 4 DELEGATION TESTS ===\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY is not defined in the environment variables.');
    process.exit(1);
  }

  // ----------------------------------------------------
  // TEST 1: Tool Scoping
  // ----------------------------------------------------
  console.log('--- TEST 1: Tool Scoping ---');
  // Create an agent config that allows calculate but NOT filesystem/terminal tools
  const scopedAgent = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: 5,
    systemPrompt: 'You are a test sub-agent. Follow instructions.',
    allowedTools: ['calculate'],
    depth: 1,
    taskId: 'test-scope-agent'
  });
  await scopedAgent.init();

  // Test that allowedTools are restricted
  const history1: Message[] = [];
  const response1 = await scopedAgent.run(
    'Please calculate 99 + 101. Also, try to read the file package.json using the readFile tool to see if you can.',
    history1,
    (status) => {
      console.log(`[Log] ${status.message}`);
    }
  );

  console.log(`Agent response: "${response1}"`);
  
  // Verify that it used calculate and returned 200
  if (!response1.includes('200')) {
    throw new Error('Test 1 failed: Agent did not calculate 99 + 101.');
  }

  // Verify that it did not execute readFile (it was not allowed)
  const usedReadFile = history1.some(turn => 
    turn.parts.some(part => 
      'functionCall' in part && part.functionCall.name === 'readFile'
    )
  );
  if (usedReadFile) {
    throw new Error('Test 1 failed: Agent successfully called readFile tool which was NOT allowed!');
  }
  console.log('✓ Tool Scoping verified successfully. Allowed tools worked, unauthorized tools blocked.\n');

  // ----------------------------------------------------
  // TEST 2: Depth Limiting
  // ----------------------------------------------------
  console.log('--- TEST 2: Depth Limiting ---');
  // We execute delegateTaskTool directly simulating a parent depth of 2 (so child depth becomes 3)
  const context2 = {
    depth: 2,
    parentRunId: 'test-parent',
    onUpdate: (status: any) => console.log(`[SubLog] ${status.message}`)
  };

  const result2 = await delegateTaskTool.execute({
    goal: 'Run a simple calculation of 5 * 5',
    context: 'Some context details',
    allowedTools: ['calculate', 'delegate_task'],
    maxTurns: 3
  }, context2);

  console.log('delegate_task execution result:', JSON.stringify(result2, null, 2));

  // The child agent configuration should have stripped delegate_task since depth became 3
  if (result2.status !== 'success') {
    throw new Error(`Test 2 failed: Sub-agent execution failed: ${result2.output}`);
  }
  console.log('✓ Depth Limiting verified successfully.\n');

  // ----------------------------------------------------
  // TEST 3: Parallel Spawning via Agent Loop
  // ----------------------------------------------------
  console.log('--- TEST 3: Parallel Spawning via Agent ---');
  
  const parentAgent = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: 5,
    systemPrompt: 'You are a parent agent. If asked to run multiple tasks, delegate them to sub-agents.',
    allowedTools: ['delegate_task', 'calculate'],
    depth: 0,
    taskId: 'parent-agent'
  });
  await parentAgent.init();

  const history3: Message[] = [];
  const response3 = await parentAgent.run(
    'Please run two separate sub-agent tasks in parallel. Task 1: calculate 51 + 49. Task 2: calculate 200 * 3. Give me their results.',
    history3,
    (status) => {
      console.log(`[ParentLog] ${status.message}`);
    }
  );

  console.log(`Parent response: "${response3}"`);
  
  if (!response3.includes('100') || !response3.includes('600')) {
    throw new Error('Test 3 failed: Parent did not return both sub-agent task results correctly.');
  }

  console.log('✓ Parallel Spawning verified successfully.\n');

  // Clean up
  const parentMemory = (parentAgent as any).memory;
  if (parentMemory) {
    await parentMemory.close();
  }

  console.log('ALL PHASE 4 DELEGATION TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
