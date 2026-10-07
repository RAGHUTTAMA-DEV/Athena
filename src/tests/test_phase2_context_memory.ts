import * as dotenv from 'dotenv';
dotenv.config();

import { EpisodicMemory } from '../memory/memory.js';
import { ContextEngine } from '../memory/contextEngine.js';
import { ProceduralMemory } from '../memory/procedural.js';
import { Message } from '../runtime/types.js';
import * as path from 'path';
import * as fs from 'fs/promises';

async function runPhase2ContextMemoryTests() {
  console.log('=== STARTING PHASE 2 CONTEXT + MEMORY TESTS ===\n');

  const testDbDir = path.resolve(process.cwd(), 'scratch/test_phase2_context_memory');
  await fs.mkdir(testDbDir, { recursive: true });
  const testDbPath = path.join(testDbDir, `context_memory_test_${Date.now()}.db`);

  const memory = new EpisodicMemory(testDbPath);
  await memory.init();

  try {
    // ------------------------------------------------------------
    // TEST 1: Scoped Memory Multi-Scope CRUD
    // ------------------------------------------------------------
    console.log('--- TEST 1: Multi-Scope Memory Isolation ---');
    const globalId = await memory.saveScopedMemory({
      scope: 'global',
      fact: 'User prefers dark mode and concise responses.',
      tags: ['ui', 'preference'],
      confidence: 1.0,
      provenance: { source: 'user_input', timestamp: Date.now() }
    });

    const projectId = await memory.saveScopedMemory({
      scope: 'project',
      fact: 'Athena agent is built with Node.js and TypeScript.',
      tags: ['stack', 'typescript'],
      confidence: 0.95,
      provenance: { source: 'agent_reflection', timestamp: Date.now(), evidence: 'package.json dependencies' }
    });

    const sessionId = await memory.saveScopedMemory({
      scope: 'session',
      fact: 'In this session, user is testing Phase 2 memory features.',
      confidence: 0.85,
      provenance: { source: 'user_input', timestamp: Date.now(), sessionId: 'test-session-1' }
    });

    // Query scoped to project
    const projectFacts = await memory.searchScopedMemory({
      query: 'TypeScript Node.js',
      scope: 'project'
    });

    if (projectFacts.length === 0 || projectFacts[0].scope !== 'project') {
      throw new Error(`Expected project scope fact, got: ${JSON.stringify(projectFacts)}`);
    }

    // Query scoped to global
    const globalFacts = await memory.searchScopedMemory({
      query: 'dark mode',
      scope: 'global'
    });

    if (globalFacts.length === 0 || globalFacts[0].scope !== 'global') {
      throw new Error(`Expected global scope fact, got: ${JSON.stringify(globalFacts)}`);
    }

    console.log(`✓ TEST 1 PASSED: Multi-scope facts isolated across global and project scopes.\n`);

    // ------------------------------------------------------------
    // TEST 2: Provenance & Evidence Verification
    // ------------------------------------------------------------
    console.log('--- TEST 2: Memory Provenance & Evidence ---');
    const retrievedProjectFact = await memory.getScopedMemory(projectId);
    if (!retrievedProjectFact) throw new Error('Failed to retrieve project fact by ID');

    if (retrievedProjectFact.provenance.source !== 'agent_reflection' ||
        retrievedProjectFact.provenance.evidence !== 'package.json dependencies') {
      throw new Error(`Provenance mismatch: ${JSON.stringify(retrievedProjectFact.provenance)}`);
    }
    console.log(`✓ TEST 2 PASSED: Provenance source and evidence accurately persisted.\n`);

    // ------------------------------------------------------------
    // TEST 3: Confidence Calibration & Reinforcement
    // ------------------------------------------------------------
    console.log('--- TEST 3: Confidence Calibration & Reinforcement ---');
    const factId3 = await memory.saveScopedMemory({
      scope: 'user',
      fact: 'User lives in Bengaluru, India.',
      confidence: 0.75,
      provenance: { source: 'user_input', timestamp: Date.now() }
    });

    // Reinforce fact confidence
    await memory.reinforceMemory(factId3, 0.20);
    const reinforced = await memory.getScopedMemory(factId3);

    if (!reinforced || reinforced.confidence < 0.94 || reinforced.lifecycle !== 'confirmed') {
      throw new Error(`Expected reinforced confidence ~0.95 and confirmed lifecycle, got: ${JSON.stringify(reinforced)}`);
    }
    console.log(`Calibrated confidence: ${reinforced.confidence} (Lifecycle: ${reinforced.lifecycle})`);
    console.log(`✓ TEST 3 PASSED: Confidence reinforced and lifecycle transitioned to confirmed.\n`);

    // ------------------------------------------------------------
    // TEST 4: Contradiction Resolution & Superseding
    // ------------------------------------------------------------
    console.log('--- TEST 4: Contradiction Resolution & Superseding ---');
    // User updates their location
    const newFactId = await memory.resolveContradiction(
      factId3,
      'User recently relocated to San Francisco, California.',
      {
        source: 'user_input',
        timestamp: Date.now(),
        evidence: 'User said: "I moved to SF last week"'
      }
    );

    const oldFact = await memory.getScopedMemory(factId3);
    const newFact = await memory.getScopedMemory(newFactId);

    if (oldFact?.lifecycle !== 'superseded' || oldFact.supersededBy !== newFactId) {
      throw new Error(`Old fact not marked superseded: ${JSON.stringify(oldFact)}`);
    }
    if (newFact?.lifecycle !== 'active' || newFact.confidence !== 1.0) {
      throw new Error(`New fact not active with 1.0 confidence: ${JSON.stringify(newFact)}`);
    }
    console.log(`Old fact #${factId3} supersededBy: #${oldFact.supersededBy}`);
    console.log(`New fact #${newFactId}: "${newFact.fact}"`);
    console.log(`✓ TEST 4 PASSED: Contradiction cleanly resolved and linked via superseding.\n`);

    // ------------------------------------------------------------
    // TEST 5: User Memory Controls (Inspect, Forget, Purge)
    // ------------------------------------------------------------
    console.log('--- TEST 5: User Memory Controls (Inspect, Forget, Purge) ---');
    const inspected = await memory.inspectMemory('San Francisco');
    if (inspected.length === 0 || inspected[0].id !== newFactId) {
      throw new Error(`Inspect failed to find active SF fact: ${JSON.stringify(inspected)}`);
    }

    // Forget fact
    await memory.deleteScopedMemory(newFactId);
    const forgotten = await memory.getScopedMemory(newFactId);
    if (forgotten?.lifecycle !== 'deleted') {
      throw new Error(`Expected fact to be marked deleted, got: ${JSON.stringify(forgotten)}`);
    }

    // Purge session scope
    const purgedCount = await memory.purgeScope('session', 'test-session-1');
    if (purgedCount < 1) {
      throw new Error(`Expected at least 1 purged fact, got ${purgedCount}`);
    }
    console.log(`✓ TEST 5 PASSED: Inspect, forget, and purge operations verified.\n`);

    // ------------------------------------------------------------
    // TEST 6: Skill Registry Versioning & Success Rate Tracking
    // ------------------------------------------------------------
    console.log('--- TEST 6: Skill Registry Versioning & Telemetry ---');
    await memory.registerSkillMetadata({
      name: 'code_refactor_skill',
      version: '1.2.0',
      description: 'Refactor complex TypeScript code cleanly',
      tags: ['coding', 'refactor'],
      dependencies: ['git_checkpoint_skill']
    });

    await memory.recordSkillInvocation('code_refactor_skill', true);
    await memory.recordSkillInvocation('code_refactor_skill', true);
    await memory.recordSkillInvocation('code_refactor_skill', false);

    const skillEntry = await memory.getSkillEntry('code_refactor_skill');
    if (!skillEntry || skillEntry.invocations !== 3 || skillEntry.successes !== 2 || skillEntry.failures !== 1) {
      throw new Error(`Skill telemetry mismatch: ${JSON.stringify(skillEntry)}`);
    }
    const expectedRate = 2 / 3;
    if (Math.abs(skillEntry.successRate - expectedRate) > 0.01) {
      throw new Error(`Expected successRate ~0.66, got ${skillEntry.successRate}`);
    }
    console.log(`Skill ${skillEntry.name} v${skillEntry.version} - Invocations: ${skillEntry.invocations}, Success Rate: ${(skillEntry.successRate * 100).toFixed(1)}%`);
    console.log(`✓ TEST 6 PASSED: Skill registry telemetry and versioning verified.\n`);

    // ------------------------------------------------------------
    // TEST 7: Budget-Aware ContextEngine Assembly
    // ------------------------------------------------------------
    console.log('--- TEST 7: ContextEngine Budget-Aware Assembling ---');
    const skillsPath = path.resolve(process.cwd(), 'skills');
    const procedural = new ProceduralMemory(skillsPath);

    const contextEngine = new ContextEngine();
    const history: Message[] = [
      { role: 'user', parts: [{ text: 'Turn 1: Hello' }] },
      { role: 'model', parts: [{ text: 'Turn 1 response' }] },
      { role: 'user', parts: [{ text: 'Turn 2: Show me stats' }] },
      { role: 'model', parts: [{ text: 'Turn 2 response' }] }
    ];

    const assembled = await contextEngine.assemble({
      userPrompt: 'What is the user preference and project tech stack?',
      history,
      systemPrompt: 'You are Athena AI.',
      sessionId: 'test-session-context',
      memory,
      procedural,
      budget: {
        memoryTokenLimit: 1000,
        skillsTokenLimit: 1500,
        historyTokenLimit: 200
      }
    });

    if (!assembled.systemInstruction.includes('Athena AI')) {
      throw new Error('System prompt missing from assembled context');
    }
    if (!assembled.systemInstruction.includes('[SCOPED MEMORY]')) {
      throw new Error('Scoped memory block missing from assembled context');
    }
    if (assembled.tokenEstimate.total <= 0) {
      throw new Error('Token estimate total should be greater than 0');
    }

    console.log('Token Estimates:');
    console.log(`  - System: ${assembled.tokenEstimate.system}`);
    console.log(`  - Memory: ${assembled.tokenEstimate.memory}`);
    console.log(`  - Skills: ${assembled.tokenEstimate.skills}`);
    console.log(`  - History: ${assembled.tokenEstimate.history}`);
    console.log(`  - Total: ${assembled.tokenEstimate.total}`);
    console.log('✓ TEST 7 PASSED: ContextEngine assembled budget-aware prompt pipeline.\n');

    console.log('ALL PHASE 2 CONTEXT + MEMORY TESTS PASSED SUCCESSFULLY! 🎉');
  } finally {
    await memory.close();
    try {
      await fs.rm(testDbDir, { recursive: true, force: true });
    } catch (e) {}
  }
}

runPhase2ContextMemoryTests().catch((err) => {
  console.error('Phase 2 tests failed:', err);
  process.exit(1);
});
