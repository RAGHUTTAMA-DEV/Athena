import { GoalStore } from '../storage/stores/types.js';
import { Goal } from '../autonomy/goalTypes.js';
import { EventPipeline } from './eventPipeline.js';
import { DurableAgentEvent } from '../storage/stores/types.js';

export interface StalledGoalCheckResult {
  detectedStalls: Array<{
    goalId: string;
    title: string;
    idleMs: number;
    eventId?: string;
  }>;
  totalActiveChecked: number;
  timestamp: number;
}

export class StalledGoalDetector {
  private stallThresholdMs: number;
  private alertedGoals: Map<string, number> = new Map(); // goalId -> lastAlertTimestamp

  constructor(
    private goalStore: GoalStore,
    private eventPipeline: EventPipeline,
    stallThresholdMs: number = 600000 // 10 minutes default
  ) {
    this.stallThresholdMs = stallThresholdMs;
  }

  setStallThreshold(thresholdMs: number): void {
    this.stallThresholdMs = thresholdMs;
  }

  /**
   * Scans active goals for stalls.
   * If a goal is active and has had no updates for longer than the stall threshold,
   * emits a high-priority "goal:stalled" event that wakes the agent.
   */
  async checkStalledGoals(now: number = Date.now()): Promise<StalledGoalCheckResult> {
    const activeGoals = await this.goalStore.list({ status: 'active' });
    const detected: StalledGoalCheckResult['detectedStalls'] = [];

    for (const goal of activeGoals) {
      const lastActivity = goal.updatedAt || goal.createdAt;
      const idleMs = now - lastActivity;

      if (idleMs >= this.stallThresholdMs) {
        // Prevent spamming the same stalled goal continuously within a cooldown
        const lastAlert = this.alertedGoals.get(goal.id) || 0;
        if (now - lastAlert >= this.stallThresholdMs) {
          const eventId = `evt_stall_${goal.id}_${now}`;
          const event: DurableAgentEvent = {
            id: eventId,
            topic: 'goal:stalled',
            goalId: goal.id,
            priority: 'high',
            source: 'monitor:stalled_goal_detector',
            status: 'pending',
            payload: {
              goalId: goal.id,
              title: goal.title,
              idleMs,
              thresholdMs: this.stallThresholdMs,
              progress: goal.progress,
              dependencies: goal.dependencies
            },
            retryCount: 0,
            maxRetries: 3,
            timestamp: now
          };

          // Process through pipeline to trigger wake
          await this.eventPipeline.processEvent(event);
          this.alertedGoals.set(goal.id, now);

          detected.push({
            goalId: goal.id,
            title: goal.title,
            idleMs,
            eventId
          });
        }
      }
    }

    return {
      detectedStalls: detected,
      totalActiveChecked: activeGoals.length,
      timestamp: now
    };
  }

  resetAlert(goalId: string): void {
    this.alertedGoals.delete(goalId);
  }
}

export interface SiteStatusConfig {
  url: string;
  expectedStatus?: number;
  intervalMs?: number;
  name?: string;
}

export class SiteStatusMonitor {
  private lastStatus: Map<string, boolean> = new Map(); // url -> isUp

  constructor(private eventPipeline: EventPipeline) {}

  /**
   * Performs an endpoint health check inspection.
   * Can accept a custom fetcher for deterministic testing or live HTTP.
   */
  async checkEndpoint(
    config: SiteStatusConfig,
    fetchFn?: (url: string) => Promise<{ status: number; latencyMs: number }>,
    now: number = Date.now()
  ): Promise<{ url: string; isUp: boolean; status: number; latencyMs: number }> {
    const fetcher = fetchFn || (async (u) => {
      const start = Date.now();
      const res = await fetch(u);
      return { status: res.status, latencyMs: Date.now() - start };
    });

    let isUp = false;
    let status = 0;
    let latencyMs = 0;

    try {
      const res = await fetcher(config.url);
      status = res.status;
      latencyMs = res.latencyMs;
      isUp = status === (config.expectedStatus ?? 200);
    } catch {
      isUp = false;
      status = 0;
    }

    const previousStatus = this.lastStatus.get(config.url);
    this.lastStatus.set(config.url, isUp);

    // If site status changed (down or recovered), emit event into pipeline
    if (previousStatus !== undefined && previousStatus !== isUp) {
      const topic = isUp ? 'monitor:site_recovered' : 'monitor:site_down';
      await this.eventPipeline.processEvent({
        id: `evt_site_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        topic,
        priority: isUp ? 'normal' : 'high',
        source: 'monitor:site_status',
        status: 'pending',
        payload: {
          url: config.url,
          name: config.name || config.url,
          status,
          latencyMs,
          isUp
        },
        retryCount: 0,
        maxRetries: 3,
        timestamp: now
      });
    }

    return { url: config.url, isUp, status, latencyMs };
  }
}
