
      import './dnsFix.js';

import { AgentConfig, Message, Part, RunOptions } from './types.js';
import { LLMProvider, createLLMProvider, LLMResponse } from '../providers/llmProvider.js';
import { toolsRegistry } from '../tools/index.js';
import { EpisodicMemory } from '../memory/memory.js';
import { ProceduralMemory } from '../memory/procedural.js';
import { MemoryConsolidator } from '../memory/consolidation.js';
import { cleanGeminiSchema } from '../mcp/mcpManager.js';
import { RunState, RunStatus, RunBudget, createInitialRunState, StructuredFailure } from './runState.js';
import { CancellationToken } from './cancellation.js';
import { AgentEvent, AgentEventEmitter } from './events.js';
import { ContextEngine, isRecallQuery, RECALL_RE } from '../memory/contextEngine.js';
import { ToolExecutor, ToolSelector, ToolResult } from '../tools/toolRuntime.js';
import { AgentProfile, Workspace } from '../identity/identityTypes.js';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_USER_ID,
  createDefaultUser,
  seedAgentProfileFromSoul,
  renderProfileSoul,
  composePermissionModels,
  isEmptyPermissionModel
} from '../identity/identity.js';
import { TaskClassifier, Planner, VerificationGate, DynamicEscalator, ExecutionPlan, TaskClassification } from '../autonomy/orchestration.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import { startActiveObservation, propagateAttributes } from '@langfuse/tracing';
import { TelemetryManager } from '../observability/telemetry.js';
import { TrajectoryReplayer } from '../observability/replayDebugger.js';
import {
  Goal,
  GoalStatus,
  GoalPriority,
  GoalBudget,
  GoalUsage,
  Task,
  TaskStatus,
  RunWait,
  WaitType,
  createInitialGoalUsage
} from '../autonomy/goalTypes.js';
import { WaitingEngine } from '../autonomy/waitingEngine.js';
import { CrashResumeSweeper } from '../autonomy/crashSweeper.js';
import { EventBus } from '../background/eventBus.js';

const TOOL_ALIASES: Record<string, string> = {
  'jobs_schedule': 'cronjob',
  'schedule_job': 'cronjob',
  'scheduleJob': 'cronjob',
  'cron_job': 'cronjob',
  'cronJob': 'cronjob',
  'manage_cron': 'cronjob',
  'scheduler': 'cronjob',
  'schedule': 'cronjob',
  'read_file': 'readFile',
  'write_file': 'writeFile',
  'execute_command': 'executeCommand',
  'run_command': 'executeCommand',
  'executeShellCommand': 'executeCommand',
  'execute_shell_command': 'executeCommand',
  'shell': 'executeCommand',
  'bash': 'executeCommand',
  'terminal': 'executeCommand',
  'system_get_accessibility_tree': 'computerInspect',
  'get_accessibility_tree': 'computerInspect',
  'accessibility_tree': 'computerInspect',
  'accessibilityTree': 'computerInspect',
  'capture_desktop_screenshot': 'computerInspect',
  'system_capture_desktop_screenshot': 'computerInspect',
  'get_display_resolution': 'computerInspect',
  'system_get_display_resolution': 'computerInspect',
  'list_open_windows': 'computerInspect',
  'system_list_open_windows': 'computerInspect',
  'find_window': 'computerInspect',
  'find_windows': 'computerInspect',
  'list_windows': 'computerInspect',
  'get_windows': 'computerInspect',
  'focus_window': 'computerManageWindow',
  'manage_window': 'computerManageWindow',
  'computer_inspect': 'computerInspect',
  'computer_interact': 'computerInteract',
  'computer_manage_window': 'computerManageWindow',
  'routine_manage': 'routineManage',
  'manage_routine': 'routineManage',
  'create_routine': 'routineManage',
  'list_routines': 'routineManage',
  'schedule_routine': 'routineManage',
  'routine': 'routineManage',
  'routines': 'routineManage',
  'routineManageTool': 'routineManage',
  'workflow_learn': 'workflowLearn',
  'learn_workflow': 'workflowLearn',
  'skillManage': 'skill_manage',
  'agent_delegate': 'agentDelegate',
  'agentDelegateTool': 'agentDelegate',
  'delegate_agent': 'agentDelegate',
  'delegateAgent': 'agentDelegate',
  'agent_message_send': 'agentMessageSend',
  'agent_mailbox_check': 'agentMailboxCheck',
  'webhook_manage': 'webhookManage',
  'manage_webhook': 'webhookManage',
  'register_webhook': 'webhookManage',
  'proactive_heartbeat_config': 'proactiveHeartbeatConfig',
  'heartbeat_config': 'proactiveHeartbeatConfig',
  'event_replay': 'eventReplay',
  'replay_event': 'eventReplay'
};

export class Agent {
  private provider: LLMProvider;
  private config: AgentConfig;
  private soul: string = '';
  private agentProfile: AgentProfile | null = null;
  private activeWorkspace: Workspace | null = null;
  private memory: EpisodicMemory | null = null;
  private procedural: ProceduralMemory | null = null;
  private toolExecutor: ToolExecutor = new ToolExecutor();

  public getAgentProfile(): AgentProfile | null {
    return this.agentProfile;
  }

  public getActiveWorkspace(): Workspace | null {
    return this.activeWorkspace;
  }

  /**
   * Switch the active workspace. Rebinds memory retrieval and the
   * PolicyEngine filesystem boundary, and records a new profile version.
   */
  public async setActiveWorkspace(workspaceId: number | null): Promise<void> {
    if (!this.memory || !this.agentProfile) {
      throw new Error('Identity must be initialized before switching workspaces.');
    }
    const agentStore = this.memory.getAgentStore();
    const workspaceStore = this.memory.getWorkspaceStore();
    if (!agentStore || !workspaceStore) {
      throw new Error('Identity stores are not initialized.');
    }
    if (workspaceId !== null) {
      const workspace = await workspaceStore.get(workspaceId);
      if (!workspace) {
        throw new Error(`Workspace ${workspaceId} not found.`);
      }
      this.activeWorkspace = workspace;
      this.getPolicyEngine().setWorkspaceRoot(workspace.rootPath);
    } else {
      this.activeWorkspace = null;
      this.getPolicyEngine().setWorkspaceRoot(process.cwd());
    }
    this.agentProfile = await agentStore.setActiveWorkspace(this.agentProfile.id, workspaceId, 'workspace-switch');
  }

  public getToolExecutor(): ToolExecutor {
    return this.toolExecutor;
  }

  public getProvider(): LLMProvider {
    return this.provider;
  }

  public setProvider(provider: LLMProvider): void {
    this.provider = provider;
  }

  public getPolicyEngine() {
    return this.toolExecutor.getPolicyEngine();
  }

  public getPromptDefense() {
    return this.toolExecutor.getPromptDefense();
  }

  public getCredentialManager() {
    return this.toolExecutor.getCredentialManager();
  }

  public getReplayer(): TrajectoryReplayer {
    if (!this.memory) {
      throw new Error('Episodic memory must be initialized before using the Trajectory Replayer.');
    }
    return new TrajectoryReplayer(this.memory);
  }

  constructor(config: AgentConfig) {
    this.config = config;
    this.provider = createLLMProvider(config.provider, {
      apiKey: config.provider === 'nvidia' ? config.nvidiaApiKey : undefined,
      baseUrl: config.provider === 'nvidia' ? config.nvidiaBaseUrl : undefined,
      enableFallback: config.enableFallback,
      fallbackApiKey: config.fallbackApiKey || (config.provider === 'gemini' ? config.nvidiaApiKey : undefined)
    });
  }


  private waitingEngine: WaitingEngine | null = null;

  public getWaitingEngine(): WaitingEngine | null {
    return this.waitingEngine;
  }

  public async createGoal(params: {
    title: string;
    description?: string;
    priority?: GoalPriority;
    workspaceId?: number | null;
    projectId?: number | null;
    budget?: GoalBudget;
    deadline?: number | null;
    metadata?: Record<string, any>;
  }): Promise<Goal> {
    if (!this.memory) throw new Error('Database must be initialized.');
    const goalStore = this.memory.getGoalStore();
    if (!goalStore) throw new Error('GoalStore is not initialized.');

    const goalId = `goal_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const goal: Goal = {
      id: goalId,
      workspaceId: params.workspaceId !== undefined ? params.workspaceId : (this.activeWorkspace?.id ?? null),
      projectId: params.projectId !== undefined ? params.projectId : null,
      title: params.title,
      description: params.description,
      status: 'proposed',
      priority: params.priority || 'normal',
      deadline: params.deadline || null,
      progress: 0.0,
      dependencies: [],
      artifacts: [],
      budget: params.budget || {},
      usage: createInitialGoalUsage(),
      metadata: params.metadata,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    return goalStore.save(goal);
  }

  public async getGoal(goalId: string): Promise<Goal | null> {
    if (!this.memory) return null;
    const goalStore = this.memory.getGoalStore();
    return goalStore ? goalStore.get(goalId) : null;
  }

  public async listGoals(filter?: { workspaceId?: number; status?: GoalStatus; limit?: number }): Promise<Goal[]> {
    if (!this.memory) return [];
    const goalStore = this.memory.getGoalStore();
    return goalStore ? goalStore.list(filter) : [];
  }

  public async planGoal(goalId: string): Promise<Task[]> {
    if (!this.memory) throw new Error('Database must be initialized.');
    const goalStore = this.memory.getGoalStore();
    const taskStore = this.memory.getTaskStore();
    if (!goalStore || !taskStore) throw new Error('Stores are not initialized.');

    const goal = await goalStore.get(goalId);
    if (!goal) throw new Error(`Goal "${goalId}" not found.`);

    const tasks = await Planner.planGoalToTasks(goal, taskStore);
    await goalStore.update(goalId, { status: 'active' });
    return tasks;
  }

  public async executeGoal(
    goalId: string,
    options?: Partial<RunOptions>
  ): Promise<{ goal: Goal; tasks: Task[]; results: Record<string, string> }> {
    if (!this.memory) throw new Error('Database must be initialized.');
    const goalStore = this.memory.getGoalStore();
    const taskStore = this.memory.getTaskStore();
    if (!goalStore || !taskStore) throw new Error('Stores are not initialized.');

    let goal = await goalStore.get(goalId);
    if (!goal) throw new Error(`Goal "${goalId}" not found.`);

    let tasks = await taskStore.listByGoal(goalId);
    if (tasks.length === 0) {
      tasks = await this.planGoal(goalId);
    }

    const results: Record<string, string> = {};

    return TelemetryManager.getInstance().startGoalSpan(
      { id: goal.id, title: goal.title },
      async () => {
        while (true) {
          const readyTasks = await taskStore.getReadyTasks(goalId);
          if (readyTasks.length === 0) break;

          for (const task of readyTasks) {
            await taskStore.update(task.id, { status: 'in_progress', attempts: task.attempts + 1 });

            try {
              const taskResult = await TelemetryManager.getInstance().startTaskSpan(
                { id: task.id, goalId: goal!.id, title: task.title },
                async () => {
                  return this.run(task.title, [], {
                    goalId: goal!.id,
                    taskId: task.id,
                    ...options
                  });
                }
              );

              await taskStore.update(task.id, {
                status: 'completed',
                result: taskResult
              });
              results[task.id] = taskResult;
            } catch (err: any) {
              await taskStore.update(task.id, {
                status: 'failed',
                error: err.message
              });
              throw err;
            }
          }
        }

        const allTasks = await taskStore.listByGoal(goalId);
        const allCompleted = allTasks.every(t => t.status === 'completed');
        const anyFailed = allTasks.some(t => t.status === 'failed');

        const finalStatus: GoalStatus = anyFailed ? 'failed' : (allCompleted ? 'completed' : 'active');
        const updatedGoal = await goalStore.update(goalId, {
          status: finalStatus,
          progress: allCompleted ? 1.0 : (allTasks.filter(t => t.status === 'completed').length / Math.max(1, allTasks.length))
        });

        return {
          goal: updatedGoal,
          tasks: allTasks,
          results
        };
      }
    );
  }

  public async parkRun(runId: string, params: {
    waitType: WaitType;
    eventPattern?: string | null;
    matcherCriteria?: Record<string, any> | null;
    deadline?: number | null;
    metadata?: Record<string, any> | null;
  }): Promise<RunWait> {
    if (!this.waitingEngine) {
      throw new Error('WaitingEngine is not initialized.');
    }
    return this.waitingEngine.parkRun({
      runId,
      waitType: params.waitType,
      eventPattern: params.eventPattern,
      matcherCriteria: params.matcherCriteria,
      deadline: params.deadline,
      metadata: params.metadata
    });
  }

  private async initPersistentAutonomy(): Promise<void> {
    if (!this.memory) return;
    const runStore = this.memory.getRunStore();
    const waitStore = this.memory.getRunWaitStore();

    if (runStore) {
      try {
        const sweeper = new CrashResumeSweeper(runStore);
        await sweeper.sweep();
      } catch (err: any) {
        console.warn(`[Agent Warning] Crash recovery sweep failed: ${err.message}`);
      }
    }

    if (runStore && waitStore) {
      const bus = EventBus.getInstance();
      if (this.memory) bus.setMemory(this.memory);
      this.waitingEngine = new WaitingEngine(
        waitStore,
        runStore,
        bus
      );
    }
  }

  // Load the soul persona from file system
  async init() {
    const skillsPath = this.config.skillsPath || './skills';
    this.procedural = new ProceduralMemory(path.resolve(skillsPath));

    if (this.config.soulPath) {
        try {
          const resolvedPath = path.resolve(this.config.soulPath);
          this.soul = await fs.readFile(resolvedPath, 'utf-8');
        } catch (err: any) {
          console.warn(`[Agent Warning] Failed to load SOUL.md from ${this.config.soulPath}: ${err.message}`);
        }
      }
      if (this.config.memory) {
        this.memory = this.config.memory;
        await this.initIdentity();
      } else if (this.config.dbPath) {
        try {
          const resolvedPath = path.resolve(this.config.dbPath);
          this.memory = new EpisodicMemory(resolvedPath);
          await this.memory.init();
          await this.initIdentity();
          await this.initPersistentAutonomy();
          // Initialize P5 Learning: Progressive Skills & Routine Engine
          const psm = this.memory.getProgressiveSkillManager(path.resolve(skillsPath));
          await psm.init();
          const routineEngine = this.memory.getRoutineEngine();
          await routineEngine.start();
        } catch (err: any) {
          console.warn(`[Agent Warning] Failed to initialize SQLite database at ${this.config.dbPath}: ${err.message}`);
        }
      }
    }

  /**
   * Load or seed the persistent AgentProfile and the default user.
   * Identity is rendered from the stored profile, not re-read as the
   * source of truth, so it survives model and tool changes.
   */
  private async initIdentity(): Promise<void> {
    if (!this.memory) return;
    const agentStore = this.memory.getAgentStore();
    const userStore = this.memory.getUserStore();
    const workspaceStore = this.memory.getWorkspaceStore();
    if (!agentStore || !userStore || !workspaceStore) return;

    try {
      let profile = await agentStore.get(DEFAULT_PROFILE_ID);
      if (!profile) profile = await agentStore.getByName('Athena');
      if (!profile) {
        const soulSeed = this.soul && this.soul.trim().length > 0
          ? this.soul
          : 'You are Athena, an intelligent local AI assistant running natively on the user\'s host system.';
        profile = await agentStore.save(seedAgentProfileFromSoul(soulSeed), 'seed');
      }
      this.agentProfile = profile;
      this.soul = renderProfileSoul(profile);

      let user = await userStore.get(DEFAULT_USER_ID);
      if (!user) user = await userStore.save(createDefaultUser());

      const composed = composePermissionModels(profile.permissions, user.permissions);
      this.getPolicyEngine().setPermissionModel(isEmptyPermissionModel(composed) ? null : composed);

      if (profile.workspaceId !== null) {
        const workspace = await workspaceStore.get(profile.workspaceId);
        if (workspace) {
          this.activeWorkspace = workspace;
          this.getPolicyEngine().setWorkspaceRoot(workspace.rootPath);
        } else {
          console.warn(`[Agent Warning] Profile workspace ${profile.workspaceId} not found; running cross-workspace.`);
        }
      }
    } catch (err: any) {
      console.warn(`[Agent Warning] Identity initialization failed: ${err.message}`);
    }
  }

    async run(
      userPrompt: string,
      history: Message[],
      optionsOrOnUpdate?: ((status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void) | RunOptions,
      confirm?: (toolName: string, args: any) => Promise<boolean>,
      sessionId?: string
    ): Promise<string> {
      let options: RunOptions;
      if (typeof optionsOrOnUpdate === 'function') {
        options = {
          onUpdate: optionsOrOnUpdate,
          confirm,
          sessionId
        };
      } else {
        options = { ...(optionsOrOnUpdate || {}) };
        if (confirm && !options.confirm) options.confirm = confirm;
        if (sessionId && !options.sessionId) options.sessionId = sessionId;
      }

      const activeSessionId = options.sessionId || 'default-session';
      const runId = options.runId || `run_${Math.random().toString(36).substring(2, 10)}`;
      const parentRunId = options.parentRunId;
      const rootRunId = options.rootRunId || (parentRunId ? parentRunId : runId);
      const taskId = options.runId || this.config.taskId || 'agent-run';

      options.runId = runId;
      options.parentRunId = parentRunId;
      options.rootRunId = rootRunId;

      return TelemetryManager.getInstance().startAgentTrace(
        taskId,
        {
          runId,
          parentRunId,
          rootRunId,
          sessionId: activeSessionId,
          goalId: options.goalId,
          taskId: options.taskId,
          task: userPrompt,
          modelName: this.config.modelName,
          maxTurns: this.config.maxTurns,
          depth: this.config.depth || 0,
        },
        async () => {
          return this.runInternal(userPrompt, history, options);
        }
      );
    }

    private async runInternal(
      userPrompt: string,
      history: Message[],
      options: RunOptions
    ): Promise<string> {
      const runId = options.runId || `run_${Math.random().toString(36).substring(2, 10)}`;
      const parentRunId = options.parentRunId;
      const rootRunId = options.rootRunId || (parentRunId ? parentRunId : runId);
      const sessionId = options.sessionId || 'default-session';
      const events = options.events || new AgentEventEmitter();
      const cancellationToken = options.cancellationToken;
      const onUpdate = options.onUpdate;
      const confirm = options.confirm;
      const startTime = Date.now();

      const logPrefix = this.config.taskId ? `[${this.config.taskId}] ` : '';
      const safeOnUpdate = (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => {
        if (onUpdate) {
          onUpdate({
            type: status.type,
            message: logPrefix ? `${logPrefix}${status.message}` : status.message
          });
        }
      };

      // Serialized confirmation handler to avoid interleaved confirmation requests.
      // Approvals are memoized per tool+args so the policy layer and the
      // risk-level gate do not prompt twice for the same call.
      let confirmChain = Promise.resolve();
      const approvedConfirms = new Set<string>();
      const serializedConfirm = async (toolName: string, args: any): Promise<boolean> => {
        const key = `${toolName}:${JSON.stringify(args ?? {})}`;
        if (approvedConfirms.has(key)) return true;

        let resolveConfirm: (val: boolean) => void;
        const confirmPromise = new Promise<boolean>((resolve) => {
          resolveConfirm = resolve;
        });

        confirmChain = confirmChain.then(async () => {
          if (!confirm) {
            approvedConfirms.add(key);
            resolveConfirm(true);
            return;
          }
          try {
            const approved = await confirm(toolName, args);
            if (approved) approvedConfirms.add(key);
            resolveConfirm(approved);
          } catch (err) {
            resolveConfirm(false);
          }
        });

        return confirmPromise;
      };

      // 0. Initialize or Load Authoritative RunState (Phase 1 Agent Runtime)
      let runState: RunState | null = null;
      if (this.memory) {
        try {
          runState = await this.memory.getRunState(runId);
        } catch (e) {}
      }

      if (!runState) {
        runState = createInitialRunState({
          runId,
          parentRunId,
          rootRunId,
          sessionId,
          goalId: options.goalId,
          taskId: options.taskId,
          task: userPrompt,
          budget: {
            maxTurns: this.config.maxTurns,
            ...options.budget
          }
        });
        if (this.memory) {
          try {
            await this.memory.saveRunState(runState);
          } catch (e) {}
        }
      }

      // Goal budget checking (Phase 2 Persistent Autonomy)
      let goal: Goal | null = null;
      const goalStore = this.memory?.getGoalStore();
      if (options.goalId && goalStore) {
        goal = await goalStore.get(options.goalId);
        if (goal) {
          if (['completed', 'failed', 'cancelled'].includes(goal.status)) {
            throw new Error(`Cannot run task for goal "${goal.id}" with status "${goal.status}"`);
          }
          if (
            (goal.budget.maxTurns && goal.usage.turnsCount >= goal.budget.maxTurns) ||
            (goal.budget.maxTimeMs && goal.usage.elapsedTimeMs >= goal.budget.maxTimeMs) ||
            (goal.budget.maxToolCalls && goal.usage.toolCallsCount >= goal.budget.maxToolCalls) ||
            (goal.budget.maxCostUsd && goal.usage.costUsd >= goal.budget.maxCostUsd) ||
            (goal.budget.maxTokens && goal.usage.tokens.total >= goal.budget.maxTokens)
          ) {
            await goalStore.update(goal.id, {
              status: 'failed',
              metadata: { ...goal.metadata, failureReason: 'budget_exceeded' }
            });
            runState.status = 'failed';
            runState.terminationReason = 'budget_exceeded';
            runState.error = {
              category: 'budget',
              code: 'GOAL_BUDGET_EXCEEDED',
              message: `Goal budget exhausted for "${goal.id}".`,
              retryable: false
            };
            if (this.memory) {
              await this.memory.saveRunState(runState);
            }
            throw new Error(`Goal budget exceeded for goal "${goal.id}". Execution halted.`);
          }
        }
      }

      const prevStatus = runState.status;
      runState.status = 'running';
      runState.updatedAt = Date.now();
      if (this.memory) {
        try {
          await this.memory.saveRunState(runState);
          await this.memory.saveRunEvent({
            type: 'status_change',
            runId,
            parentRunId,
            from: prevStatus,
            to: 'running',
            timestamp: Date.now()
          });
        } catch (e) {}
      }
      events.emit({
        type: 'status_change',
        runId,
        parentRunId,
        from: prevStatus,
        to: 'running',
        timestamp: Date.now()
      });

      // 1. Load Episodic History if sessionId is provided and local history is empty
      let episodicCount = 0;
      if (sessionId && this.memory && history.length === 0) {
        try {
          const dbHistory = await this.memory.loadHistory(sessionId, 40, { includeTimestamps: true });
          history.push(...dbHistory);
          episodicCount = dbHistory.length;
        } catch (err: any) {
          safeOnUpdate({ type: 'error', message: `Failed to load history from database: ${err.message}` });
        }
      }

      // 1b. Cross-session / prior-day archive (session history alone is last-N of this session)
      let episodicArchive = '';
      let archiveHits = 0;
      if (this.memory && isRecallQuery(userPrompt)) {
        try {
          const archive = await buildEpisodicArchive(this.memory, sessionId, userPrompt);
          episodicArchive = archive.text;
          archiveHits = archive.hits;
        } catch (err: any) {
          safeOnUpdate({ type: 'error', message: `Failed to load episodic archive: ${err.message}` });
        }
      }

      // 2. Assemble Context via Phase 2 ContextEngine
      const contextEngine = new ContextEngine();
      const assembled = await contextEngine.assemble({
        userPrompt,
        history,
        systemPrompt: this.config.systemPrompt,
        soul: this.soul,
        sessionId,
        memory: this.memory,
        procedural: this.procedural,
        workspaceDir: this.activeWorkspace ? this.activeWorkspace.rootPath : undefined,
        workspaceId: this.agentProfile && this.agentProfile.workspaceId !== null ? this.agentProfile.workspaceId : undefined,
        agentId: this.agentProfile ? this.agentProfile.id : undefined
      });

      let systemInstruction = assembled.systemInstruction;
      if (episodicArchive) {
        systemInstruction = `${systemInstruction}\n\n[EPISODIC ARCHIVE]\n${episodicArchive}`;
      }

      // Memory event reporting with provenance, confidence, and token estimates
      const factDetails = assembled.includedFacts.map(f => `"${f.fact}" [${f.scope}, conf: ${(f.confidence * 100).toFixed(0)}%]`).join(', ') || 'none';
      const skillDetails = assembled.includedSkills.map(s => s.name).join(', ') || 'none';
      safeOnUpdate({
        type: 'memory',
        message: `Memory retrieved:\n` +
                `  - Episodic: ${episodicCount > 0 ? `loaded ${episodicCount} past turns for session` : `using ${history.length} turns in memory`}` +
                (archiveHits > 0 ? `; archive matched ${archiveHits} prior messages.\n` : '.\n') +
                `  - Scoped Facts: matched ${assembled.includedFacts.length} facts (${factDetails})\n` +
                `  - Procedural: matched ${assembled.includedSkills.length} skills (${skillDetails})\n` +
                `  - Context Tokens: ~${assembled.tokenEstimate.total} (system: ${assembled.tokenEstimate.system}, memory: ${assembled.tokenEstimate.memory}, skills: ${assembled.tokenEstimate.skills})`
      });

      // 6. Prepare the session messages
      // Working Memory = User Prompt + Chat History + System Prompt
      const currentRunHistory: Message[] = [...history];
      
      // Add the new user message to current run context
      currentRunHistory.push({
        role: 'user',
        parts: [{ text: userPrompt }]
      });

      const allAllowedTools = Array.from(toolsRegistry.values())
        .filter(tool => !this.config.allowedTools || this.config.allowedTools.includes(tool.definition.name));
      const recentContext = history.slice(-4)
        .map(m => m.parts?.map((p: any) => p.text || '').join(' ') || '')
        .join(' ');
      const activeTools = ToolSelector.selectRelevantTools(userPrompt, allAllowedTools, recentContext, {
        policyEngine: this.getPolicyEngine(),
        isBackground: options?.isBackground
      });
      const functionDeclarations = activeTools.map(tool => cleanGeminiSchema(tool.definition, true));

      // Adaptive Orchestration: classify task complexity and initialize plan if complex
      const classification = TaskClassifier.classify(userPrompt);
      let activeComplexity = classification.complexity;
      const escalator = new DynamicEscalator(activeComplexity);

      let executionPlan: ExecutionPlan | null = null;
      if (activeComplexity === 'complex') {
        executionPlan = Planner.decomposeGoal(userPrompt);
        events.emit({
          type: 'plan_created',
          runId,
          parentRunId,
          planId: executionPlan.planId,
          goal: executionPlan.goal,
          totalSteps: executionPlan.steps.length,
          steps: executionPlan.steps.map(s => ({
            stepId: s.stepId,
            description: s.description,
            dependencies: s.dependencies,
            acceptanceCriteria: s.acceptanceCriteria
          })),
          timestamp: Date.now()
        });
        safeOnUpdate({
          type: 'thought',
          message: `[Orchestrator] Complex task identified. Formulated plan with ${executionPlan.steps.length} steps: ${executionPlan.steps.map(s => s.description).join(' ➔ ')}`
        });
      }

      let currentMaxTurns = runState.budget.maxTurns || (classification.suggestedMaxTurns ? Math.max(this.config.maxTurns, classification.suggestedMaxTurns) : this.config.maxTurns);
      let turns = 0;
      let emptyResponseCount = 0;
      while (turns < currentMaxTurns) {
        turns++;
        runState.currentTurn = turns;
        runState.usage.turnsCount = turns;
        runState.usage.elapsedTimeMs = Date.now() - startTime;

        // Check goal budget constraints before executing the turn
        if (goal && (
          (goal.budget.maxTurns && (goal.usage.turnsCount + turns) > goal.budget.maxTurns) ||
          (goal.budget.maxTimeMs && (goal.usage.elapsedTimeMs + (Date.now() - startTime)) > goal.budget.maxTimeMs)
        )) {
          runState.status = 'failed';
          runState.terminationReason = 'budget_exceeded';
          runState.error = {
            category: 'budget',
            code: 'GOAL_BUDGET_EXCEEDED',
            message: `Goal budget exceeded (${goal.usage.turnsCount + turns} turns / ${goal.usage.elapsedTimeMs + (Date.now() - startTime)}ms).`,
            retryable: false
          };
          runState.updatedAt = Date.now();
          if (this.memory) {
            try {
              await this.memory.saveRunState(runState);
            } catch (e) {}
          }
          if (goalStore) {
            await goalStore.update(goal.id, {
              status: 'failed',
              usage: {
                ...goal.usage,
                turnsCount: goal.usage.turnsCount + turns,
                elapsedTimeMs: goal.usage.elapsedTimeMs + (Date.now() - startTime)
              }
            });
          }
          throw new Error(`Goal budget exceeded for goal "${goal.id}". Execution halted.`);
        }

        // Check cancellation token before every turn
        if (cancellationToken?.isCancelled) {
          runState.status = 'cancelled';
          runState.terminationReason = 'user_cancelled';
          runState.error = {
            category: 'policy',
            code: 'CANCELLED',
            message: cancellationToken.reason || 'Operation cancelled by user/parent request.',
            retryable: false
          };
          runState.updatedAt = Date.now();
          if (this.memory) {
            try {
              await this.memory.saveRunState(runState);
              await this.memory.saveRunEvent({
                type: 'status_change',
                runId,
                parentRunId,
                from: 'running',
                to: 'cancelled',
                timestamp: Date.now()
              });
              await this.memory.saveRunEvent({
                type: 'completed',
                runId,
                parentRunId,
                status: 'cancelled',
                terminationReason: 'user_cancelled',
                timestamp: Date.now()
              });
            } catch (e) {}
          }
          events.emit({
            type: 'status_change',
            runId,
            parentRunId,
            from: 'running',
            to: 'cancelled',
            timestamp: Date.now()
          });
          events.emit({
            type: 'completed',
            runId,
            parentRunId,
            status: 'cancelled',
            terminationReason: 'user_cancelled',
            timestamp: Date.now()
          });
          const cancelErr = new Error(runState.error.message);
          cancelErr.name = 'CancellationError';
          throw cancelErr;
        }

        // Check time budget
        const elapsed = Date.now() - startTime;
        if (runState.budget.maxTimeMs && elapsed > runState.budget.maxTimeMs) {
          runState.status = 'failed';
          runState.terminationReason = 'timeout';
          runState.error = {
            category: 'timeout',
            code: 'TIME_BUDGET_EXCEEDED',
            message: `Execution time (${elapsed}ms) exceeded maximum time budget (${runState.budget.maxTimeMs}ms).`,
            retryable: false
          };
          runState.updatedAt = Date.now();
          if (this.memory) {
            try {
              await this.memory.saveRunState(runState);
            } catch (e) {}
          }
          events.emit({
            type: 'completed',
            runId,
            parentRunId,
            status: 'failed',
            terminationReason: 'timeout',
            timestamp: Date.now()
          });
          const timeoutMsg = `[Budget Alert] Execution time limit (${runState.budget.maxTimeMs}ms) exceeded. Stopping run.`;
          safeOnUpdate({ type: 'error', message: timeoutMsg });
          return timeoutMsg;
        }

        // Check tool call budget
        if (runState.budget.maxToolCalls !== undefined && runState.usage.toolCallsCount >= runState.budget.maxToolCalls) {
          runState.status = 'failed';
          runState.terminationReason = 'budget_exceeded';
          runState.error = {
            category: 'budget',
            code: 'TOOL_BUDGET_EXCEEDED',
            message: `Tool call count (${runState.usage.toolCallsCount}) reached budget limit (${runState.budget.maxToolCalls}).`,
            retryable: false
          };
          runState.updatedAt = Date.now();
          if (this.memory) {
            try {
              await this.memory.saveRunState(runState);
            } catch (e) {}
          }
          events.emit({
            type: 'completed',
            runId,
            parentRunId,
            status: 'failed',
            terminationReason: 'budget_exceeded',
            timestamp: Date.now()
          });
          const toolBudgetMsg = `[Budget Alert] Max tool calls (${runState.budget.maxToolCalls}) reached. Stopping run.`;
          safeOnUpdate({ type: 'error', message: toolBudgetMsg });
          return toolBudgetMsg;
        }

        events.emit({
          type: 'turn_start',
          runId,
          parentRunId,
          turn: turns,
          maxTurns: currentMaxTurns,
          timestamp: Date.now()
        });

        pruneBrowserHistory(currentRunHistory);
        
        try {
          safeOnUpdate({ type: 'thought', message: `Thinking (Turn ${turns}/${currentMaxTurns})...` });

          // Call Provider API wrapped in a Telemetry generation span
          const response: LLMResponse = await TelemetryManager.getInstance().startGenerationSpan(
            `llm-generation-turn-${turns}`,
            {
              model: this.config.modelName,
              turn: turns,
              runId,
              sessionId,
              input: currentRunHistory
            },
            async (generation) => {
              generation.update({
                input: JSON.stringify(currentRunHistory),
                model: this.config.modelName,
              });

              const res = await this.provider.generateContent({
                model: this.config.modelName,
                systemInstruction,
                messages: currentRunHistory,
                tools: functionDeclarations,
              });

              generation.update({
                output: JSON.stringify(res.parts || {}),
                usageDetails: res.usageMetadata,
              });

              if (res.usageMetadata) {
                const inT = res.usageMetadata.input || 0;
                const outT = res.usageMetadata.output || 0;
                const totT = res.usageMetadata.total || (inT + outT);
                runState!.usage.tokens.input += inT;
                runState!.usage.tokens.output += outT;
                runState!.usage.tokens.total += totT;
              }

              return res;
            }
          );

          // Add model response to history
          const parts = response.parts || (response.text ? [{ text: response.text }] : []);
          if (parts.length === 0 && (!response.functionCalls || response.functionCalls.length === 0)) {
            const finishReason = response.finishReason || 'EMPTY_RESPONSE';
            safeOnUpdate({
              type: 'error',
              message: `Model returned empty content (Finish Reason: ${finishReason}). Prompting model to execute step-by-step...`
            });
            emptyResponseCount++;
            if (emptyResponseCount > 2) {
              throw new Error(`Model returned an empty response repeatedly (Finish Reason: ${finishReason}).`);
            }
            currentRunHistory.push({
              role: 'user',
              parts: [{ text: `[System Notice]: Your previous response was empty (Finish Reason: ${finishReason}), which occurs when attempting to generate too many tool calls in one turn. Please proceed step-by-step, executing no more than 3-4 tool calls per turn.` }]
            });
            continue;
          }
          emptyResponseCount = 0;

          // Keep the model's message in the current run history
          currentRunHistory.push({
            role: 'model',
            parts: parts as Part[]
          });

          // Check for function calls
          const functionCalls = response.functionCalls;
          if (functionCalls && functionCalls.length > 0) {
            if (runState.budget.maxToolCalls !== undefined && runState.usage.toolCallsCount >= runState.budget.maxToolCalls) {
              runState.status = 'failed';
              runState.terminationReason = 'budget_exceeded';
              runState.error = {
                category: 'budget',
                code: 'TOOL_BUDGET_EXCEEDED',
                message: `Tool call count (${runState.usage.toolCallsCount}) reached budget limit (${runState.budget.maxToolCalls}).`,
                retryable: false
              };
              runState.updatedAt = Date.now();
              if (this.memory) {
                try {
                  await this.memory.saveRunState(runState);
                } catch (e) {}
              }
              events.emit({
                type: 'completed',
                runId,
                parentRunId,
                status: 'failed',
                terminationReason: 'budget_exceeded',
                timestamp: Date.now()
              });
              const toolBudgetMsg = `[Budget Alert] Max tool calls (${runState.budget.maxToolCalls}) reached. Stopping run.`;
              safeOnUpdate({ type: 'error', message: toolBudgetMsg });
              return toolBudgetMsg;
            }

            // Model wants to call tools concurrently
            const toolResponseParts: Part[] = new Array(functionCalls.length);

            const tasks = functionCalls.map((call, idx) => async () => {
              if (!call.name) {
                toolResponseParts[idx] = {
                  functionResponse: {
                    id: call.id,
                    name: '',
                    response: { success: false, error: 'Empty function call name.' }
                  }
                };
                return;
              }

              safeOnUpdate({
                type: 'tool_call',
                message: `Calling tool: ${call.name} with args: ${JSON.stringify(call.args)}`
              });

              // Enforce tool scoping with alias resolution
              const canonicalName = TOOL_ALIASES[call.name] || call.name;
              const isAllowed = !this.config.allowedTools || this.config.allowedTools.includes(canonicalName);
              const tool = isAllowed ? toolsRegistry.get(canonicalName) : null;
              if (!tool) {
                const errMsg = !isAllowed
                  ? `Tool "${call.name}" is not permitted for this agent run.`
                  : `Tool "${call.name}" not found in registry.`;
                safeOnUpdate({ type: 'error', message: errMsg });
                toolResponseParts[idx] = {
                  functionResponse: {
                    id: call.id,
                    name: call.name,
                    response: { success: false, error: errMsg }
                  }
                };
                return;
              }

              // Dynamically increase turns if a browser tool is executed
              if (call.name === 'browserNavigate' || call.name === 'browserAction') {
                currentMaxTurns = Math.max(currentMaxTurns, 25);
              }

              const manifest = this.toolExecutor.resolveManifest(tool);

              // Check for confirmation for risky actions
              if (manifest.riskLevel === 'confirm' || manifest.riskLevel === 'destructive' || tool.requiresConfirmation) {
                const silent = !confirm || (confirm as any).silent;
                if (!silent) {
                  safeOnUpdate({
                    type: 'thought',
                    message: `Tool "${call.name}" [${manifest.riskLevel}] requires confirmation. Awaiting user response...`
                  });
                }
                try {
                  const isApproved = await serializedConfirm(call.name, call.args);
                  if (!isApproved) {
                    const deniedMsg = `Permission denied by user for tool: ${call.name}`;
                    safeOnUpdate({ type: 'error', message: deniedMsg });
                    toolResponseParts[idx] = {
                      functionResponse: {
                        id: call.id,
                        name: call.name,
                        response: { success: false, error: 'Permission denied by user.' }
                      }
                    };
                    return;
                  }
                } catch (confirmErr: any) {
                  const errMsg = `Confirmation process failed: ${confirmErr.message}`;
                  safeOnUpdate({ type: 'error', message: errMsg });
                  toolResponseParts[idx] = {
                    functionResponse: {
                      id: call.id,
                      name: call.name,
                      response: { success: false, error: errMsg }
                    }
                  };
                  return;
                }
              }

              // Idempotency check for tool execution
              const idempotencyKey = call.args?.idempotencyKey || `${call.name}:${JSON.stringify(call.args)}`;
              if (runState!.idempotencyKeys.includes(idempotencyKey)) {
                safeOnUpdate({
                  type: 'tool_call',
                  message: `[Idempotent Replay] Skipping repeated tool "${call.name}" with idempotencyKey "${idempotencyKey}"`
                });
                toolResponseParts[idx] = {
                  functionResponse: {
                    id: call.id,
                    name: call.name,
                    response: { success: true, idempotent: true, note: 'Skipped repeated execution via idempotency key.' }
                  }
                };
                return;
              }

              events.emit({
                type: 'tool_call',
                runId,
                parentRunId,
                turn: turns,
                callId: call.id,
                toolName: call.name,
                args: call.args,
                idempotencyKey,
                timestamp: Date.now()
              });

              try {
                const toolContext = {
                  confirm: serializedConfirm,
                  memory: this.memory || undefined,
                  depth: this.config.depth || 0,
                  runId,
                  parentRunId: runId,
                  rootRunId,
                  goalId: options.goalId,
                  taskId: options.taskId,
                  isBackground: options.isBackground,
                  cancellationToken,
                  budget: runState!.budget,
                  events,
                  idempotencyKey,
                  onUpdate: safeOnUpdate,
                  provider: this.config.provider,
                  modelName: this.config.modelName,
                  nvidiaApiKey: this.config.nvidiaApiKey,
                  nvidiaBaseUrl: this.config.nvidiaBaseUrl
                };

                const toolStartTime = Date.now();
                const toolResult: ToolResult = await startActiveObservation(
                  `tool-${call.name}`,
                  async (toolSpan) => {
                    toolSpan.update({
                      input: JSON.stringify(call.args),
                    });

                    const res = await this.toolExecutor.execute(tool, call.args, toolContext);

                    toolSpan.update({
                      output: JSON.stringify(res),
                    });

                    return res;
                  }
                );
                const toolDuration = Date.now() - toolStartTime;

                runState!.idempotencyKeys.push(idempotencyKey);
                runState!.usage.toolCallsCount++;

                escalator.recordToolResult(toolResult.success);

                // Check dynamic escalation
                const escalationCheck = escalator.shouldEscalate(turns);
                if (escalationCheck.escalate && escalationCheck.targetComplexity) {
                  const fromComplexity = activeComplexity;
                  activeComplexity = escalationCheck.targetComplexity;
                  escalator.escalate(activeComplexity);
                  events.emit({
                    type: 'escalation',
                    runId,
                    parentRunId,
                    fromComplexity,
                    toComplexity: activeComplexity,
                    reason: escalationCheck.reason || 'Dynamic escalation triggered.',
                    timestamp: Date.now()
                  });
                  safeOnUpdate({
                    type: 'thought',
                    message: `[Escalation] ${escalationCheck.reason}`
                  });
                  if (activeComplexity === 'complex' && !executionPlan) {
                    executionPlan = Planner.decomposeGoal(userPrompt);
                    events.emit({
                      type: 'plan_created',
                      runId,
                      parentRunId,
                      planId: executionPlan.planId,
                      goal: executionPlan.goal,
                      totalSteps: executionPlan.steps.length,
                      steps: executionPlan.steps.map(s => ({
                        stepId: s.stepId,
                        description: s.description,
                        dependencies: s.dependencies,
                        acceptanceCriteria: s.acceptanceCriteria
                      })),
                      timestamp: Date.now()
                    });
                  }
                }

                if (executionPlan) {
                  const pendingSteps = Planner.getExecutableSteps(executionPlan);
                  if (pendingSteps.length > 0) {
                    const step = pendingSteps[0];
                    step.status = 'completed';
                    events.emit({
                      type: 'plan_step_update',
                      runId,
                      parentRunId,
                      planId: executionPlan.planId,
                      stepId: step.stepId,
                      status: 'completed',
                      timestamp: Date.now()
                    });
                  }
                }

                events.emit({
                  type: 'tool_result',
                  runId,
                  parentRunId,
                  turn: turns,
                  callId: call.id,
                  toolName: call.name,
                  success: toolResult.success,
                  result: toolResult.data,
                  error: toolResult.error?.message,
                  durationMs: toolDuration,
                  timestamp: Date.now()
                });

                safeOnUpdate({
                  type: toolResult.success ? 'tool_response' : 'error',
                  message: toolResult.success
                    ? (toolResult.metadata?.truncated
                        ? `Tool ${call.name} output offloaded to disk: ${toolResult.metadata.artifactPath}`
                        : `Tool ${call.name} returned: ${JSON.stringify(toolResult.data)}`)
                    : `Tool ${call.name} failed: ${toolResult.error?.message}`
                });

                toolResponseParts[idx] = {
                  functionResponse: {
                    id: call.id,
                    name: call.name,
                    response: toolResult.success
                      ? (toolResult.data ?? { success: true })
                      : { success: false, error: toolResult.error?.message, code: toolResult.error?.code }
                  }
                };
              } catch (toolErr: any) {
                const errMsg = `Tool ${call.name} execution failed: ${toolErr.message}`;
                events.emit({
                  type: 'tool_result',
                  runId,
                  parentRunId,
                  turn: turns,
                  callId: call.id,
                  toolName: call.name,
                  success: false,
                  error: errMsg,
                  durationMs: 0,
                  timestamp: Date.now()
                });
                safeOnUpdate({ type: 'error', message: errMsg });
                toolResponseParts[idx] = {
                  functionResponse: {
                    id: call.id,
                    name: call.name,
                    response: { success: false, error: errMsg }
                  }
                };
              }
            });
            await runWithConcurrencyLimit(tasks, 3);

            // Push the tool responses back to the model as a user role message
            currentRunHistory.push({
              role: 'user',
              parts: toolResponseParts.filter(Boolean)
            });
            continue;
          }

          // No function calls, this is the final answer!
          const text = response.text || '';

          // Adaptive Verification Gate & Self-Repair Loop
          if (classification.requiresVerification || activeComplexity === 'complex' || activeComplexity === 'high_risk') {
            const verification = VerificationGate.verify(userPrompt, text);
            events.emit({
              type: 'verification',
              runId,
              parentRunId,
              passed: verification.passed,
              reasoning: verification.reasoning,
              issues: verification.issues,
              timestamp: Date.now()
            });

            if (!verification.passed && turns < currentMaxTurns - 1) {
              events.emit({
                type: 'repair_attempt',
                runId,
                parentRunId,
                attempt: 1,
                maxAttempts: 2,
                issues: verification.issues,
                repairAction: 'Initiating diagnostic self-repair loop with acceptance feedback.',
                timestamp: Date.now()
              });
              safeOnUpdate({
                type: 'thought',
                message: `[Self-Repair] Verification gate flagged: ${verification.issues.join(', ')}. Engaging self-repair loop...`
              });
              currentRunHistory.push({
                role: 'user',
                parts: [{
                  text: `[Verification Diagnostic]: Acceptance criteria check indicated issues:\n${verification.issues.map(i => `- ${i}`).join('\n')}\nPlease revise and fix these specific deficiencies before concluding.`
                }]
              });
              continue;
            }
          }

          if (executionPlan) {
            executionPlan.status = 'completed';
            for (const step of executionPlan.steps) {
              if (step.status === 'pending' || step.status === 'in_progress') {
                step.status = 'completed';
                events.emit({
                  type: 'plan_step_update',
                  runId,
                  parentRunId,
                  planId: executionPlan.planId,
                  stepId: step.stepId,
                  status: 'completed',
                  timestamp: Date.now()
                });
              }
            }
          }

          // Push the user prompt and final model response to the persistent history
          history.push({
            role: 'user',
            parts: [{ text: userPrompt }]
          });
          history.push({
            role: 'model',
            parts: [{ text }]
          });

          // Save to SQLite database if sessionId is provided and database is active
          if (sessionId && this.memory) {
            try {
              await this.memory.saveMessage(sessionId, 'user', [{ text: userPrompt }]);
              await this.memory.saveMessage(sessionId, 'model', [{ text }]);
            } catch (err: any) {
              safeOnUpdate({ type: 'error', message: `Failed to save message to database: ${err.message}` });
            }
          }

          // Trigger background consolidation check
          this.triggerBackgroundConsolidation().catch(err => {
            console.error('[Agent Consolidation Error]', err);
          });

          // Finalize RunState on success
          runState.status = 'completed';
          runState.terminationReason = 'goal_achieved';
          runState.result = text;
          runState.currentTurn = turns;
          runState.usage.turnsCount = turns;
          runState.usage.elapsedTimeMs = Date.now() - startTime;
          runState.updatedAt = Date.now();
          if (goal && goalStore) {
            try {
              const currentGoal = await goalStore.get(goal.id);
              if (currentGoal) {
                await goalStore.update(goal.id, {
                  usage: {
                    elapsedTimeMs: currentGoal.usage.elapsedTimeMs + (Date.now() - startTime),
                    tokens: {
                      input: currentGoal.usage.tokens.input + runState.usage.tokens.input,
                      output: currentGoal.usage.tokens.output + runState.usage.tokens.output,
                      total: currentGoal.usage.tokens.total + runState.usage.tokens.total
                    },
                    costUsd: currentGoal.usage.costUsd + runState.usage.costUsd,
                    toolCallsCount: currentGoal.usage.toolCallsCount + runState.usage.toolCallsCount,
                    turnsCount: currentGoal.usage.turnsCount + turns
                  },
                  status: currentGoal.status === 'proposed' ? 'active' : currentGoal.status
                });
              }
            } catch (e) {}
          }
          if (this.memory) {
            try {
              await this.memory.saveRunState(runState);
              await this.memory.saveRunEvent({
                type: 'completed',
                runId,
                parentRunId,
                status: 'completed',
                terminationReason: 'goal_achieved',
                result: text,
                timestamp: Date.now()
              });
            } catch (e) {}
          }
          events.emit({
            type: 'completed',
            runId,
            parentRunId,
            status: 'completed',
            terminationReason: 'goal_achieved',
            result: text,
            timestamp: Date.now()
          });

          return text;

        } catch (err: any) {
          safeOnUpdate({ type: 'error', message: `API call failed: ${err.message}` });
          throw err;
        }
      }

      // If we exit the loop because we hit the maxTurns limit
      const warningText = `[Guardrail Alert] Max iterations (${currentMaxTurns}) reached. Stopping run.`;
      safeOnUpdate({ type: 'error', message: warningText });
      
      // Add warning as final model turn so the user sees it
      history.push({
        role: 'user',
        parts: [{ text: userPrompt }]
      });
      history.push({
        role: 'model',
        parts: [{ text: warningText }]
      });

      // Save to SQLite database if sessionId is provided and database is active
      if (sessionId && this.memory) {
        try {
          await this.memory.saveMessage(sessionId, 'user', [{ text: userPrompt }]);
          await this.memory.saveMessage(sessionId, 'model', [{ text: warningText }]);
        } catch (err: any) {
          safeOnUpdate({ type: 'error', message: `Failed to save guardrail alert to database: ${err.message}` });
        }
      }

      // Finalize RunState on max turns failure
      runState.status = 'failed';
      runState.terminationReason = 'max_turns';
      runState.error = {
        category: 'budget',
        code: 'MAX_TURNS_EXCEEDED',
        message: `Max turns (${currentMaxTurns}) reached without reaching goal.`,
        retryable: true
      };
      runState.currentTurn = turns;
      runState.usage.turnsCount = turns;
      runState.usage.elapsedTimeMs = Date.now() - startTime;
      runState.updatedAt = Date.now();
      if (goal && goalStore) {
        try {
          const currentGoal = await goalStore.get(goal.id);
          if (currentGoal) {
            await goalStore.update(goal.id, {
              usage: {
                elapsedTimeMs: currentGoal.usage.elapsedTimeMs + (Date.now() - startTime),
                tokens: {
                  input: currentGoal.usage.tokens.input + runState.usage.tokens.input,
                  output: currentGoal.usage.tokens.output + runState.usage.tokens.output,
                  total: currentGoal.usage.tokens.total + runState.usage.tokens.total
                },
                costUsd: currentGoal.usage.costUsd + runState.usage.costUsd,
                toolCallsCount: currentGoal.usage.toolCallsCount + runState.usage.toolCallsCount,
                turnsCount: currentGoal.usage.turnsCount + turns
              }
            });
          }
        } catch (e) {}
      }
      if (this.memory) {
        try {
          await this.memory.saveRunState(runState);
          await this.memory.saveRunEvent({
            type: 'completed',
            runId,
            parentRunId,
            status: 'failed',
            terminationReason: 'max_turns',
            timestamp: Date.now()
          });
        } catch (e) {}
      }
      events.emit({
        type: 'completed',
        runId,
        parentRunId,
        status: 'failed',
        terminationReason: 'max_turns',
        timestamp: Date.now()
      });

      // Trigger background consolidation check
      this.triggerBackgroundConsolidation().catch(err => {
        console.error('[Agent Consolidation Error]', err);
      });

      return warningText;
    }

    // Trigger background consolidation if threshold is met
    private async triggerBackgroundConsolidation(): Promise<void> {
      if (!this.memory || !this.procedural) return;

      try {
        const unconsolidatedCount = await this.memory.getUnconsolidatedCount();
        const threshold = this.config.consolidationThreshold !== undefined ? this.config.consolidationThreshold : 10;
        
        if (unconsolidatedCount >= threshold) {
          const consolidator = new MemoryConsolidator(
            this.memory,
            this.procedural,
            this.provider,
            this.config.skillsPath || './skills',
            this.config.modelName
          );

          // Run asynchronously without awaiting so the agent run returns quickly
          consolidator.consolidate().then(result => {
            if (result.factsExtracted > 0 || result.skillsCreated > 0) {
              console.log(`[Background Consolidation Done] Extracted ${result.factsExtracted} facts, created ${result.skillsCreated} skills.`);
            }
          }).catch(err => {
            if (err.message?.includes('SQLITE_MISUSE') || err.message?.includes('closed') || err.code === 'SQLITE_MISUSE') {
              // Silence DB closed errors since consolidation is asynchronous and database may close before it completes
              return;
            }
            console.error('[Background Consolidation Error]', err);
          });
        }
      } catch (err: any) {
        console.warn(`[Background Consolidation Trigger Failed] ${err.message}`);
      }
    }

    async clearHistory(sessionId: string): Promise<void> {
      if (this.memory) {
        await this.memory.clearHistory(sessionId);
      }
    }

    async getSessionsList(): Promise<{ sessionId: string; messageCount: number; lastActive: number }[]> {
      if (this.memory) {
        return this.memory.getSessionsList();
      }
      return [];
    }

    async renameSession(oldSessionId: string, newSessionId: string): Promise<void> {
      if (this.memory) {
        await this.memory.renameSession(oldSessionId, newSessionId);
      }
    }

    getMemory(): EpisodicMemory | null {
      return this.memory;
    }

    async getRunState(runId: string): Promise<RunState | null> {
      if (this.memory) {
        return this.memory.getRunState(runId);
      }
      return null;
    }

    async listRuns(sessionId?: string, limit: number = 50): Promise<RunState[]> {
      if (this.memory) {
        return this.memory.listRuns(sessionId, limit);
      }
      return [];
    }

    async resumeRun(runId: string, options?: Partial<RunOptions>): Promise<string> {
      if (!this.memory) {
        throw new Error('Episodic memory must be initialized to resume runs.');
      }
      const state = await this.memory.getRunState(runId);
      if (!state) {
        throw new Error(`Run "${runId}" not found in persisted state.`);
      }
      if (state.status === 'completed') {
        return state.result || 'Run already completed.';
      }
      const history = await this.memory.loadHistory(state.sessionId, 40);
      return this.run(
        state.task,
        history,
        {
          runId: state.runId,
          parentRunId: state.parentRunId,
          rootRunId: state.rootRunId,
          sessionId: state.sessionId,
          budget: state.budget,
          ...options
        }
      );
    }
  }


  function excerptParts(parts: any[], maxLen: number = 280): string {
    const texts = (parts || [])
      .filter((p: any) => p && typeof p.text === 'string')
      .map((p: any) => p.text.replace(/\s+/g, ' ').trim());
    const joined = texts.join(' ').trim();
    if (!joined) return '(non-text turn)';
    return joined.length > maxLen ? `${joined.slice(0, maxLen)}…` : joined;
  }

  function localDayBounds(daysAgo: number): { start: number; end: number; label: string } {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - daysAgo);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start: start.getTime(), end: end.getTime(), label: start.toISOString().slice(0, 10) };
  }

  async function buildEpisodicArchive(
    memory: EpisodicMemory,
    sessionId: string | undefined,
    userPrompt: string
  ): Promise<{ text: string; hits: number }> {
    const lines: string[] = [];
    let hits = 0;

    const sessions = await memory.getSessionsList();
    if (sessions.length > 0) {
      lines.push('Known sessions (id · messages · last active):');
      for (const s of sessions.slice(0, 8)) {
        const last = new Date(s.lastActive).toISOString();
        lines.push(`- ${s.sessionId} · ${s.messageCount} · ${last}${s.sessionId === sessionId ? ' (current)' : ''}`);
      }
    }

    const wantsYesterday = /\byesterday\b/i.test(userPrompt);
    const windows = wantsYesterday
      ? [localDayBounds(1)]
      : [localDayBounds(1), localDayBounds(0)];

    for (const w of windows) {
      const msgs = await memory.getMessagesInRange(w.start, w.end, 40);
      if (msgs.length === 0) continue;
      hits += msgs.length;
      lines.push(`\nMessages on ${w.label}:`);
      for (const m of msgs) {
        const stamp = new Date(m.timestamp).toISOString();
        lines.push(`- [${m.sessionId}] [${m.role}] [${stamp}] ${excerptParts(m.parts)}`);
      }
    }

    const others = sessions.filter((s) => s.sessionId !== sessionId).slice(0, 3);
    for (const s of others) {
      const prior = await memory.loadHistory(s.sessionId, 8, { includeTimestamps: true });
      if (prior.length === 0) continue;
      hits += prior.length;
      lines.push(`\nRecent turns from session "${s.sessionId}":`);
      for (const msg of prior) {
        lines.push(`- [${msg.role}] ${excerptParts(msg.parts)}`);
      }
    }

    if (lines.length === 0) {
      return { text: 'No additional episodic archive entries were found outside the current working-memory window.', hits: 0 };
    }
    return { text: lines.join('\n'), hits };
  }

  async function runWithConcurrencyLimit<T>(
    tasks: (() => Promise<T>)[],
    limit: number
  ): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let currentIndex = 0;

    async function worker() {
      while (currentIndex < tasks.length) {
        const index = currentIndex++;
        results[index] = await tasks[index]();
      }
    }

    const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
    await Promise.all(workers);
    return results;
  }

  function pruneBrowserHistory(history: Message[]): void {
    const browserResponses: { messageIdx: number; partIdx: number; part: any }[] = [];

    history.forEach((msg, mIdx) => {
      msg.parts.forEach((part, pIdx) => {
        if (part && 'functionResponse' in part) {
          const name = part.functionResponse.name;
          if (name === 'browserNavigate' || name === 'browserAction') {
            browserResponses.push({ messageIdx: mIdx, partIdx: pIdx, part });
          }
        }
      });
    });

    if (browserResponses.length > 1) {
      for (let i = 0; i < browserResponses.length - 1; i++) {
        const { part } = browserResponses[i];
        if (part.functionResponse?.response) {
          const resp = part.functionResponse.response;
          if (resp.interactiveElements) {
            resp.interactiveElements = [
              { note: "Interactive elements pruned from older history to save tokens." }
            ];
          }
        }
      }
    }
  }
