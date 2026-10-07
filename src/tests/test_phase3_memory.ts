import * as dotenv from 'dotenv';
dotenv.config();

import { EpisodicMemory } from '../memory/memory.js';
import { ProceduralMemory } from '../memory/procedural.js';
import { Agent } from '../runtime/agent.js';
import { Message } from '../runtime/types.js';
import * as fs from 'fs/promises';
import * as path from 'path';

const DB_PATH = './test_phase3.db';
const SKILLS_DIR = './test_skills';

async function cleanup() {
  try {
    await fs.unlink(DB_PATH);
  } catch (e) {}
  try {
    await fs.rm(SKILLS_DIR, { recursive: true, force: true });
  } catch (e) {}
}

async function runTests() {
  console.log('=== STARTING PHASE 3 MEMORY TESTS ===\n');
  await cleanup();

  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY is not defined in the environment variables. Skipping embedding tests.');
    process.exit(1);
  }

  // ----------------------------------------------------
  // TEST 1: Semantic Memory Store and similarity search
  // ----------------------------------------------------
  console.log('--- TEST 1: Semantic Memory (RAG) ---');
  const memory = new EpisodicMemory(DB_PATH);
  await memory.init();
  console.log('Database initialized.');

  console.log('Saving semantic facts...');
  const factId1 = await memory.saveSemanticFact('The database server is running on port 5432', ['database', 'config']);
  const factId2 = await memory.saveSemanticFact("The user's name is Raghu and he prefers TypeScript for development", ['user', 'profile']);
  console.log(`Saved fact 1 (ID: ${factId1}) and fact 2 (ID: ${factId2}).`);

  console.log('Searching for database port...');
  const results1 = await memory.searchSemanticFacts('What port is the database on?', 2, 0.6);
  console.log('Results:', JSON.stringify(results1, null, 2));
  if (results1.length === 0 || !results1[0].fact.includes('5432')) {
    throw new Error('Test 1 failed: Could not find database port fact.');
  }
  console.log('✓ Found database port successfully.');

  console.log('Searching for user preference...');
  const results2 = await memory.searchSemanticFacts('What language does the developer use?', 2, 0.6);
  console.log('Results:', JSON.stringify(results2, null, 2));
  if (results2.length === 0 || !results2[0].fact.includes('TypeScript')) {
    throw new Error('Test 1 failed: Could not find user preference fact.');
  }
  console.log('✓ Found user preference successfully.');

  // ----------------------------------------------------
  // TEST 2: Procedural Memory (Skills) keyword search
  // ----------------------------------------------------
  console.log('\n--- TEST 2: Procedural Memory (Skills) ---');
  await fs.mkdir(SKILLS_DIR, { recursive: true });
  
  const skillFileContent = `---
name: "Git Standard Commits"
description: "Instructions on how to write standard commits for project"
tags: ["git", "commits"]
---
Always start messages with semantic prefixes:
- feat: New feature
- fix: Bug fix
- docs: Documentation changes
`;

  const skillPath = path.join(SKILLS_DIR, 'git_commits.md');
  await fs.writeFile(skillPath, skillFileContent, 'utf-8');
  console.log(`Created test skill file at ${skillPath}`);

  const procedural = new ProceduralMemory(SKILLS_DIR);
  const skills = await procedural.loadAllSkills();
  console.log(`Loaded ${skills.length} skill(s).`);
  if (skills.length === 0 || skills[0].name !== 'Git Standard Commits') {
    throw new Error('Test 2 failed: Skill was not loaded correctly.');
  }

  console.log('Searching skills with keyword "git commit"...');
  const matchedSkills = await procedural.searchSkills('how do I do git commits?', 2);
  console.log('Matched skills:', JSON.stringify(matchedSkills.map(s => ({ name: s.name, tags: s.tags })), null, 2));
  if (matchedSkills.length === 0 || matchedSkills[0].name !== 'Git Standard Commits') {
    throw new Error('Test 2 failed: Keyword matching failed to return Git skill.');
  }
  console.log('✓ Matched Git skill successfully.');

  // ----------------------------------------------------
  // TEST 3: Agent Integration and Update Callback
  // ----------------------------------------------------
  console.log('\n--- TEST 3: Agent Integration ---');
  const agent = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
    systemPrompt: 'You are a test agent. Answer using facts and skills if provided.',
    dbPath: DB_PATH,
    skillsPath: SKILLS_DIR
  });

  await agent.init();
  console.log('Agent initialized.');

  let memoryStatusMessage = '';
  const history: Message[] = [];

  const finalResponse = await agent.run(
    'Please tell me standard prefix for a new feature in git commits.',
    history,
    (status) => {
      if (status.type === 'memory') {
        console.log('[LOG] Memory update received:', status.message);
        memoryStatusMessage = status.message;
      }
    }
  );

  console.log(`Agent response: "${finalResponse}"`);
  
  if (!memoryStatusMessage) {
    throw new Error('Test 3 failed: Memory callback was never triggered.');
  }
  if (!memoryStatusMessage.includes('Procedural: matched 1 skills')) {
    throw new Error('Test 3 failed: Git skill was not matched in Agent.run.');
  }
  if (!finalResponse.toLowerCase().includes('feat')) {
    throw new Error('Test 3 failed: Agent response did not use instructions from procedural skill.');
  }
  console.log('✓ Agent used procedural skill and triggered status callback successfully!');

  // Close database connections
  await memory.close();
  await (agent as any).memory?.close();

  await cleanup();
  console.log('\nALL PHASE 3 MEMORY TESTS PASSED SUCCESSFULY! 🎉');
}

runTests().catch(err => {
  console.error('\n❌ TEST RUN FAILED:', err);
  cleanup().then(() => process.exit(1));
});
