import { AthenaDatabase } from '../storage/database.js';
import {
  Workflow,
  validateWorkflow,
  evalPath,
  render,
  deepRender,
  evalCondition,
  WorkflowRegistry,
  WorkflowExecutor,
  AgentFactory
} from '../workflows/index.js';
import * as fs from 'fs';
import * as path from 'path';

let passedTests = 0;
let failedTests = 0;

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    failedTests++;
    throw new Error(msg);
  } else {
    console.log(`✅ PASSED: ${msg}`);
    passedTests++;
  }
}

async function runTests() {
  console.log('====================================================');
  console.log('🚀 Running Athena Workflows (Sprint 1 Core) Tests');
  console.log('====================================================\n');

  // ── 1. Template Engine & Expression Evaluator ─────────────────────
  console.log('--- 1. Template Engine & Safe Condition Evaluator ---');
  const ctx = {
    inputs: { topic: 'Autonomous AI Agents', limit: 5 },
    nodes: {
      plan: {
        output: [
          { query: 'agent memory architectures' },
          { query: 'workflow DAG execution' }
        ]
      },
      check: { output: { score: 0.95, verdict: 'pass' } }
    },
    blackboard: { diff: '--- src/index.ts\n+++ src/index.ts' }
  };

  assert(evalPath('inputs.topic', ctx) === 'Autonomous AI Agents', 'evalPath resolves simple dot path');
  assert(evalPath('nodes.plan.output[0].query', ctx) === 'agent memory architectures', 'evalPath resolves bracket array path');
  assert(evalPath('nodes.missing.val', ctx) === undefined, 'evalPath returns undefined for missing segment');

  const renderedStr = render('Research topic: {{ inputs.topic }} (max {{ inputs.limit }})', ctx);
  assert(renderedStr === 'Research topic: Autonomous AI Agents (max 5)', 'render string templates');

  const deepObj = deepRender({
    topicName: '{{ inputs.topic }}',
    limitNumber: '{{ inputs.limit }}',
    queries: '{{ nodes.plan.output }}'
  }, ctx);

  assert(deepObj.topicName === 'Autonomous AI Agents', 'deepRender resolves string field');
  assert(deepObj.limitNumber === 5, 'deepRender preserves typed number');
  assert(Array.isArray(deepObj.queries) && deepObj.queries.length === 2, 'deepRender preserves typed array');

  // Test Condition Evaluator (no eval())
  assert(evalCondition('nodes.check.output.score > 0.8', ctx) === true, 'evalCondition: > comparison');
  assert(evalCondition('nodes.check.output.score < 0.5', ctx) === false, 'evalCondition: < comparison');
  assert(evalCondition('nodes.check.output.verdict === "pass"', ctx) === true, 'evalCondition: === string equality');
  assert(evalCondition('nodes.check.output.score >= 0.9 && nodes.check.output.verdict == "pass"', ctx) === true, 'evalCondition: && logical AND');
  assert(evalCondition('nodes.check.output.score < 0.5 || inputs.limit == 5', ctx) === true, 'evalCondition: || logical OR');
  assert(evalCondition('!false', ctx) === true, 'evalCondition: unary NOT');

  // ── 2. Workflow Validator ─────────────────────────────────────────
  console.log('\n--- 2. Workflow Validator ---');
  const templatePath = path.resolve('templates/research-agent.json');
  assert(fs.existsSync(templatePath), 'research-agent.json template exists on disk');
  const templateContent = JSON.parse(fs.readFileSync(templatePath, 'utf8'));

  const validRes = validateWorkflow(templateContent);
  assert(validRes.valid === true, `research-agent template is valid: ${validRes.errors.join(', ')}`);

  // Detect Cycle
  const cycleWf: Workflow = {
    id: 'cycle-wf',
    version: 1,
    name: 'Cycle Workflow',
    inputs: {},
    settings: {},
    nodes: [
      { id: 'node_a', type: 'agent', prompt: 'Prompt A', tools: [] },
      { id: 'node_b', type: 'agent', prompt: 'Prompt B', tools: [] }
    ],
    edges: [
      ['node_a', 'node_b'],
      ['node_b', 'node_a']
    ]
  };
  const cycleRes = validateWorkflow(cycleWf);
  assert(cycleRes.valid === false && cycleRes.errors.some(e => e.includes('Cycle')), 'Validator detects cycles');

  // Detect Invalid Edge
  const brokenEdgeWf: Workflow = {
    ...cycleWf,
    id: 'broken-edge-wf',
    edges: [['node_a', 'non_existent_node']]
  };
  const brokenRes = validateWorkflow(brokenEdgeWf);
  assert(brokenRes.valid === false && brokenRes.errors.some(e => e.includes('non-existent')), 'Validator catches dangling edges');

  // ── 3. Database Migration & Registry ──────────────────────────────
  console.log('\n--- 3. Database Migration & Registry ---');
  const tempDbPath = path.resolve(`./test_workflows_${Date.now()}.db`);
  const athenaDb = await AthenaDatabase.open(tempDbPath);
  const db = athenaDb.getHandle();

  const userVersion = await athenaDb.getUserVersion();
  assert(userVersion >= 13, `Migration applied successfully (user_version = ${userVersion})`);

  const registry = new WorkflowRegistry(db);

  // Save workflow
  await registry.save(templateContent);
  const fetchedWf = await registry.get('research-agent');
  assert(fetchedWf !== null && fetchedWf.id === 'research-agent', 'Registry saves and retrieves workflow');

  const listWfs = await registry.list();
  assert(listWfs.some(w => w.id === 'research-agent'), 'Registry lists saved workflows');

  // Blackboard test
  await registry.saveRun({
    runId: 'run_test_123',
    workflowId: 'research-agent',
    version: 1,
    inputs: {},
    status: 'running',
    nodeOutputs: {},
    startedAt: Date.now()
  });

  const blackboard = registry.getBlackboard('run_test_123');
  await blackboard.set('diff', 'test diff content', 'node_1');
  assert((await blackboard.get('diff')) === 'test diff content', 'WorkflowBlackboard set and get');
  const allBb = await blackboard.getAll();
  assert(allBb.diff === 'test diff content', 'WorkflowBlackboard getAll');

  // ── 4. End-to-End Workflow Execution (CLI-testable) ───────────────
  console.log('\n--- 4. End-to-End Workflow Execution ---');

  // Mock AgentFactory that generates deterministic responses for testing
  const mockAgentFactory: AgentFactory = {
    create: (cfg) => {
      return {
        init: async () => {},
        run: async (prompt: string) => {
          if (prompt.includes('3 targeted search queries')) {
            return JSON.stringify([
              'query 1: agent architectures',
              'query 2: prompt caching',
              'query 3: tool calling runtime'
            ]);
          }
          if (prompt.includes('Research this query thoroughly:')) {
            return `Findings for: ${prompt}`;
          }
          if (prompt.includes('Write a comprehensive report')) {
            return `# Consolidated Research Report\nBased on findings.\n\nApproved.`;
          }
          return `Processed: ${prompt}`;
        }
      } as any;
    }
  };

  const executor = new WorkflowExecutor({
    registry,
    agentFactory: mockAgentFactory
  });

  const runResult = await executor.run(templateContent, { topic: 'Agentic Workflows' }, 'test_parent');
  assert(runResult.status === 'completed', `Workflow executed with status 'completed' (actual: ${runResult.status}, error: ${runResult.error})`);
  assert(runResult.nodeOutputs['plan']?.status === 'completed', 'Plan node completed');
  assert(Array.isArray(runResult.nodeOutputs['plan']?.output), 'Plan node produced JSON array');
  assert(runResult.nodeOutputs['search']?.status === 'completed', 'Map search node completed');
  assert(runResult.nodeOutputs['write']?.status === 'completed', 'Write node completed');
  assert(runResult.nodeOutputs['review']?.status === 'completed', 'Review node completed');

  // Verify persistence in registry
  const persistedRun = await registry.getRun(runResult.runId);
  assert(persistedRun !== null && persistedRun.status === 'completed', 'Run persisted in database');
  const persistedPlanOut = await registry.getNodeOutput(runResult.runId, 'plan');
  assert(persistedPlanOut !== null && persistedPlanOut.status === 'completed', 'Node outputs persisted in database');

  // ── 5. Multi-Agent Collective & Collector Node ────────────────────
  console.log('\n--- 5. Multi-Agent Collective & Collector Node ---');

  const multiAgentWf: Workflow = {
    id: 'pr-review-collective',
    version: 1,
    name: 'PR Review Collective',
    inputs: { pr: { type: 'string', required: true } },
    settings: {},
    nodes: [
      { id: 'trigger', type: 'trigger', triggerType: 'manual' },
      {
        id: 'sec_agent',
        type: 'agent',
        prompt: 'Check security for {{inputs.pr}}',
        tools: [],
        output: 'json'
      },
      {
        id: 'logic_agent',
        type: 'agent',
        prompt: 'Check logic for {{inputs.pr}}',
        tools: [],
        output: 'json'
      },
      {
        id: 'style_agent',
        type: 'agent',
        prompt: 'Check style for {{inputs.pr}}',
        tools: [],
        output: 'json'
      },
      {
        id: 'merge_collector',
        type: 'collector',
        strategy: 'structured_merge',
        sources: ['sec_agent', 'logic_agent', 'style_agent']
      },
      {
        id: 'vote_collector',
        type: 'collector',
        strategy: 'consensus_voting',
        votingField: 'verdict',
        votingPolicy: 'majority',
        sources: ['sec_agent', 'logic_agent', 'style_agent']
      }
    ],
    edges: [
      ['trigger', 'sec_agent'],
      ['trigger', 'logic_agent'],
      ['trigger', 'style_agent'],
      ['sec_agent', 'merge_collector'],
      ['logic_agent', 'merge_collector'],
      ['style_agent', 'merge_collector'],
      ['sec_agent', 'vote_collector'],
      ['logic_agent', 'vote_collector'],
      ['style_agent', 'vote_collector']
    ]
  };

  const multiAgentMockFactory: AgentFactory = {
    create: (cfg) => ({
      init: async () => {},
      run: async (prompt: string) => {
        if (prompt.includes('Check security')) {
          return JSON.stringify({ issues: 0, verdict: 'approve' });
        }
        if (prompt.includes('Check logic')) {
          return JSON.stringify({ issues: 0, verdict: 'approve' });
        }
        if (prompt.includes('Check style')) {
          return JSON.stringify({ issues: 1, verdict: 'request_changes' });
        }
        return JSON.stringify({ verdict: 'approve' });
      }
    } as any)
  };

  const maExecutor = new WorkflowExecutor({
    registry,
    agentFactory: multiAgentMockFactory
  });

  await registry.save(multiAgentWf);
  const maRun = await maExecutor.run(multiAgentWf, { pr: 'PR #101' });
  assert(maRun.status === 'completed', `Multi-agent collective workflow completed (status: ${maRun.status})`);

  // Verify structured_merge
  const mergedOutput = maRun.nodeOutputs['merge_collector']?.output;
  assert(mergedOutput && mergedOutput.sec_agent && mergedOutput.logic_agent && mergedOutput.style_agent, 'Collector structured_merge collected all 3 peer outputs');
  assert(mergedOutput.sec_agent.verdict === 'approve', 'Merged output contains sec_agent verdict');

  // Verify consensus_voting
  const voteOutput = maRun.nodeOutputs['vote_collector']?.output;
  assert(voteOutput && voteOutput.consensus === true, 'Collector consensus_voting evaluated consensus');
  assert(voteOutput.decision === 'approve', `Collector consensus chose majority decision 'approve' (votes: ${JSON.stringify(voteOutput.votes)})`);

  // ── 6. Condition Node Branching ───────────────────────────────────
  console.log('\n--- 6. Condition Node Branching ---');

  const conditionWf: Workflow = {
    id: 'condition-branch-wf',
    version: 1,
    name: 'Condition Branching',
    inputs: { score: { type: 'number', required: true } },
    settings: {},
    nodes: [
      { id: 'trigger', type: 'trigger', triggerType: 'manual' },
      {
        id: 'eval_gate',
        type: 'condition',
        expr: 'inputs.score >= 80',
        trueBranch: 'high_tier',
        falseBranch: 'low_tier'
      },
      { id: 'high_tier', type: 'agent', prompt: 'High tier process', tools: [] },
      { id: 'low_tier', type: 'agent', prompt: 'Low tier process', tools: [] }
    ],
    edges: [
      ['trigger', 'eval_gate'],
      ['eval_gate', 'high_tier'],
      ['eval_gate', 'low_tier']
    ]
  };

  await registry.save(conditionWf);
  const condRun = await maExecutor.run(conditionWf, { score: 95 });
  assert(condRun.status === 'completed', 'Condition workflow completed');
  assert(condRun.nodeOutputs['high_tier']?.status === 'completed', 'High tier node executed on score >= 80');
  assert(condRun.nodeOutputs['low_tier']?.status === 'skipped', 'Low tier node correctly marked skipped');

  // Clean up temporary database file
  try {
    await athenaDb.getHandle().close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  } catch (err) {
    // ignore cleanup error
  }

  console.log('\n====================================================');
  console.log(`🎉 ALL SPRINT 1 TESTS COMPLETED: ${passedTests} passed, ${failedTests} failed`);
  console.log('====================================================');
}

runTests().catch(err => {
  console.error('\n💥 Test run failed with fatal error:', err);
  process.exit(1);
});
