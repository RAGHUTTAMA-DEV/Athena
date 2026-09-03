import '../core/dnsFix.js';

import * as dotenv from 'dotenv';
dotenv.config();

import { Agent } from '../core/agent.js';
import { Message } from '../core/types.js';
import { DEFAULT_AGENT_PROMPT } from '../prompts/index.js';
import * as fs from 'fs/promises';

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  fgRed: '\x1b[31m',
  fgGreen: '\x1b[32m',
  fgYellow: '\x1b[33m',
  fgBlue: '\x1b[34m',
  fgCyan: '\x1b[36m',
  fgWhite: '\x1b[37m',
};

function log(color: string, prefix: string, message: string) {
  console.log(`${COLORS.bright}${color}[${prefix}]${COLORS.reset} ${message}`);
}

const mockConfirm = async (toolName: string, args: any): Promise<boolean> => {
  log(COLORS.fgYellow, 'MOCK CONFIRM', `Automatically approving execution of "${toolName}" with args: ${JSON.stringify(args)}`);
  return true;
};

async function testPrompt(agent: Agent, prompt: string, sessionId?: string) {
  console.log('\n' + '-'.repeat(40));
  console.log(`${COLORS.bright}${COLORS.fgCyan}Testing Prompt:${COLORS.reset} "${prompt}"`);
  console.log('-'.repeat(40));
  
  const history: Message[] = [];
  try {
    const finalAnswer = await agent.run(
      prompt,
      history,
      (status) => {
        switch (status.type) {
          case 'thought':
            log(COLORS.fgBlue, 'THOUGHT', status.message);
            break;
          case 'memory':
            log(COLORS.fgCyan, 'MEMORY', status.message);
            break;
          case 'tool_call':
            log(COLORS.fgYellow, 'TOOL CALL', status.message);
            break;
          case 'tool_response':
            log(COLORS.fgGreen, 'TOOL RESPONSE', status.message);
            break;
          case 'error':
            log(COLORS.fgRed, 'WARNING', status.message);
            break;
        }
      },
      mockConfirm,
      sessionId
    );
    console.log(`\n${COLORS.bright}${COLORS.fgGreen}Final Answer:${COLORS.reset} ${finalAnswer}\n`);
  } catch (err: any) {
    log(COLORS.fgRed, 'ERROR', `Failed to run prompt: ${err.message}`);
  }
}

async function main() {
  const dbPath = './verify_state.db';
  try {
    await fs.unlink(dbPath);
  } catch (e) {}

  const agent = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
    systemPrompt: DEFAULT_AGENT_PROMPT,
    soulPath: './SOUL.md',
    dbPath
  });

  await agent.init();

  // Test 1: Math calculation tool
  await testPrompt(agent, 'What is (45 * 2) + 15?', 'verify_session');

  // Test 2: System time tool
  await testPrompt(agent, 'What time is it currently?', 'verify_session');

  // Test 3: Read file tool
  await testPrompt(agent, 'Read the file SOUL.md and summarize who you are in one sentence.', 'verify_session');

  // Test 4: Terminal command execution tool (risky)
  await testPrompt(agent, 'Run the shell command "echo Hello from Athena Terminal Test"', 'verify_session');

  // Test 4b: Open File Explorer command test
  await testPrompt(agent, 'Open the Windows File Explorer at C:\\Users\\raghu\\Desktop using terminal command.', 'verify_session');

  // Test 5: Filesystem write and delete tools (risky)
  await testPrompt(agent, 'Write the text "Test content" to a file named verify_temp.txt, then read the file, and then delete it.', 'verify_session');

  // Test 6: Browser navigation tool
  await testPrompt(agent, 'Browse the page https://example.com and tell me its main heading.', 'verify_session');

  // Test 7: Web search tool
  await testPrompt(agent, 'Search the web for "Kylian Mbappe statistics 2025 2026" and return top results.', 'verify_session');

  // Test 8: Guardrail test with maxTurns = 1
  console.log('\n' + '-'.repeat(40));
  console.log(`${COLORS.bright}${COLORS.fgCyan}Testing Guardrail (maxTurns = 1)${COLORS.reset}`);
  console.log('-'.repeat(40));
  const restrictedAgent = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: 1,
    systemPrompt: 'You are Athena, a local agent. Use your tools when asked.',
    soulPath: './SOUL.md',
    dbPath
  });
  await restrictedAgent.init();
  await testPrompt(restrictedAgent, 'Calculate (45 * 2) + 15', 'verify_session');

  // Test 9: Persistent episodic memory test
  console.log('\n' + '-'.repeat(40));
  console.log(`${COLORS.bright}${COLORS.fgCyan}Testing Episodic Memory Persistence${COLORS.reset}`);
  console.log('-'.repeat(40));

  // Initialize first agent session and save a secret
  const agent1 = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
    systemPrompt: DEFAULT_AGENT_PROMPT,
    soulPath: './SOUL.md',
    dbPath
  });
  await agent1.init();
  await testPrompt(agent1, 'Tell me a secret, say "My secret word is BLUEBERRY".', 'verify_persistence');

  // Close database connection
  await (agent1 as any).memory?.close();

  // Create a brand new agent instance pointing to the same DB and ask what the secret word was
  const agent2 = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
    systemPrompt: DEFAULT_AGENT_PROMPT,
    soulPath: './SOUL.md',
    dbPath
  });
  await agent2.init();
  await testPrompt(agent2, 'What was the secret word I told you?', 'verify_persistence');
  
  // Close database connection
  await (agent2 as any).memory?.close();

  // Clean up verification database file
  try {
    await fs.unlink(dbPath);
  } catch (e) {}
}

main().catch(err => {
  console.error('Fatal test execution error:', err);
  process.exit(1);
});
