import * as fs from 'fs/promises';
import * as path from 'path';
import { openDatabase } from '../storage/database.js';
import { createSqliteStores } from '../storage/stores/sqlite/index.js';
import { EpisodicMemory } from '../memory/memory.js';
import { CapabilityRegistry, seedP6Capabilities } from '../tools/capabilityRegistry.js';
import {
  SpecializedRole,
  DelegationContractEngine,
  AgentMailbox,
  HandoffEngine,
  TeamManager,
  getSpecializedProfile,
  getAllSpecializedProfiles,
  seedSpecializedProfiles,
  HandoffPipeline
} from '../multiagent/index.js';
import { agentDelegateTool } from '../tools/agentDelegate.js';
import { agentMessageSendTool, agentMailboxCheckTool } from '../tools/agentMessageTools.js';

const TEST_DB_PATH = path.resolve('./scratch/test_v2p6_multi_agent.db');

async function cleanup(): Promise<void> {
  try {
    await fs.rm(TEST_DB_PATH, { force: true });
    await fs.rm(`${TEST_DB_PATH}-wal`, { force: true });
    await fs.rm(`${TEST_DB_PATH}-shm`, { force: true });
  } catch {}
}

async function runTests(): Promise<void> {
  console.log('=== STARTING V2 P6: MULTI-AGENT SUBSYSTEM TESTS ===\n');
  await cleanup();

  const db = await openDatabase(TEST_DB_PATH);
  const stores = createSqliteStores(db);

  try {
    // -------------------------------------------------------------
    // TEST 1: Schema Migration 8 & Store CRUD
    // -------------------------------------------------------------
    console.log('--- TEST 1: Schema Migration 8 & Store CRUD ---');

    // 1a. Agent Message Store CRUD
    const message = await stores.agentMessage.save({
      id: 'msg_test_001',
      senderId: 'agent_researcher',
      recipientId: 'agent_coder',
      messageType: 'request',
      goalId: 'goal_build_feature',
      taskId: 'task_research_deps',
      payload: { requirement: 'Find robust JSON validator for TypeScript' },
      status: 'sent',
      createdAt: Date.now()
    });

    if (!message || message.id !== 'msg_test_001') {
      throw new Error('Test 1 failed: AgentMessage save failed.');
    }
    const fetchedMsg = await stores.agentMessage.get('msg_test_001');
    if (!fetchedMsg || fetchedMsg.messageType !== 'request' || (fetchedMsg.payload as any).requirement !== 'Find robust JSON validator for TypeScript') {
      throw new Error('Test 1 failed: AgentMessage get returned unexpected payload.');
    }

    // 1b. Agent Team Store CRUD with Justification
    const team = await stores.agentTeam.save({
      id: 'team_core_engineering',
      name: 'Core Feature Team',
      justification: 'Specialized triad separating research, implementation, and independent verification to guarantee code quality.',
      leadAgentId: 'agent_planner',
      memberAgentIds: ['agent_researcher', 'agent_coder', 'agent_reviewer'],
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    if (!team || team.id !== 'team_core_engineering') {
      throw new Error('Test 1 failed: AgentTeam save failed.');
    }
    const fetchedTeam = await stores.agentTeam.get('team_core_engineering');
    if (!fetchedTeam || fetchedTeam.memberAgentIds.length !== 3) {
      throw new Error('Test 1 failed: AgentTeam get failed.');
    }

    console.log('✓ TEST 1 PASSED: Migration 8 tables & store CRUD verified.\n');

    // -------------------------------------------------------------
    // TEST 2: Specialized Agent Profiles & Role Boundaries
    // -------------------------------------------------------------
    console.log('--- TEST 2: Specialized Agent Profiles & Role Boundaries ---');
    await seedSpecializedProfiles(stores.agent);

    const allProfiles = getAllSpecializedProfiles();
    if (allProfiles.length < 6) {
      throw new Error(`Test 2 failed: Expected at least 6 specialized profiles, got ${allProfiles.length}.`);
    }

    const researcherProfile = getSpecializedProfile('researcher');
    const coderProfile = getSpecializedProfile('coder');
    const reviewerProfile = getSpecializedProfile('reviewer');

    if (researcherProfile.role !== 'Researcher' || !researcherProfile.capabilities.includes('research')) {
      throw new Error('Test 2 failed: Researcher profile invalid.');
    }
    if (coderProfile.role !== 'Coder' || !coderProfile.capabilities.includes('code')) {
      throw new Error('Test 2 failed: Coder profile invalid.');
    }
    if (reviewerProfile.role !== 'Reviewer' || reviewerProfile.permissions.maxRiskLevel !== 'safe') {
      throw new Error('Test 2 failed: Reviewer profile must have safe risk level.');
    }

    // Verify Reviewer denies destructive/write tool patterns
    const writeRules = reviewerProfile.permissions.toolPermissions.filter(p => p.pattern === 'fs:write');
    if (writeRules.length === 0 || writeRules[0].effect !== 'deny') {
      throw new Error('Test 2 failed: Reviewer must deny fs:write access.');
    }

    console.log(`  Seeded ${allProfiles.length} specialized profiles: ${allProfiles.map(p => p.role).join(', ')}`);
    console.log('✓ TEST 2 PASSED: Specialized agent profiles and security boundaries verified.\n');

    // -------------------------------------------------------------
    // TEST 3: Delegation Contract Creation & Validation
    // -------------------------------------------------------------
    console.log('--- TEST 3: Delegation Contract Creation & Validation ---');
    const contractEngine = new DelegationContractEngine();

    const validContract = contractEngine.createContract({
      parentAgentId: 'primary_agent',
      targetRole: 'coder',
      taskDescription: 'Implement math helper function',
      scopedContext: 'Export add(a, b) and subtract(a, b)',
      allowedTools: ['writeFile', 'editFile'],
      maxTurns: 5,
      timeoutMs: 60000,
      outputFormat: 'structured'
    });

    const validation = contractEngine.validateContract(validContract, 0, 0);
    if (!validation.valid) {
      throw new Error(`Test 3 failed: Expected valid contract, got errors: ${validation.errors.join(', ')}`);
    }

    // Validate rejection on Reviewer being assigned write tools
    const invalidReviewerContract = contractEngine.createContract({
      parentAgentId: 'primary_agent',
      targetRole: 'reviewer',
      taskDescription: 'Audit and modify code',
      scopedContext: 'Review the diff',
      allowedTools: ['writeFile', 'readFile'],
      maxTurns: 5
    });
    const reviewerValidation = contractEngine.validateContract(invalidReviewerContract, 0, 0);
    if (reviewerValidation.valid) {
      throw new Error('Test 3 failed: Assigning writeFile to Reviewer must fail validation.');
    }

    console.log('✓ TEST 3 PASSED: Delegation contract creation and role-integrity validation verified.\n');

    // -------------------------------------------------------------
    // TEST 4 (EXIT CRITERION 2): Subagent Cannot Use Tool Outside Scope
    // -------------------------------------------------------------
    console.log('--- TEST 4 (EXIT CRITERION 2): Tool Scoping Guard ---');

    const scopedTools = ['readFile', 'inspectPath', 'searchFiles'];
    // Authorized call succeeds
    const isAuthorized = contractEngine.verifyToolExecution('readFile', scopedTools);
    if (!isAuthorized) {
      throw new Error('Test 4 failed: Authorized tool failed verification.');
    }

    // Unauthorized call throws explicit tool scoping error
    let scopeViolationCaught = false;
    try {
      contractEngine.verifyToolExecution('deleteFile', scopedTools);
    } catch (err: any) {
      if (err.message.includes('Tool scoping violation') && err.message.includes('deleteFile')) {
        scopeViolationCaught = true;
      }
    }

    if (!scopeViolationCaught) {
      throw new Error('Test 4 failed: Invoking unauthorized tool outside scope was not blocked!');
    }

    console.log('  Attempt to call "deleteFile" on [readFile, inspectPath, searchFiles] was blocked with Tool Scoping Violation.');
    console.log('✓ TEST 4 PASSED (EXIT CRITERION 2): Subagent cannot use a tool outside its scope.\n');

    // -------------------------------------------------------------
    // TEST 5 (EXIT CRITERION 3): Agent Count & Depth Caps Enforced
    // -------------------------------------------------------------
    console.log('--- TEST 5 (EXIT CRITERION 3): Depth & Agent Count Caps ---');

    // 5a. Depth limit (currentDepth >= 3 must be blocked)
    const deepContract = contractEngine.createContract({
      parentAgentId: 'agent_sub_level_2',
      targetRole: 'coder',
      taskDescription: 'Deeper sub-delegation',
      scopedContext: 'Test deep nesting',
      allowedTools: ['calculate']
    });

    const depthResult = contractEngine.validateContract(deepContract, 3, 0);
    if (depthResult.valid || !depthResult.errors.some(e => e.includes('depth limit exceeded'))) {
      throw new Error('Test 5 failed: Delegation at depth >= 3 was not blocked!');
    }

    // 5b. Active subagent count cap (activeSubagents >= 5 must be blocked)
    const cappedResult = contractEngine.validateContract(validContract, 0, 5);
    if (cappedResult.valid || !cappedResult.errors.some(e => e.includes('concurrency cap exceeded'))) {
      throw new Error('Test 5 failed: Subagent count exceeding 5 was not blocked!');
    }

    console.log('  Delegation rejected at depth 3: depth limit strictly enforced.');
    console.log('  Delegation rejected at 5 active subagents: concurrency cap strictly enforced.');
    console.log('✓ TEST 5 PASSED (EXIT CRITERION 3): Agent count and depth are capped.\n');

    // -------------------------------------------------------------
    // TEST 6: Durable A2A Mailbox — 9 Message Types & Status
    // -------------------------------------------------------------
    console.log('--- TEST 6: Durable A2A Mailbox ---');
    const mailbox = new AgentMailbox(stores.agentMessage);

    const messageTypes = [
      'request', 'response', 'handoff', 'question', 'blocked',
      'status', 'artifact', 'approval', 'cancel'
    ] as const;

    for (const type of messageTypes) {
      const msg = await mailbox.send({
        senderId: 'agent_alpha',
        recipientId: 'agent_beta',
        messageType: type,
        payload: { text: `Testing message type ${type}` },
        goalId: 'goal_test_mailbox'
      });
      if (msg.messageType !== type) {
        throw new Error(`Test 6 failed: Message type ${type} not persisted correctly.`);
      }
    }

    // Verify retrieval by recipient
    const betaInbox = await mailbox.receive('agent_beta', { goalId: 'goal_test_mailbox' });
    if (betaInbox.length !== 9) {
      throw new Error(`Test 6 failed: Expected 9 messages for agent_beta, got ${betaInbox.length}.`);
    }

    // Verify reply & thread
    const firstMsg = betaInbox[0];
    const replyMsg = await mailbox.reply(firstMsg, 'agent_beta', { reply: 'Acknowledged' });
    const thread = await mailbox.getThread(firstMsg.id);
    if (thread.length !== 2) {
      throw new Error(`Test 6 failed: Expected thread length 2, got ${thread.length}.`);
    }

    // Verify status update
    await mailbox.markProcessed(firstMsg.id);
    const updatedFirst = await stores.agentMessage.get(firstMsg.id);
    if (updatedFirst?.status !== 'processed') {
      throw new Error('Test 6 failed: Status transition to processed failed.');
    }

    console.log('✓ TEST 6 PASSED: Durable A2A Mailbox verified with all 9 message types.\n');

    // -------------------------------------------------------------
    // TEST 7 (EXIT CRITERION 1): Handoff Pipeline Survives Restart
    // -------------------------------------------------------------
    console.log('--- TEST 7 (EXIT CRITERION 1): Multi-Stage Handoff Pipeline Survives Restart ---');

    const handoffEngine = new HandoffEngine(mailbox, contractEngine, stores.task);
    const pipelineId = 'pipeline_feature_auth';
    const goalId = 'goal_feature_auth';

    const pipeline = handoffEngine.createStandardHandoffPipeline({
      pipelineId,
      goalId,
      researchTask: 'Analyze best token authentication schemes',
      codingTask: 'Implement token authentication handler',
      reviewTask: 'Review security and edge cases of authentication handler'
    });

    const executionLog: string[] = [];

    const mockExecutor = async (step: any, previousOutput?: any) => {
      executionLog.push(`Executed step ${step.stepIndex} (${step.role})`);
      if (step.role === 'researcher') {
        return { recommendations: ['Use JWT with short expiration and refresh tokens'] };
      } else if (step.role === 'coder') {
        return {
          diff: '+ export function signToken() { ... }',
          basedOn: previousOutput?.recommendations?.[0]
        };
      } else if (step.role === 'reviewer') {
        return {
          verdict: 'APPROVED',
          auditedDiff: previousOutput?.diff,
          passedChecks: ['expiry_configured', 'secret_redacted']
        };
      }
      return {};
    };

    // Phase 1: Execute step 0 (Researcher) and simulate mid-flight crash / stop
    console.log('  [Phase 1] Executing Researcher step, then simulating mid-flight crash...');
    await handoffEngine.executePipeline(pipeline, mockExecutor, 0);

    if (pipeline.currentStepIndex !== 1 || pipeline.steps[0].status !== 'completed') {
      throw new Error('Test 7 failed: Researcher step did not complete before crash simulation.');
    }

    // Verify durable handoff message was recorded in SQLite
    const handoffMsgs = await stores.agentMessage.listByGoal(goalId);
    const researcherHandoff = handoffMsgs.find(m => m.messageType === 'handoff' && m.senderId === 'agent_researcher');
    if (!researcherHandoff) {
      throw new Error('Test 7 failed: Durable handoff message was not written to mailbox before crash.');
    }

    console.log(`  Durable handoff saved in DB: ${(researcherHandoff.payload as any).result.recommendations[0]}`);

    // Phase 2: Simulate restart (new database connection / engine instance)
    console.log('  [Phase 2] Restarting process: re-opening DB and re-instantiating HandoffEngine...');
    const restartedDb = await openDatabase(TEST_DB_PATH);
    const restartedStores = createSqliteStores(restartedDb);
    const restartedMailbox = new AgentMailbox(restartedStores.agentMessage);
    const restartedHandoffEngine = new HandoffEngine(restartedMailbox, contractEngine, restartedStores.task);

    // Reconstruct pipeline descriptor as would be loaded from DB/metadata
    const recoveredPipeline: HandoffPipeline = {
      ...pipeline,
      // Reset running state to test recovery from mailbox
      currentStepIndex: 0,
      steps: pipeline.steps.map(s => ({ ...s, status: 'pending', output: undefined }))
    };

    // Phase 3: Resume from restart
    console.log('  [Phase 3] Resuming pipeline from restart state...');
    const finishedPipeline = await restartedHandoffEngine.resumeFromRestart(recoveredPipeline, mockExecutor);

    if (finishedPipeline.status !== 'completed') {
      throw new Error(`Test 7 failed: Pipeline did not complete upon restart, status: ${finishedPipeline.status}`);
    }

    // Verify Coder and Reviewer completed
    const coderStep = finishedPipeline.steps[1];
    const reviewerStep = finishedPipeline.steps[2];

    if (coderStep.status !== 'completed' || !coderStep.output.basedOn.includes('JWT')) {
      throw new Error('Test 7 failed: Coder did not properly consume Researcher handoff after restart.');
    }
    if (reviewerStep.status !== 'completed' || reviewerStep.output.verdict !== 'APPROVED') {
      throw new Error('Test 7 failed: Reviewer did not complete audit.');
    }

    console.log('  Handoff chain completed successfully across restart:');
    console.log(`    Researcher -> ${JSON.stringify(finishedPipeline.steps[0].output)}`);
    console.log(`    Coder      -> ${JSON.stringify(coderStep.output)}`);
    console.log(`    Reviewer   -> ${JSON.stringify(reviewerStep.output)}`);
    console.log('✓ TEST 7 PASSED (EXIT CRITERION 1): Handoff Researcher -> Coder -> Reviewer survives a restart.\n');

    // -------------------------------------------------------------
    // TEST 8: Teams with Mandatory Specialization Justification
    // -------------------------------------------------------------
    console.log('--- TEST 8: Optional Teams with Justification Rule ---');
    const teamManager = new TeamManager(stores.agentTeam);

    // 8a. Creation with empty/trivial justification must fail
    let trivialFailed = false;
    try {
      await teamManager.createTeam({
        name: 'Trivial Team',
        justification: 'just for fun',
        leadAgentId: 'agent_planner',
        memberAgentIds: ['agent_coder', 'agent_reviewer']
      });
    } catch (err: any) {
      if (err.message.includes('substantive specialization justification')) {
        trivialFailed = true;
      }
    }
    if (!trivialFailed) {
      throw new Error('Test 8 failed: Team creation with trivial justification should have been rejected.');
    }

    // 8b. Creation with substantive justification succeeds
    const validTeam = await teamManager.createTeam({
      name: 'Security Audit Team',
      justification: 'Combines proactive researcher threat intelligence with independent code review for secure release sign-offs.',
      leadAgentId: 'agent_planner',
      memberAgentIds: ['agent_researcher', 'agent_reviewer']
    });

    if (!validTeam || validTeam.memberAgentIds.length !== 2) {
      throw new Error('Test 8 failed: Valid team creation failed.');
    }

    const listedTeams = await teamManager.listTeams();
    if (listedTeams.length === 0) {
      throw new Error('Test 8 failed: Team list returned 0 teams.');
    }

    console.log('  Trivial team creation blocked: justification rule enforced.');
    console.log(`  Valid team created with substantive justification: "${validTeam.name}"`);
    console.log('✓ TEST 8 PASSED: Mandatory specialization justification rule verified.\n');

    // -------------------------------------------------------------
    // TEST 9: Capability Registry Honest Audit
    // -------------------------------------------------------------
    console.log('--- TEST 9: Capability Registry Audit ---');
    const registry = CapabilityRegistry.getInstance();
    seedP6Capabilities(registry);

    const requiredCaps = [
      'multiagent.specialized_profiles',
      'multiagent.delegation_contract',
      'multiagent.a2a_mailbox',
      'multiagent.handoff_engine',
      'multiagent.teams'
    ];

    for (const capId of requiredCaps) {
      const cap = registry.get(capId);
      if (!cap || cap.status !== 'real' || cap.phase !== 'P6') {
        throw new Error(`Test 9 failed: Capability ${capId} is missing or not registered as real.`);
      }
      console.log(`  Capability [${cap.id}]: ${cap.name} (${cap.status})`);
    }

    console.log('✓ TEST 9 PASSED: All P6 capabilities honestly registered.\n');

    // -------------------------------------------------------------
    // TEST 10: Multi-Agent Tool Definitions
    // -------------------------------------------------------------
    console.log('--- TEST 10: Multi-Agent Tool Definitions ---');
    if (agentDelegateTool.definition.name !== 'agentDelegate') {
      throw new Error('Test 10 failed: agentDelegateTool definition name mismatch.');
    }
    if (agentMessageSendTool.definition.name !== 'agentMessageSend') {
      throw new Error('Test 10 failed: agentMessageSendTool definition name mismatch.');
    }
    if (agentMailboxCheckTool.definition.name !== 'agentMailboxCheck') {
      throw new Error('Test 10 failed: agentMailboxCheckTool definition name mismatch.');
    }
    console.log('✓ TEST 10 PASSED: Tool definitions verified.\n');

    console.log('=== ALL V2 P6 MULTI-AGENT TESTS PASSED ===\n');
  } finally {
    await db.close();
    await cleanup();
  }
}

runTests().catch(err => {
  console.error('\n❌ V2 P6 Multi-Agent Test Suite Failed:', err);
  process.exit(1);
});
