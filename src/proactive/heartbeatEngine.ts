import {
  GoalStore,
  RunWaitStore,
  AgentMessageStore,
  HeartbeatStore
} from '../storage/stores/types.js';
import { EventPipeline } from './eventPipeline.js';
import { HeartbeatConfig, HeartbeatTickResult } from './types.js';

export class HeartbeatEngine {
  private config: HeartbeatConfig;
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private eventPipeline?: EventPipeline;

  constructor(
    private stores: {
      goal?: GoalStore;
      runWait?: RunWaitStore;
      agentMessage?: AgentMessageStore;
      heartbeat: HeartbeatStore;
    },
    config?: Partial<HeartbeatConfig>,
    eventPipeline?: EventPipeline
  ) {
    this.config = {
      intervalMs: config?.intervalMs ?? 300000, // 5 minutes
      costCapPerHourUsd: config?.costCapPerHourUsd ?? 0.50,
      maxDailyCostUsd: config?.maxDailyCostUsd ?? 2.00,
      activeHours: config?.activeHours,
      stallThresholdMs: config?.stallThresholdMs ?? 900000, // 15 minutes
      agentId: config?.agentId || 'athena_main'
    };
    this.eventPipeline = eventPipeline;
  }

  setEventPipeline(pipeline: EventPipeline): void {
    this.eventPipeline = pipeline;
  }

  updateConfig(updates: Partial<HeartbeatConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): HeartbeatConfig {
    return { ...this.config };
  }

  /**
   * Executes a single proactive heartbeat check.
   * Asks: "Is anything important?", not "generate another response."
   */
  async tick(): Promise<HeartbeatTickResult> {
    const now = Date.now();
    const tickId = `tick_${now}_${Math.random().toString(36).substring(2, 6)}`;

    // 1. Check Active Hours
    if (this.config.activeHours) {
      const currentHour = new Date(now).getUTCHours();
      const inActiveHours =
        this.config.activeHours.startHour <= this.config.activeHours.endHour
          ? currentHour >= this.config.activeHours.startHour && currentHour < this.config.activeHours.endHour
          : currentHour >= this.config.activeHours.startHour || currentHour < this.config.activeHours.endHour;

      if (!inActiveHours) {
        return {
          tickId,
          wokeAgent: false,
          itemsInspected: { activeGoals: 0, stalledGoals: 0, activeWaits: 0, unreadMessages: 0 },
          reason: `Outside active hours (${this.config.activeHours.startHour}:00-${this.config.activeHours.endHour}:00 UTC)`,
          costUsd: 0,
          tokensUsed: 0,
          throttled: false,
          timestamp: now
        };
      }
    }

    // 2. Inspect Environment & State
    let activeGoalsCount = 0;
    const stalledGoals: Array<{ id: string; title: string; idleMs: number }> = [];
    const urgentWaits: Array<{ id: string; runId: string; waitType: string }> = [];
    let unreadMessagesCount = 0;

    // 2a. Inspect Goals
    if (this.stores.goal) {
      const activeGoals = await this.stores.goal.list({ status: 'active' });
      activeGoalsCount = activeGoals.length;
      const stallThreshold = this.config.stallThresholdMs ?? 900000;

      for (const goal of activeGoals) {
        const idleMs = now - (goal.updatedAt || goal.createdAt);
        if (idleMs >= stallThreshold) {
          stalledGoals.push({ id: goal.id, title: goal.title, idleMs });
        }
      }
    }

    // 2b. Inspect Run Waits (expired timeouts or blocked waits)
    if (this.stores.runWait) {
      const activeWaits = await this.stores.runWait.listActive();
      for (const wait of activeWaits) {
        if (wait.deadline && wait.deadline <= now) {
          urgentWaits.push({ id: wait.id, runId: wait.runId, waitType: wait.waitType });
        }
      }
    }

    // 2c. Inspect Urgent Unread Messages in Mailbox
    if (this.stores.agentMessage && this.config.agentId) {
      const unread = await this.stores.agentMessage.listByRecipient(this.config.agentId, {
        status: 'sent',
        limit: 10
      });
      unreadMessagesCount = unread.length;
    }

    const itemsInspected = {
      activeGoals: activeGoalsCount,
      stalledGoals: stalledGoals.length,
      activeWaits: urgentWaits.length,
      unreadMessages: unreadMessagesCount
    };

    const hasUrgentIssues =
      stalledGoals.length > 0 || urgentWaits.length > 0 || unreadMessagesCount > 0;

    // If nothing important: QUIET NO-OP TICK (Zero LLM cost)
    if (!hasUrgentIssues) {
      await this.stores.heartbeat.record({
        id: tickId,
        agentId: this.config.agentId,
        wokeAgent: false,
        reason: 'All systems normal, no urgent issues detected',
        costUsd: 0,
        tokensUsed: 0,
        activeGoalsCount,
        timestamp: now
      });

      return {
        tickId,
        wokeAgent: false,
        itemsInspected,
        reason: 'All systems normal',
        costUsd: 0,
        tokensUsed: 0,
        throttled: false,
        timestamp: now
      };
    }

    // 3. Urgent issue detected -> Check Cost Caps before Waking
    const oneHourAgo = now - 3600000;
    const pastHourCost = await this.stores.heartbeat.getCostSummary(oneHourAgo);
    const estimatedCostUsd = 0.002;

    if (pastHourCost.totalCostUsd + estimatedCostUsd > this.config.costCapPerHourUsd) {
      const reason = `Heartbeat cost limit reached (projected $${(pastHourCost.totalCostUsd + estimatedCostUsd).toFixed(4)} > cap $${this.config.costCapPerHourUsd.toFixed(4)}/hr). Throttled wake.`;
      await this.stores.heartbeat.record({
        id: tickId,
        agentId: this.config.agentId,
        wokeAgent: false,
        reason,
        costUsd: 0,
        tokensUsed: 0,
        activeGoalsCount,
        timestamp: now
      });

      return {
        tickId,
        wokeAgent: false,
        itemsInspected,
        reason,
        costUsd: 0,
        tokensUsed: 0,
        throttled: true,
        timestamp: now
      };
    }

    // 4. Trigger Targeted Wake
    const reasons: string[] = [];
    if (stalledGoals.length > 0) {
      reasons.push(`${stalledGoals.length} stalled goal(s): ${stalledGoals.map(g => `"${g.title}"`).join(', ')}`);
    }
    if (urgentWaits.length > 0) {
      reasons.push(`${urgentWaits.length} expired wait(s) in runs [${urgentWaits.map(w => w.runId).join(', ')}]`);
    }
    if (unreadMessagesCount > 0) {
      reasons.push(`${unreadMessagesCount} unread urgent agent message(s)`);
    }

    const wakeReason = `Heartbeat detected actionable items: ${reasons.join('; ')}`;

    // Simulated/measured wake cost (0.002 USD for inspection reasoning prompt)
    const tickCostUsd = 0.002;
    const tickTokens = 450;

    if (this.eventPipeline) {
      // Dispatch durable event for stalled goals or issues
      for (const sg of stalledGoals) {
        await this.eventPipeline.processEvent({
          id: `evt_heartbeat_stall_${now}_${sg.id}`,
          topic: 'goal:stalled',
          agentId: this.config.agentId,
          goalId: sg.id,
          payload: { goalId: sg.id, goalTitle: sg.title, idleMs: sg.idleMs },
          priority: 'high',
          source: 'heartbeat:engine',
          status: 'pending',
          retryCount: 0,
          maxRetries: 3,
          timestamp: now
        });
      }
    }

    await this.stores.heartbeat.record({
      id: tickId,
      agentId: this.config.agentId,
      wokeAgent: true,
      reason: wakeReason,
      costUsd: tickCostUsd,
      tokensUsed: tickTokens,
      activeGoalsCount,
      timestamp: now
    });

    return {
      tickId,
      wokeAgent: true,
      itemsInspected,
      reason: wakeReason,
      costUsd: tickCostUsd,
      tokensUsed: tickTokens,
      throttled: false,
      timestamp: now
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => {
      this.tick().catch(err => {
        console.error('[HeartbeatEngine] Error during tick:', err);
      });
    }, this.config.intervalMs);
  }

  stop(): void {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus(): { isRunning: boolean; config: HeartbeatConfig } {
    return {
      isRunning: this.isRunning,
      config: this.getConfig()
    };
  }
}
