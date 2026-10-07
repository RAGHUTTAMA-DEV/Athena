import * as dotenv from 'dotenv';
dotenv.config();

import { delegateCodingTaskTool } from '../tools/delegateCodingTask.js';
import { Agent } from '../runtime/agent.js';
import { DEFAULT_AGENT_PROMPT } from '../prompts/index.js';
import * as fs from 'fs/promises';
import * as path from 'path';

async function runTests() {
  console.log('=== STARTING CODING SUB-AGENT INTEGRATION TESTS ===\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY is not defined in the environment variables.');
    process.exit(1);
  }

  const testDir = path.join(process.cwd(), 'scratch', 'harness_test_run');
  console.log(`Target CWD for harness: ${testDir}`);

  // Create clean directory
  await fs.mkdir(testDir, { recursive: true });

  // ----------------------------------------------------
  // TEST 1: Direct Tool Execution
  // ----------------------------------------------------
  console.log('\n--- TEST 1: Direct Tool Execution ---');
  const tempFile = path.join(testDir, 'temp_harness_test.txt');
  
  // Clean up any old test file
  try {
    await fs.unlink(tempFile);
  } catch (e) {}

  // Pre-initialize .todo.md for Test 1
  await fs.writeFile(
    path.join(testDir, '.todo.md'),
    '- [ ] Create a file named temp_harness_test.txt containing "Hello Harness!" in the current directory.'
  );

  const toolResult = await delegateCodingTaskTool.execute({
    task: 'Create a file named temp_harness_test.txt containing "Hello Harness!" in the current directory. Update .todo.md when done.',
    cwd: testDir
  }, {
    parentRunId: 'direct-test-trace-id',
    onUpdate: (status) => console.log(`[Tool Progress] ${status.message}`)
  });



  console.log('Tool execution response:', JSON.stringify(toolResult, null, 2));

  // Verify file creation and content
  try {
    const content = await fs.readFile(tempFile, 'utf-8');
    console.log(`Verified file content: "${content}"`);
    if (content.trim() !== 'Hello Harness!') {
      throw new Error(`File content mismatch. Expected "Hello Harness!", got "${content}"`);
    }
    console.log('✓ File created and verified successfully!');
  } catch (err: any) {
    console.error(`❌ Verification failed: ${err.message}`);
    throw err;
  } finally {
    try {
      await fs.unlink(tempFile);
      console.log('Temporary test file cleaned up.');
    } catch (e) {}
  }

  // ----------------------------------------------------
  // TEST 2: Agent Loop Delegation (End-to-End)
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Agent Loop Delegation (End-to-End) ---');
  const dbPath = './verify_coding_subagent.db';
  const e2eFile = path.join(testDir, 'e2e_harness_test.txt');

  // Clean up
  try {
    await fs.unlink(dbPath);
  } catch (e) {}
  try {
    await fs.unlink(e2eFile);
  } catch (e) {}

  // Pre-initialize .todo.md for Test 2
  await fs.writeFile(
    path.join(testDir, '.todo.md'),
    '- [ ] Create a file named e2e_harness_test.txt containing "E2E works!" in the current directory.'
  );

  const agent = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
    systemPrompt: DEFAULT_AGENT_PROMPT,
    soulPath: './SOUL.md',
    dbPath
  });

  await agent.init();

  const mockConfirm = async (toolName: string, args: any): Promise<boolean> => {
    console.log(`[MOCK CONFIRM] Auto-approving tool "${toolName}" with args: ${JSON.stringify(args)}`);
    return true;
  };

  const prompt = `Please create a temporary file named e2e_harness_test.txt with the contents "E2E works!" in the directory ${testDir}. Use the dedicated coding sub-agent for this. Update .todo.md when done.`;




  try {
    const finalAnswer = await agent.run(
      prompt,
      [],
      (status) => {
        console.log(`[Agent: ${status.type}] ${status.message}`);
      },
      mockConfirm,
      'e2e_session'
    );

    console.log(`\nFinal Agent Answer: "${finalAnswer}"`);

    // Verify e2eFile creation
    const content = await fs.readFile(e2eFile, 'utf-8');
    console.log(`E2E file content read: "${content}"`);
    if (content.trim() !== 'E2E works!') {
      throw new Error(`E2E File content mismatch. Expected "E2E works!", got "${content}"`);
    }
    console.log('✓ E2E Loop verified successfully!');
  } catch (err: any) {
    console.error(`❌ E2E Loop test failed: ${err.message}`);
    throw err;
  } finally {
    // Clean up database and E2E files
    await (agent as any).memory?.close();
    try {
      await fs.unlink(dbPath);
    } catch (e) {}
    try {
      await fs.unlink(e2eFile);
    } catch (e) {}
    try {
      await fs.rmdir(testDir);
      console.log('Cleaned up test directory.');
    } catch (e) {}
  }

  console.log('\nALL INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉');
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  process.exit(1);
});
