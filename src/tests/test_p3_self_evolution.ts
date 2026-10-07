import { Scheduler } from '../background/scheduler.js';
import { EpisodicMemory } from '../memory/memory.js';
import { cronjobTool } from '../tools/cronjob.js';
import * as fs from 'fs/promises';
import * as path from 'path';

async function runP3SelfEvolutionTests() {
  console.log('=== STARTING P3 SELF-EVOLUTION TESTS ===\n');

  const testDbPath = path.resolve('./scratch/test_p3_state.db');
  await fs.mkdir(path.dirname(testDbPath), { recursive: true });

  const memory = new EpisodicMemory(testDbPath);
  await memory.init();

  const scheduler = Scheduler.getInstance();
  scheduler.setMemory(memory);

  let triggeredPrompt = '';
  scheduler.setRunner(async (prompt: string, sessionId: string) => {
    triggeredPrompt = prompt;
    return `Executed: ${prompt}`;
  });

  try {
    // --- TEST 1: One-Shot Timer via cronjobTool ---
    console.log('--- TEST 1: Schedule one-shot timer via cronjobTool ---');
    const createResult = await cronjobTool.execute({
      action: 'create',
      prompt: 'Check server status',
      delaySeconds: 1 // 1 second delay
    }, { parentRunId: 'test_session' });

    if (!createResult.success) throw new Error(`cronjobTool failed: ${createResult.error}`);
    console.log('Created one-shot job:', createResult.job);
    if (createResult.job.type !== 'one-shot') {
      throw new Error(`Expected type "one-shot", got "${createResult.job.type}"`);
    }

    const initialJobs = await scheduler.listJobs();
    if (initialJobs.length !== 1) {
      throw new Error(`Expected 1 job in database, found ${initialJobs.length}`);
    }
    console.log('✓ TEST 1 PASSED: One-shot job registered in database.\n');

    // --- TEST 2: Scheduler Tick triggers one-shot job & cleans up ---
    console.log('--- TEST 2: Scheduler tick execution & automatic cleanup ---');
    // Wait 1.2s to exceed delaySeconds
    await new Promise(r => setTimeout(r, 1200));

    await scheduler.tick();

    // Check runner was triggered
    if (triggeredPrompt !== 'Check server status') {
      throw new Error(`Expected triggeredPrompt to be "Check server status", got "${triggeredPrompt}"`);
    }

    // Verify one-shot job was cleaned up from active list
    const remainingJobs = await scheduler.listJobs();
    if (remainingJobs.length !== 0) {
      throw new Error(`Expected one-shot job to be cleaned up from database, but ${remainingJobs.length} remain.`);
    }
    console.log('✓ TEST 2 PASSED: One-shot job triggered and automatically cleaned up.\n');

    console.log('ALL P3 SELF-EVOLUTION TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await memory.close();
    try {
      await fs.unlink(testDbPath);
    } catch (e) {}
  }
}

runP3SelfEvolutionTests().catch((err) => {
  console.error('P3 tests failed:', err);
  process.exit(1);
});
