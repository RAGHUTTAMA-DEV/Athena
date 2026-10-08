import { RoutineRecord, RoutineStore, RoutineTriggerType } from '../storage/stores/types.js';
import { EventBus, BusEvent } from '../background/eventBus.js';
import { Scheduler } from '../background/scheduler.js';
import { RoutineCondition, RoutineExecutionResult } from './learningTypes.js';

export type RoutineExecutorCallback = (routine: RoutineRecord, eventPayload?: any) => Promise<{ success: boolean; runId?: string; error?: string }>;

export class RoutineEngine {
  private static instance: RoutineEngine | null = null;
  private routineStore: RoutineStore;
  private eventBus: EventBus;
  private activeSubscriptions: Map<string, () => void> = new Map();
  private executorCallback?: RoutineExecutorCallback;
  private isListening = false;

  constructor(routineStore: RoutineStore, eventBus?: EventBus) {
    this.routineStore = routineStore;
    this.eventBus = eventBus || EventBus.getInstance();
  }

  static getInstance(routineStore?: RoutineStore, eventBus?: EventBus): RoutineEngine {
    if (!RoutineEngine.instance) {
      if (!routineStore) throw new Error('RoutineEngine must be initialized with a RoutineStore.');
      RoutineEngine.instance = new RoutineEngine(routineStore, eventBus);
    }
    return RoutineEngine.instance;
  }

  public setExecutor(executor: RoutineExecutorCallback): void {
    this.executorCallback = executor;
  }

  public getStore(): RoutineStore {
    return this.routineStore;
  }

  /**
   * Evaluates routine conditions against an incoming event payload.
   */
  public evaluateConditions(conditions: RoutineCondition[] | undefined, payload: any): boolean {
    if (!conditions || conditions.length === 0) return true;
    if (!payload || typeof payload !== 'object') return false;

    for (const cond of conditions) {
      const actualValue = payload[cond.field];

      switch (cond.operator) {
        case 'equals':
          if (actualValue !== cond.value) return false;
          break;
        case 'not_equals':
          if (actualValue === cond.value) return false;
          break;
        case 'contains':
          if (typeof actualValue === 'string') {
            if (!actualValue.includes(String(cond.value))) return false;
          } else if (Array.isArray(actualValue)) {
            if (!actualValue.includes(cond.value)) return false;
          } else {
            return false;
          }
          break;
        case 'in':
          if (!Array.isArray(cond.value) || !cond.value.includes(actualValue)) return false;
          break;
        case 'greater_than':
          if (typeof actualValue !== 'number' || actualValue <= cond.value) return false;
          break;
        case 'less_than':
          if (typeof actualValue !== 'number' || actualValue >= cond.value) return false;
          break;
        case 'exists':
          if (actualValue === undefined || actualValue === null) return false;
          break;
      }
    }

    return true;
  }

  /**
   * Starts listening to EventBus for all event-triggered routines.
   */
  async start(): Promise<void> {
    if (this.isListening) return;

    // Load active event routines from store
    const routines = await this.routineStore.findByTriggerType('event');
    for (const routine of routines) {
      if (routine.enabled) {
        this.bindRoutine(routine);
      }
    }

    this.isListening = true;
  }

  /**
   * Stop all active listeners.
   */
  stop(): void {
    for (const unsubscribe of this.activeSubscriptions.values()) {
      unsubscribe();
    }
    this.activeSubscriptions.clear();
    this.isListening = false;
  }

  /**
   * Binds an individual routine's trigger to the EventBus.
   */
  public bindRoutine(routine: RoutineRecord): void {
    if (this.activeSubscriptions.has(routine.id)) {
      this.activeSubscriptions.get(routine.id)!();
      this.activeSubscriptions.delete(routine.id);
    }

    const topic = routine.triggerConfig?.topic || routine.triggerConfig?.event;
    if (!topic) return;

    const unsub = this.eventBus.subscribe(topic, async (event: BusEvent) => {
      // Re-fetch latest routine definition to ensure enabled status and conditions
      const fresh = await this.routineStore.get(routine.id);
      if (!fresh || !fresh.enabled) return;

      const matched = this.evaluateConditions(fresh.conditions as any, event.payload);
      if (matched) {
        await this.triggerRoutine(fresh, event.payload);
      }
    });

    this.activeSubscriptions.set(routine.id, unsub);
  }

  /**
   * Manually or reactively triggers a routine workflow.
   */
  async triggerRoutine(routine: RoutineRecord, eventPayload?: any): Promise<RoutineExecutionResult> {
    const start = Date.now();
    let success = true;
    let errorMsg: string | undefined;
    let runId: string | undefined;

    try {
      if (this.executorCallback) {
        const res = await this.executorCallback(routine, eventPayload);
        success = res.success;
        runId = res.runId;
        errorMsg = res.error;
      } else {
        // Default simulated workflow run
        runId = `routine_run_${Date.now()}`;
        success = true;
      }
    } catch (err: any) {
      success = false;
      errorMsg = err.message;
    }

    const durationMs = Date.now() - start;

    // Record outcome and telemetry in store
    await this.routineStore.recordRun(routine.id, {
      success,
      durationMs,
      runId,
      error: errorMsg
    });

    return {
      routineId: routine.id,
      success,
      runId,
      durationMs,
      error: errorMsg,
      timestamp: Date.now()
    };
  }

  /**
   * Binds a schedule-triggered routine to the background Scheduler.
   */
  public async bindScheduleRoutine(routine: RoutineRecord): Promise<void> {
    try {
      const scheduler = Scheduler.getInstance();
      const jobId = routine.triggerConfig?.jobId || routine.id;
      const schedule = routine.triggerConfig?.schedule || routine.triggerConfig?.cron || routine.triggerConfig?.interval || '0 9 * * *';
      const prompt = routine.workflow?.prompt || routine.description || routine.name;
      const timezone = routine.triggerConfig?.timezone;
      const priority = routine.triggerConfig?.priority;

      await scheduler.addJob(jobId, prompt, schedule, 'routine_engine', { timezone, priority });
    } catch (e: any) {
      console.warn(`[RoutineEngine] Failed to bind schedule routine "${routine.id}" to Scheduler:`, e.message);
    }
  }

  /**
   * Register a new routine and bind it if enabled.
   */
  async registerRoutine(routine: RoutineRecord): Promise<RoutineRecord> {
    const saved = await this.routineStore.save(routine);
    if (saved.enabled) {
      if (saved.triggerType === 'event') {
        this.bindRoutine(saved);
      } else if (saved.triggerType === 'schedule') {
        await this.bindScheduleRoutine(saved);
      }
    }
    return saved;
  }

  /**
   * Disable a routine.
   */
  async disableRoutine(id: string): Promise<void> {
    const routine = await this.routineStore.get(id);
    if (routine) {
      routine.enabled = false;
      await this.routineStore.save(routine);
      if (routine.triggerType === 'event') {
        if (this.activeSubscriptions.has(id)) {
          this.activeSubscriptions.get(id)!();
          this.activeSubscriptions.delete(id);
        }
      } else if (routine.triggerType === 'schedule') {
        try {
          const jobId = routine.triggerConfig?.jobId || routine.id;
          await Scheduler.getInstance().cancelJob(jobId);
        } catch {}
      }
    }
  }

  /**
   * Enable a routine.
   */
  async enableRoutine(id: string): Promise<void> {
    const routine = await this.routineStore.get(id);
    if (routine) {
      routine.enabled = true;
      await this.routineStore.save(routine);
      if (routine.triggerType === 'event') {
        this.bindRoutine(routine);
      } else if (routine.triggerType === 'schedule') {
        await this.bindScheduleRoutine(routine);
      }
    }
  }
}
