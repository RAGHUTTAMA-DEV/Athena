import { AthenaDatabase } from '../storage/database.js';
import {
  Workflow,
  WorkflowRegistry,
  WorkflowExecutor,
  AgentFactory,
  createRunWorkflowTool,
  createCreateWorkflowTool,
  createGetWorkflowTool,
  createAddWorkflowNodeTool,
  createRemoveWorkflowNodeTool,
  createUpdateWorkflowNodeTool,
  createAddWorkflowEdgeTool,
  createRemoveWorkflowEdgeTool,
  createUpdateWorkflowSettingsTool,
  setActiveWorkflowForSession,
  registerAllWorkflowAgents,
  createWorkflowAgentTool
} from '../workflows/index.js';
import { toolsRegistry } from '../tools/index.js';
import { EventBus } from '../background/eventBus.js';
import * as path from 'path';
import * as fs from 'fs';

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

async function runSprint2Tests() {
  console.log('====================================================');
  console.log('🚀 Running Athena Workflows (Sprint 2 Multi-Agent & Chat) Tests');
  console.log('====================================================\n');

  const tempDbPath = path.resolve(`./test_workflows_sprint2_${Date.now()}.db`);
  const athenaDb = await AthenaDatabase.open(tempDbPath);
  const db = athenaDb.getHandle();
  const registry = new WorkflowRegistry(db);

  // Mock AgentFactory
  const mockAgentFactory: AgentFactory = {
    create: (cfg) => {
      return {
        init: async () => {},
        run: async (prompt: string) => {
          if (cfg.extraTools && cfg.extraTools.length > 0) {
            // Coordinator agent invoking specialist tools
            const researcherTool = cfg.extraTools.find(t => t.definition.name === 'delegateTo_researcher');
            let res = '';
            if (researcherTool) {
              const toolResult = await researcherTool.execute({ task: 'Investigate system security' });
              res += `Researcher returned: ${toolResult} | `;
            }
            res += `Coordinator synthesized findings.`;
            return res;
          }
          if (cfg.systemPromptOverride?.includes('Researcher')) {
            return `Specialist Findings on: ${prompt}`;
          }
          return `Agent output for: ${prompt}`;
        }
      } as any;
    }
  };

  const executor = new WorkflowExecutor({
    registry,
    agentFactory: mockAgentFactory
  });

  // ── 1. Chat Tools ─────────────────────────────────────────────────
  console.log('--- 1. Chat Tools (createWorkflow, getWorkflow, runWorkflow) ---');

  const createTool = createCreateWorkflowTool(registry);
  const getTool = createGetWorkflowTool(registry);
  const runTool = createRunWorkflowTool(registry, executor);

  const sessionId = 'session_test_42';

  // Test description-only createWorkflow
  const draftHint = await createTool.execute({ description: 'A workflow that checks GitHub PRs' });
  assert(draftHint.schema && draftHint.schema.id, 'createWorkflow without definition returns drafting schema instructions');

  // Test full definition createWorkflow
  const initialWf: Workflow = {
    id: 'github-pr-inspector',
    version: 1,
    name: 'GitHub PR Inspector',
    description: 'Inspects PRs for bugs and security',
    inputs: { prNumber: { type: 'number', required: true } },
    settings: { maxCostUsd: 0.25 },
    nodes: [
      { id: 'trigger', type: 'trigger', triggerType: 'manual' },
      { id: 'fetch_diff', type: 'tool', tool: 'readFile', args: { path: 'pr_diff.patch' } },
      { id: 'analyze', type: 'agent', prompt: 'Analyze PR #{{inputs.prNumber}} diff: {{nodes.fetch_diff.output}}', tools: [] }
    ],
    edges: [
      ['trigger', 'fetch_diff'],
      ['fetch_diff', 'analyze']
    ]
  };

  const createRes = await createTool.execute(
    { description: 'Create inspector', definition: initialWf },
    { sessionId } as any
  );
  assert(createRes.success === true, 'createWorkflow validates and saves valid workflow');
  assert(createRes.workflowId === 'github-pr-inspector', 'createWorkflow returns workflowId');

  // Test getWorkflow via active session context
  const getRes = await getTool.execute({}, { sessionId } as any);
  assert(getRes.workflow && getRes.workflow.id === 'github-pr-inspector', 'getWorkflow automatically uses active session workflow');

  // Test runWorkflow
  const runRes = await runTool.execute({ id: 'github-pr-inspector', inputs: { prNumber: 101 } });
  assert(runRes.status === 'completed', 'runWorkflow tool successfully executes saved workflow');
  assert(runRes.outputs['analyze']?.status === 'completed', 'runWorkflow completed analyze node');

  // ── 2. Refinement Patch Tools ─────────────────────────────────────
  console.log('\n--- 2. Refinement Patch Tools ---');

  const addNodeTool = createAddWorkflowNodeTool(registry);
  const updateNodeTool = createUpdateWorkflowNodeTool(registry);
  const addEdgeTool = createAddWorkflowEdgeTool(registry);
  const removeEdgeTool = createRemoveWorkflowEdgeTool(registry);
  const removeNodeTool = createRemoveWorkflowNodeTool(registry);
  const updateSettingsTool = createUpdateWorkflowSettingsTool(registry);

  // 2a. Add Node
  const addNodeRes = await addNodeTool.execute({
    node: {
      id: 'approval_gate',
      type: 'approval',
      message: 'Approve PR #{{inputs.prNumber}} review?'
    },
    afterNodeId: 'analyze'
  }, { sessionId } as any);

  assert(addNodeRes.success === true, 'addWorkflowNode adds node');
  assert(addNodeRes.version === 2, 'addWorkflowNode increments version to 2');

  const wfV2 = await registry.get('github-pr-inspector');
  assert(Boolean(wfV2?.nodes.some(n => n.id === 'approval_gate')), 'New node exists in registry');
  assert(Boolean(wfV2?.edges.some(([f, t]) => f === 'analyze' && t === 'approval_gate')), 'Edge was automatically inserted');

  // 2b. Update Node
  const updateNodeRes = await updateNodeTool.execute({
    nodeId: 'analyze',
    patch: { model: 'gemini-2.5-pro' }
  }, { sessionId } as any);
  assert(updateNodeRes.success === true, 'updateWorkflowNode updates node properties');
  assert(updateNodeRes.version === 3, 'updateWorkflowNode increments version to 3');

  const wfV3 = await registry.get('github-pr-inspector');
  const analyzeNode = wfV3?.nodes.find(n => n.id === 'analyze') as any;
  assert(analyzeNode?.model === 'gemini-2.5-pro', 'Node property patched in registry');

  // 2c. Add Edge with cycle detection check
  const badEdgeRes = await addEdgeTool.execute({
    from: 'approval_gate',
    to: 'trigger'
  }, { sessionId } as any);
  assert(badEdgeRes.success === false && badEdgeRes.errors.some((e: string) => e.includes('Cycle')), 'addWorkflowEdge prevents cyclic edge insertion');

  // 2d. Update Settings & Metadata
  const updateSettingsRes = await updateSettingsTool.execute({
    name: 'Autonomous PR Reviewer',
    settings: { maxCostUsd: 1.0 }
  }, { sessionId } as any);
  assert(updateSettingsRes.success === true, 'updateWorkflowSettings updates settings');

  // 2e. Remove Edge and Node
  const removeEdgeRes = await removeEdgeTool.execute({
    from: 'analyze',
    to: 'approval_gate'
  }, { sessionId } as any);
  assert(removeEdgeRes.success === true, 'removeWorkflowEdge removes specified edge');

  const removeNodeRes = await removeNodeTool.execute({
    nodeId: 'approval_gate'
  }, { sessionId } as any);
  assert(removeNodeRes.success === true, 'removeWorkflowNode removes node and cleans dependencies');

  // ── 3. Multi-Agent Orchestrator Node ──────────────────────────────
  console.log('\n--- 3. Multi-Agent Orchestrator Node ---');

  const orchestratorWf: Workflow = {
    id: 'master-orchestrator-wf',
    version: 1,
    name: 'Master Orchestrator Workflow',
    inputs: { goal: { type: 'string', required: true } },
    settings: {},
    nodes: [
      { id: 'trigger', type: 'trigger', triggerType: 'manual' },
      {
        id: 'master_lead',
        type: 'orchestrator',
        systemPrompt: 'You are the Lead Master Agent.',
        prompt: 'Coordinate specialists to solve: {{inputs.goal}}',
        tools: [],
        specialists: [
          {
            name: 'researcher',
            systemPrompt: 'You are a Researcher specialist.',
            tools: ['searchWeb']
          }
        ]
      }
    ],
    edges: [['trigger', 'master_lead']]
  };

  await registry.save(orchestratorWf);
  const orchRun = await executor.run(orchestratorWf, { goal: 'Security Architecture Audit' });
  assert(orchRun.status === 'completed', 'Orchestrator workflow completed');
  const masterOut = orchRun.nodeOutputs['master_lead']?.output;
  assert(typeof masterOut === 'string' && masterOut.includes('Researcher returned:'), 'Master orchestrator dynamically called delegateTo_researcher specialist tool');

  // ── 4. Sub-Workflow Node Execution ────────────────────────────────
  console.log('\n--- 4. Sub-Workflow Node Execution ---');

  // 4a. Save child sub-workflow
  const childSubWf: Workflow = {
    id: 'summarizer-child-wf',
    version: 1,
    name: 'Summarizer Sub-Workflow',
    inputs: { text: { type: 'string', required: true } },
    settings: {},
    nodes: [
      { id: 'trigger', type: 'trigger', triggerType: 'manual' },
      {
        id: 'child_summary',
        type: 'agent',
        prompt: 'Summarize text: {{inputs.text}}',
        tools: []
      }
    ],
    edges: [['trigger', 'child_summary']]
  };
  await registry.save(childSubWf);

  // 4b. Create parent workflow referencing child sub-workflow
  const parentWf: Workflow = {
    id: 'parent-orchestration-wf',
    version: 1,
    name: 'Parent Orchestration Workflow',
    inputs: { rawData: { type: 'string', required: true } },
    settings: {},
    nodes: [
      { id: 'trigger', type: 'trigger', triggerType: 'manual' },
      {
        id: 'invoke_summarizer',
        type: 'subWorkflow',
        workflowId: 'summarizer-child-wf',
        inputs: { text: '{{inputs.rawData}}' }
      },
      {
        id: 'final_deliverable',
        type: 'agent',
        prompt: 'Finalize output: {{nodes.invoke_summarizer.output}}',
        tools: []
      }
    ],
    edges: [
      ['trigger', 'invoke_summarizer'],
      ['invoke_summarizer', 'final_deliverable']
    ]
  };
  await registry.save(parentWf);

  const parentRun = await executor.run(parentWf, { rawData: 'Comprehensive raw data stream.' });
  assert(parentRun.status === 'completed', 'Parent workflow with subWorkflow node executed successfully');
  assert(parentRun.nodeOutputs['invoke_summarizer']?.status === 'completed', 'Sub-workflow node completed');
  assert(parentRun.nodeOutputs['final_deliverable']?.status === 'completed', 'Final deliverable received sub-workflow output');

  // ── 5. Workflow as Agent (WorkflowAgentProfile) ───────────────────
  console.log('\n--- 5. Workflow as Agent (WorkflowAgentProfile) ---');

  const agentWf: Workflow = {
    id: 'pr-reviewer-bot',
    version: 1,
    name: 'PR Reviewer Bot',
    agentProfile: {
      name: 'PR Reviewer Bot',
      description: 'Specialized bot that performs automated GitHub PR reviews',
      publishAsAgent: true,
      toolName: 'runPrReviewerBot',
      systemPrompt: 'You are a specialized PR Reviewer.'
    },
    inputs: {
      prId: { type: 'string', required: true, description: 'The PR number or ID' }
    },
    settings: {},
    nodes: [
      { id: 'trigger', type: 'trigger', triggerType: 'manual' },
      { id: 'review_step', type: 'agent', prompt: 'Review PR {{inputs.prId}}', tools: [] }
    ],
    edges: [['trigger', 'review_step']]
  };

  await registry.save(agentWf);

  // Register workflow agents
  const registeredAgents = await registerAllWorkflowAgents(registry, executor);
  assert(registeredAgents.includes('runPrReviewerBot'), 'registerAllWorkflowAgents discovered and registered runPrReviewerBot tool');
  assert(toolsRegistry.has('runPrReviewerBot'), 'toolsRegistry contains runPrReviewerBot tool');

  // Execute the workflow agent tool directly
  const agentTool = toolsRegistry.get('runPrReviewerBot')!;
  const toolExecRes = await agentTool.execute({ prId: 'PR #555' });
  assert(toolExecRes.status === 'completed', 'Invoking workflow agent tool executed workflow successfully');
  assert(toolExecRes.result !== undefined, 'Workflow agent returned final result payload');

  // Clean up temporary database
  try {
    await athenaDb.getHandle().close();
    if (fs.existsSync(tempDbPath)) {
      fs.unlinkSync(tempDbPath);
    }
  } catch (err) {
    // ignore cleanup error
  }

  console.log('\n====================================================');
  console.log(`🎉 ALL SPRINT 2 TESTS COMPLETED: ${passedTests} passed, ${failedTests} failed`);
  console.log('====================================================');
}

runSprint2Tests().catch(err => {
  console.error('\n💥 Sprint 2 test run failed with fatal error:', err);
  process.exit(1);
});
