/**
 * Athena V2 — P1: Agent Foundation.
 *
 * Exit criteria:
 *  1. Identity is identical across restart, model switch, and tool change.
 *  2. Switching workspace never leaks another workspace's memory or files.
 *  3. A model-asserted user fact stays candidate until validated.
 *  4. A populated V1 database migrates cleanly.
 *
 * Also covers store CRUD, profile versioning, permission enforcement,
 * and interrupted-migration recovery. No LLM calls.
 */
import * as assert from 'assert';
import * as dotenv from 'dotenv';
import * as fs from 'fs/promises';
import * as path from 'path';
import { open as openRaw } from 'sqlite';
import sqlite3 from 'sqlite3';

dotenv.config();

import { AthenaDatabase } from '../core/database.js';
import { MIGRATIONS } from '../core/migrations/index.js';
import { EpisodicMemory } from '../core/memory.js';
import { ContextEngine } from '../core/contextEngine.js';
import { PolicyEngine } from '../core/policyEngine.js';
import { ToolExecutor } from '../core/toolRuntime.js';
import { Agent } from '../core/agent.js';
import { Tool } from '../core/types.js';
import { createInitialRunState } from '../core/runState.js';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_USER_ID,
  createDefaultUser,
  renderProfileSoul,
  composePermissionModels
} from '../core/identity.js';
import { PermissionModel } from '../core/identityTypes.js';

const SCRATCH_DIR = path.resolve(process.cwd(), 'scratch', 'test_v2_p1_agent_foundation');
const WS_A_DIR = path.join(SCRATCH_DIR, 'workspace_alpha');
const WS_B_DIR = path.join(SCRATCH_DIR, 'workspace_beta');

function dbPath(name: string): string {
  return path.join(SCRATCH_DIR, name);
}

async function cleanup(): Promise<void> {
  await fs.rm(SCRATCH_DIR, { recursive: true, force: true }).catch(() => {});
}

async function countRows(db: any, table: string): Promise<number> {
  const row = await db.get(`SELECT COUNT(*) as count FROM ${table}`);
  return row ? row.count : 0;
}

async function tableExists(db: any, table: string): Promise<boolean> {
  const row = await db.get(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, table);
  return !!row;
}

async function columnNames(db: any, table: string): Promise<string[]> {
  const rows = await db.all(`PRAGMA table_info(${table})`);
  return rows.map((r: any) => r.name);
}

async function runTests(): Promise<void> {
  console.log('=== STARTING V2 P1: AGENT FOUNDATION TESTS ===\n');
  await cleanup();
  await fs.mkdir(WS_A_DIR, { recursive: true });
  await fs.mkdir(WS_B_DIR, { recursive: true });

  const savedGemini = process.env.GEMINI_API_KEY;
  const savedOpenAI = process.env.OPENAI_API_KEY;
  const savedNvidia = process.env.NVIDIA_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.NVIDIA_API_KEY;

  console.log('--- TEST 1: Versioned migrations on a fresh database ---');
  {
    const db = await AthenaDatabase.open(dbPath('fresh.db'));
    const handle = db.getHandle();
    assert.ok((await db.getUserVersion()) >= 2, 'user_version must be at least 2');
    const applied = await db.getAppliedMigrations();
    assert.ok(applied.some(m => m.name === 'v1_baseline'), 'v1_baseline migration present');
    assert.ok(applied.some(m => m.name === 'v2_p1_agent_foundation'), 'v2_p1_agent_foundation migration present');
    for (const t of ['episodic_memory', 'semantic_memory', 'scheduled_jobs', 'event_log', 'runs', 'run_events', 'scoped_memory', 'skill_registry']) {
      assert.ok(await tableExists(handle, t), `V1 table ${t} missing`);
    }
    for (const t of ['workspaces', 'projects', 'users', 'agent_profiles', 'agent_profile_versions']) {
      assert.ok(await tableExists(handle, t), `V2 table ${t} missing`);
    }
    const cols = await columnNames(handle, 'scoped_memory');
    for (const c of ['workspace_id', 'project_id', 'agent_id']) {
      assert.ok(cols.includes(c), `scoped_memory.${c} missing`);
    }
    await db.close();
    console.log('✓ TEST 1 PASSED: fresh database reaches schema version 2.\n');
  }

  console.log('--- TEST 2: Populated V1 database migrates without losing rows ---');
  {
    const fixture = dbPath('v1_fixture.db');
    const v1 = await openRaw({ filename: fixture, driver: sqlite3.Database });
    await MIGRATIONS[0].up(v1);
    const now = Date.now();
    await v1.run(
      `INSERT INTO scoped_memory (scope, fact, confidence, lifecycle, source, timestamp, created_at, updated_at)
       VALUES ('user', 'User prefers concise answers', 0.9, 'active', 'user_input', ?, ?, ?)`,
      now, now, now
    );
    await v1.run(
      `INSERT INTO scoped_memory (scope, fact, confidence, lifecycle, source, timestamp, created_at, updated_at)
       VALUES ('workspace', 'Repo uses TypeScript', 0.8, 'active', 'user_input', ?, ?, ?)`,
      now, now, now
    );
    await v1.run(
      `INSERT INTO runs (run_id, root_run_id, session_id, task, status, current_turn, created_at, updated_at)
       VALUES ('run_v1_1', 'run_v1_1', 's1', 'old v1 task', 'completed', 3, ?, ?)`,
      now, now
    );
    await v1.run(
      `INSERT INTO run_events (run_id, event_type, payload, timestamp) VALUES ('run_v1_1', 'completed', '{}', ?)`,
      now
    );
    await v1.run(
      `INSERT INTO episodic_memory (session_id, role, content, timestamp) VALUES ('s1', 'user', '[{"text":"hi"}]', ?)`,
      now
    );
    await v1.run(`INSERT INTO event_log (id, topic, created_at) VALUES ('evt1', 'timer:tick', ?)`, now);
    await v1.run(`INSERT INTO skill_registry (name, created_at, updated_at) VALUES ('demo-skill', ?, ?)`, now, now);
    await v1.run(
      `INSERT INTO scheduled_jobs (id, prompt, schedule, session_id, next_run) VALUES ('job1', 'demo', '0 9 * * *', 's1', ?)`,
      now
    );

    const tables = ['episodic_memory', 'semantic_memory', 'scheduled_jobs', 'event_log', 'runs', 'run_events', 'scoped_memory', 'skill_registry'];
    const before: Record<string, number> = {};
    for (const t of tables) before[t] = await countRows(v1, t);
    assert.ok(before.scoped_memory >= 2);
    await v1.close();

    const migrated = await AthenaDatabase.open(fixture);
    const handle = migrated.getHandle();
    assert.ok((await migrated.getUserVersion()) >= 2);
    for (const t of tables) {
      const after = await countRows(handle, t);
      assert.ok(after >= before[t], `${t} lost rows (${before[t]} -> ${after})`);
      if (t !== 'scoped_memory') {
        assert.strictEqual(after, before[t], `${t} row count changed`);
      }
    }
    for (const t of ['workspaces', 'projects', 'users', 'agent_profiles', 'agent_profile_versions']) {
      assert.ok(await tableExists(handle, t));
    }
    const cols = await columnNames(handle, 'scoped_memory');
    assert.ok(cols.includes('workspace_id') && cols.includes('project_id') && cols.includes('agent_id'));
    await migrated.close();

    const realDbPath = path.resolve(process.cwd(), 'state.db');
    try {
      await fs.access(realDbPath);
      const copyPath = dbPath('real_v1_copy.db');
      await fs.copyFile(realDbPath, copyPath);
      const rawCopy = await openRaw({ filename: copyPath, driver: sqlite3.Database });
      const realBefore: Record<string, number> = {};
      for (const t of tables) {
        if (await tableExists(rawCopy, t)) realBefore[t] = await countRows(rawCopy, t);
      }
      await rawCopy.close();
      const real = await AthenaDatabase.open(copyPath);
      assert.ok((await real.getUserVersion()) >= 2, 'real V1 database must reach at least version 2');
      for (const t of Object.keys(realBefore)) {
        const after = await countRows(real.getHandle(), t);
        assert.ok(after >= realBefore[t], `real ${t} lost rows`);
      }
      const preserved = Object.values(realBefore).reduce((a, b) => a + b, 0);
      await real.close();
      console.log(`  (also migrated a copy of state.db; ${preserved} pre-existing rows preserved)`);
    } catch (err: any) {
      if (err && err.code === 'ENOENT') {
        console.log('  (no state.db present; synthesized fixture only)');
      } else {
        throw err;
      }
    }
    console.log('✓ TEST 2 PASSED: populated V1 databases migrate without data loss.\n');
  }

  console.log('--- TEST 3: Identity persists across restart, model switch, and tool change ---');
  {
    process.env.GEMINI_API_KEY = savedGemini || 'dummy-key-no-llm-calls';
    const soulPath = path.resolve(process.cwd(), 'SOUL.md');
    const soulContent = (await fs.readFile(soulPath, 'utf-8')).trim();
    const identityDb = dbPath('identity.db');

    const boot = async (modelName: string, allowedTools?: string[]) => {
      const agent = new Agent({
        modelName,
        maxTurns: 5,
        systemPrompt: 'ops',
        soulPath,
        dbPath: identityDb,
        allowedTools
      });
      await agent.init();
      return agent;
    };

    const agent1 = await boot('gemini-2.0-flash');
    const profile1 = agent1.getAgentProfile();
    assert.ok(profile1);
    assert.strictEqual(profile1.id, DEFAULT_PROFILE_ID);
    assert.strictEqual(profile1.version, 1);
    assert.strictEqual(profile1.identity, soulContent);
    assert.strictEqual(renderProfileSoul(profile1), soulContent);
    const memory1 = agent1.getMemory();
    assert.ok(memory1);
    const user = await memory1.getUserStore()!.get(DEFAULT_USER_ID);
    assert.ok(user);
    assert.strictEqual(user.name, 'Owner');
    await memory1.close();

    const agent2 = await boot('gemini-1.5-pro');
    const profile2 = agent2.getAgentProfile();
    assert.ok(profile2);
    assert.strictEqual(profile2.identity, profile1.identity);
    assert.strictEqual(profile2.version, profile1.version);
    assert.strictEqual(renderProfileSoul(profile2), renderProfileSoul(profile1));
    await agent2.getMemory()!.close();

    const agent3 = await boot('gemini-2.0-flash', ['readFile', 'executeCommand']);
    const profile3 = agent3.getAgentProfile();
    assert.ok(profile3);
    assert.strictEqual(profile3.identity, profile1.identity);
    assert.strictEqual(renderProfileSoul(profile3), renderProfileSoul(profile1));

    const agentStore = agent3.getMemory()!.getAgentStore()!;
    const updated = await agentStore.save({ ...profile3, personality: 'Direct and precise.' }, 'test-personality-update');
    assert.strictEqual(updated.version, 2);
    const history = await agentStore.getVersionHistory(DEFAULT_PROFILE_ID);
    assert.strictEqual(history.length, 2);
    assert.strictEqual(history[0].snapshot.personality, '');
    assert.strictEqual(history[1].snapshot.personality, 'Direct and precise.');
    assert.strictEqual(history[1].changedBy, 'test-personality-update');
    await agent3.getMemory()!.close();
    delete process.env.GEMINI_API_KEY;
    console.log('✓ TEST 3 PASSED: identity is persistent, versioned, and independent of model and tools.\n');
  }

  console.log('--- TEST 4: Store CRUD, foreign keys, and run-store facade ---');
  {
    const memory = new EpisodicMemory(dbPath('stores.db'));
    await memory.init();
    const workspaceStore = memory.getWorkspaceStore()!;
    const projectStore = memory.getProjectStore()!;
    const userStore = memory.getUserStore()!;

    const wsA = await workspaceStore.save({ id: 0, name: 'alpha', kind: 'personal', rootPath: WS_A_DIR, createdAt: 0, updatedAt: 0 });
    const wsB = await workspaceStore.save({ id: 0, name: 'beta', kind: 'research', rootPath: WS_B_DIR, createdAt: 0, updatedAt: 0 });
    assert.ok(wsA.id > 0 && wsB.id !== wsA.id);
    assert.strictEqual((await workspaceStore.getByName('alpha'))!.id, wsA.id);

    const project = await projectStore.save({ id: 0, workspaceId: wsA.id, name: 'athena-v2', rootPath: WS_A_DIR, createdAt: 0, updatedAt: 0 });
    assert.strictEqual((await projectStore.list(wsA.id)).length, 1);
    assert.strictEqual((await projectStore.list(wsB.id)).length, 0);
    await assert.rejects(
      () => workspaceStore.delete(wsA.id),
      (err: any) => /project/i.test(err.message)
    );
    assert.strictEqual(await workspaceStore.delete(wsB.id), true);

    await userStore.save({ ...createDefaultUser(), name: 'Raghu' });
    assert.strictEqual((await userStore.get(DEFAULT_USER_ID))!.name, 'Raghu');

    const run = createInitialRunState({ runId: 'run_p1', sessionId: 's', task: 'facade' });
    await memory.saveRunState(run);
    const loaded = await memory.getRunState('run_p1');
    assert.strictEqual(loaded?.task, 'facade');
    await memory.updateRunState('run_p1', { status: 'completed', result: 'ok' });
    assert.strictEqual((await memory.getRunState('run_p1'))?.status, 'completed');
    await memory.saveRunEvent({
      type: 'completed',
      runId: 'run_p1',
      timestamp: Date.now(),
      result: 'ok'
    } as any);
    assert.strictEqual((await memory.getRunEvents('run_p1')).length, 1);

    await memory.close();
    console.log('✓ TEST 4 PASSED: stores enforce foreign keys and the run facade round-trips.\n');
  }

  console.log('--- TEST 5: Workspace isolation (memory and filesystem) ---');
  {
    const memory = new EpisodicMemory(dbPath('isolation.db'));
    await memory.init();
    const workspaceStore = memory.getWorkspaceStore()!;
    const wsA = await workspaceStore.save({ id: 0, name: 'alpha', kind: 'personal', rootPath: WS_A_DIR, createdAt: 0, updatedAt: 0 });
    const wsB = await workspaceStore.save({ id: 0, name: 'beta', kind: 'research', rootPath: WS_B_DIR, createdAt: 0, updatedAt: 0 });
    const provenance = { source: 'user_input' as const, timestamp: Date.now() };

    await memory.saveScopedMemory({ scope: 'workspace', fact: 'The alpha project uses postgres database', provenance, workspaceId: wsA.id });
    await memory.saveScopedMemory({ scope: 'workspace', fact: 'The beta project uses mysql database', provenance, workspaceId: wsB.id });
    await memory.saveScopedMemory({ scope: 'global', fact: 'The user likes postgres database tooling', provenance });

    const fromA = (await memory.searchScopedMemory({ query: 'database', workspaceId: wsA.id, threshold: 0.1 })).map(f => f.fact);
    const fromB = (await memory.searchScopedMemory({ query: 'database', workspaceId: wsB.id, threshold: 0.1 })).map(f => f.fact);
    assert.ok(fromA.includes('The alpha project uses postgres database'));
    assert.ok(!fromA.includes('The beta project uses mysql database'));
    assert.ok(fromB.includes('The beta project uses mysql database'));
    assert.ok(!fromB.includes('The alpha project uses postgres database'));
    assert.ok(fromA.includes('The user likes postgres database tooling'));
    assert.ok(fromB.includes('The user likes postgres database tooling'));

    const ctxA = await new ContextEngine().assemble({
      userPrompt: 'database',
      history: [],
      systemPrompt: 'ops',
      memory,
      workspaceId: wsA.id
    });
    assert.ok(!ctxA.includedFacts.map(f => f.fact).includes('The beta project uses mysql database'));

    const policy = new PolicyEngine({ workspaceRoot: WS_A_DIR });
    const insideA = path.join(WS_A_DIR, 'notes.txt');
    const insideB = path.join(WS_B_DIR, 'notes.txt');
    assert.strictEqual(policy.evaluateFileAccess(insideA, 'write').allowed, true);
    assert.strictEqual(policy.evaluateFileAccess(insideB, 'write').ruleId, 'WORKSPACE_BOUNDARY_ENFORCEMENT');
    assert.strictEqual(policy.evaluateFileAccess(insideB, 'delete').ruleId, 'WORKSPACE_BOUNDARY_ENFORCEMENT');
    assert.strictEqual(policy.evaluateFileAccess(insideB, 'read').allowed, true);

    policy.setPermissionModel({ toolPermissions: [], fileWriteRoots: [WS_B_DIR] });
    const granted = policy.evaluateFileAccess(insideB, 'write');
    assert.strictEqual(granted.allowed, true);
    assert.strictEqual(granted.ruleId, 'PERMISSION_MODEL_WRITE_ROOT');

    await memory.close();
    console.log('✓ TEST 5 PASSED: workspaces do not leak memory or writable files.\n');
  }

  console.log('--- TEST 6: Model-asserted user facts stay candidate until validated ---');
  {
    const memory = new EpisodicMemory(dbPath('candidate.db'));
    await memory.init();
    const now = Date.now();

    const candidateId = await memory.saveScopedMemory({
      scope: 'user',
      fact: 'The user studies at Stanford University',
      provenance: { source: 'agent_reflection', timestamp: now, evidence: 'mentioned in passing' },
      confidence: 0.6
    });
    assert.strictEqual((await memory.getScopedMemory(candidateId))!.lifecycle, 'candidate');
    assert.strictEqual((await memory.searchScopedMemory({ query: 'Stanford', threshold: 0.1 })).length, 0);
    assert.strictEqual((await memory.searchScopedMemory({ query: 'Stanford', threshold: 0.1, lifecycles: ['candidate'] })).length, 1);

    const again = await memory.saveScopedMemory({
      scope: 'user',
      fact: 'The user studies at Stanford University',
      provenance: { source: 'agent_reflection', timestamp: now }
    });
    assert.strictEqual((await memory.getScopedMemory(again))!.lifecycle, 'candidate');

    await memory.validateMemory(candidateId, 'User confirmed university on 2026-10-06');
    const validated = await memory.getScopedMemory(candidateId);
    assert.strictEqual(validated!.lifecycle, 'active');
    assert.strictEqual(validated!.provenance.evidence, 'User confirmed university on 2026-10-06');
    assert.strictEqual((await memory.searchScopedMemory({ query: 'Stanford', threshold: 0.1 })).length, 1);

    const stated = await memory.saveScopedMemory({
      scope: 'user',
      fact: 'The user lives in Bangalore',
      provenance: { source: 'user_input', timestamp: now }
    });
    assert.strictEqual((await memory.getScopedMemory(stated))!.lifecycle, 'active');

    const workspaceFact = await memory.saveScopedMemory({
      scope: 'workspace',
      fact: 'The workspace repo uses pnpm',
      provenance: { source: 'agent_reflection', timestamp: now }
    });
    assert.strictEqual((await memory.getScopedMemory(workspaceFact))!.lifecycle, 'active');

    const subagentFact = await memory.saveScopedMemory({
      scope: 'user',
      fact: 'The user prefers morning meetings',
      provenance: { source: 'subagent', timestamp: now }
    });
    assert.strictEqual((await memory.getScopedMemory(subagentFact))!.lifecycle, 'candidate');
    await memory.reinforceMemory(subagentFact);
    assert.strictEqual((await memory.getScopedMemory(subagentFact))!.lifecycle, 'confirmed');

    await memory.close();
    console.log('✓ TEST 6 PASSED: model-asserted user facts never become permanent on their own.\n');
  }

  console.log('--- TEST 7: Permission model is enforced ahead of V1 rules ---');
  {
    const policy = new PolicyEngine({ workspaceRoot: WS_A_DIR });
    assert.strictEqual(policy.evaluateToolCall('browserNavigate', {}).allowed, true);

    policy.setPermissionModel({
      toolPermissions: [{ pattern: 'browserNavigate', effect: 'deny', reason: 'no browser in this profile' }]
    });
    const denied = policy.evaluateToolCall('browserNavigate', {});
    assert.strictEqual(denied.allowed, false);
    assert.strictEqual(denied.ruleId, 'PERMISSION_MODEL_DENIED');

    policy.setPermissionModel({ toolPermissions: [{ pattern: 'fs:write', effect: 'deny' }] });
    assert.strictEqual(
      policy.evaluateToolCall('writeFile', { path: path.join(WS_A_DIR, 'x.txt') }, ['fs:write']).ruleId,
      'PERMISSION_MODEL_DENIED'
    );

    policy.setPermissionModel({ toolPermissions: [{ pattern: '*', effect: 'require_confirmation' }] });
    const confirmAll = policy.evaluateToolCall('readFile', { path: 'a.txt' }, ['fs:read']);
    assert.strictEqual(confirmAll.action, 'require_confirmation');
    assert.strictEqual(confirmAll.allowed, true);

    policy.setPermissionModel({ toolPermissions: [{ pattern: 'executeCommand', effect: 'allow' }] });
    const destructive = policy.evaluateToolCall('executeCommand', { command: 'rm -rf /' }, ['cmd:exec']);
    assert.strictEqual(destructive.allowed, false);
    assert.strictEqual(destructive.ruleId, 'DESTRUCTIVE_COMMAND_BLOCKED');

    const agentPerms: PermissionModel = { toolPermissions: [{ pattern: 'executeCommand', effect: 'allow' }] };
    const userPerms: PermissionModel = { toolPermissions: [{ pattern: 'cmd:exec', effect: 'deny', reason: 'owner disabled shell' }] };
    policy.setPermissionModel(composePermissionModels(agentPerms, userPerms));
    const shellDenied = policy.evaluateToolCall('executeCommand', { command: 'echo hi' }, ['cmd:exec']);
    assert.strictEqual(shellDenied.allowed, false);
    assert.ok(/owner disabled shell/.test(shellDenied.reason || ''));

    const executor = new ToolExecutor({ policyEngine: policy });
    policy.setPermissionModel({ toolPermissions: [{ pattern: 'testEchoTool', effect: 'require_confirmation' }] });
    const testTool: Tool = {
      definition: { name: 'testEchoTool', description: 'test', parameters: { type: 'OBJECT', properties: {} } },
      manifest: { name: 'testEchoTool', riskLevel: 'safe', parallelSafe: true, permissions: ['memory'] },
      execute: async () => ({ ok: true })
    };
    const refused = await executor.execute(testTool, {}, { confirm: async () => false });
    assert.strictEqual(refused.success, false);
    assert.strictEqual(refused.error?.code, 'POLICY_CONFIRMATION_DENIED');
    const accepted = await executor.execute(testTool, {}, { confirm: async () => true });
    assert.strictEqual(accepted.success, true);
    const noCallback = await executor.execute(testTool, {});
    assert.strictEqual(noCallback.success, true);

    policy.setPermissionModel({ toolPermissions: [{ pattern: 'memory', effect: 'deny' }] });
    const hardDeny = await executor.execute(testTool, {});
    assert.strictEqual(hardDeny.success, false);
    assert.strictEqual(hardDeny.error?.code, 'POLICY_VIOLATION');
    console.log('✓ TEST 7 PASSED: permission model denies, confirms, and does not bypass V1 blocks.\n');
  }

  console.log('--- TEST 8: Workspace switch survives restart and moves the filesystem boundary ---');
  {
    process.env.GEMINI_API_KEY = savedGemini || 'dummy-key-no-llm-calls';
    const soulPath = path.resolve(process.cwd(), 'SOUL.md');
    const switchDb = dbPath('switch.db');
    const agent = new Agent({
      modelName: 'gemini-2.0-flash',
      maxTurns: 5,
      systemPrompt: 'ops',
      soulPath,
      dbPath: switchDb
    });
    await agent.init();
    assert.strictEqual(agent.getActiveWorkspace(), null);
    const wsA = await agent.getMemory()!.getWorkspaceStore()!.save({
      id: 0, name: 'alpha', kind: 'personal', rootPath: WS_A_DIR, createdAt: 0, updatedAt: 0
    });
    await agent.setActiveWorkspace(wsA.id);
    assert.strictEqual(agent.getAgentProfile()!.workspaceId, wsA.id);
    assert.strictEqual(agent.getPolicyEngine().getWorkspaceRoot(), path.resolve(WS_A_DIR));
    await agent.getMemory()!.close();

    const restarted = new Agent({
      modelName: 'gemini-2.0-flash',
      maxTurns: 5,
      systemPrompt: 'ops',
      soulPath,
      dbPath: switchDb
    });
    await restarted.init();
    assert.strictEqual(restarted.getActiveWorkspace()?.id, wsA.id);
    assert.strictEqual(restarted.getPolicyEngine().getWorkspaceRoot(), path.resolve(WS_A_DIR));
    const history = await restarted.getMemory()!.getAgentStore()!.getVersionHistory(DEFAULT_PROFILE_ID);
    assert.ok(history.some(v => v.changedBy === 'workspace-switch'));
    await restarted.setActiveWorkspace(null);
    assert.strictEqual(restarted.getActiveWorkspace(), null);
    assert.strictEqual(restarted.getPolicyEngine().getWorkspaceRoot(), path.resolve(process.cwd()));
    await restarted.getMemory()!.close();
    delete process.env.GEMINI_API_KEY;
    console.log('✓ TEST 8 PASSED: workspace binding is persistent and bounds the filesystem.\n');
  }

  console.log('--- TEST 9: A failed migration rolls back and can be retried ---');
  {
    const failDb = dbPath('migration_failure.db');
    const brokenVersion = MIGRATIONS.length + 1;
    const broken = {
      version: brokenVersion,
      name: `v${brokenVersion}_should_rollback`,
      up: async (db: any) => {
        await db.exec('CREATE TABLE IF NOT EXISTS half_applied (id INTEGER PRIMARY KEY)');
        throw new Error('simulated crash mid-migration');
      }
    };
    await assert.rejects(
      () => AthenaDatabase.open(failDb, { migrations: [...MIGRATIONS, broken] }),
      (err: any) => err.message.includes(`v${brokenVersion}_should_rollback`)
    );
    const raw = await openRaw({ filename: failDb, driver: sqlite3.Database });
    assert.strictEqual(await tableExists(raw, 'half_applied'), false);
    const version: any = await raw.get('PRAGMA user_version');
    assert.strictEqual(version.user_version, MIGRATIONS.length);
    assert.strictEqual(await raw.get(`SELECT name FROM schema_migrations WHERE version = ?`, brokenVersion), undefined);
    await raw.close();

    const recovered = await AthenaDatabase.open(failDb);
    assert.strictEqual(await recovered.getUserVersion(), MIGRATIONS.length);
    await recovered.close();
    console.log('✓ TEST 9 PASSED: interrupted migrations roll back and retry cleanly.\n');
  }

  if (savedGemini) process.env.GEMINI_API_KEY = savedGemini;
  if (savedOpenAI) process.env.OPENAI_API_KEY = savedOpenAI;
  if (savedNvidia) process.env.NVIDIA_API_KEY = savedNvidia;

  console.log('=== ALL V2 P1 AGENT FOUNDATION TESTS PASSED ===');
}

runTests()
  .then(async () => {
    await cleanup();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('\nV2 P1 TEST FAILURE:\n', err);
    await cleanup();
    process.exit(1);
  });
