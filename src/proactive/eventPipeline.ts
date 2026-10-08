import {
  DurableAgentEvent,
  DurableAgentEventStore,
  DurableAgentEventFilter,
  EventPriority
} from '../storage/stores/types.js';
import {
  EventFilterRule,
  RelevanceEvaluator,
  RelevanceScore,
  AgentWakeHandler,
  AgentWakeDecision,
  EventPipelineOptions
} from './types.js';

export class RuleBasedRelevanceEvaluator implements RelevanceEvaluator {
  async evaluate(event: DurableAgentEvent): Promise<RelevanceScore> {
    // 1. Critical priority events always require immediate wake
    if (event.priority === 'critical') {
      return {
        score: 1.0,
        urgency: 'immediate',
        reason: `Critical priority event on topic "${event.topic}" requires immediate agent action`,
        requiresWake: true,
        costUsd: 0.0,
        tokensUsed: 0
      };
    }

    // 2. High priority events (e.g. goal stalled, severe failure, high-priority webhook)
    if (event.priority === 'high' || event.topic.includes('stalled') || event.topic.includes('failed') || event.topic.includes('down')) {
      return {
        score: 0.85,
        urgency: 'high',
        reason: `High priority topic "${event.topic}" requires agent intervention`,
        requiresWake: true,
        costUsd: 0.0,
        tokensUsed: 0
      };
    }

    // 3. Normal priority checks
    if (event.priority === 'normal') {
      const isActionable =
        event.payload &&
        (event.payload.requiresAction === true ||
          event.payload.actionRequired === true ||
          event.topic.startsWith('action:'));

      return {
        score: isActionable ? 0.75 : 0.4,
        urgency: isActionable ? 'medium' : 'low',
        reason: isActionable
          ? `Normal priority event marked as actionable`
          : `Informational event on topic "${event.topic}" - no wake needed`,
        requiresWake: isActionable,
        costUsd: 0.0,
        tokensUsed: 0
      };
    }

    // 4. Low priority (background pings, metrics, heartbeats without anomalies)
    return {
      score: 0.1,
      urgency: 'none',
      reason: `Low priority event on topic "${event.topic}" ignored for wake`,
      requiresWake: false,
      costUsd: 0.0,
      tokensUsed: 0
    };
  }
}

export class EventPipeline {
  private rules: Map<string, EventFilterRule> = new Map();
  private ruleLastFired: Map<string, number> = new Map();
  private wakeTimestamps: number[] = [];
  private wakeThreshold: number;
  private maxWakesPerHour: number;
  private evaluator: RelevanceEvaluator;
  private wakeHandler?: AgentWakeHandler;

  constructor(
    private eventStore: DurableAgentEventStore,
    options?: EventPipelineOptions
  ) {
    this.wakeThreshold = options?.wakeThreshold ?? 0.7;
    this.maxWakesPerHour = options?.maxWakesPerHour ?? 20;
    this.evaluator = options?.evaluator ?? new RuleBasedRelevanceEvaluator();
  }

  setWakeHandler(handler: AgentWakeHandler): void {
    this.wakeHandler = handler;
  }

  setEvaluator(evaluator: RelevanceEvaluator): void {
    this.evaluator = evaluator;
  }

  addFilterRule(rule: EventFilterRule): void {
    this.rules.set(rule.id, rule);
  }

  removeFilterRule(ruleId: string): boolean {
    return this.rules.delete(ruleId);
  }

  /**
   * Main Pipeline:
   * Event -> Filter -> Relevance -> Agent Wake -> Reason -> Action
   */
  async processEvent(event: DurableAgentEvent): Promise<AgentWakeDecision> {
    const now = Date.now();

    // Persist event in store if not already saved
    await this.eventStore.save(event);

    // Stage 1: Cheap Rules Filtering
    const filterResult = await this.evaluateFilters(event, now);
    if (!filterResult.passed) {
      await this.eventStore.updateStatus(event.id, 'filtered', filterResult.reason, now);
      return {
        woke: false,
        reason: `Filtered: ${filterResult.reason}`,
        timestamp: now
      };
    }

    // Stage 2: Relevance Evaluation (Cheap rules / small model)
    let relevance: RelevanceScore;
    try {
      relevance = await this.evaluator.evaluate(event);
    } catch (err: any) {
      await this.eventStore.incrementRetry(event.id, `Relevance evaluation failed: ${err.message}`);
      throw err;
    }

    // If relevance is below threshold, log and conclude without waking LLM
    if (!relevance.requiresWake || relevance.score < this.wakeThreshold) {
      await this.eventStore.updateStatus(
        event.id,
        'processed',
        `Relevance score ${relevance.score.toFixed(2)} < threshold ${this.wakeThreshold}: ${relevance.reason}`,
        now
      );
      return {
        woke: false,
        reason: `Low relevance (${relevance.score.toFixed(2)}): ${relevance.reason}`,
        costUsd: relevance.costUsd ?? 0,
        tokensUsed: relevance.tokensUsed ?? 0,
        timestamp: now
      };
    }

    // Stage 3: Rate Limiter & Wake Budget Guard
    this.pruneWakeTimestamps(now);
    if (this.wakeTimestamps.length >= this.maxWakesPerHour && event.priority !== 'critical') {
      const reason = `Wake rate limit exceeded (${this.wakeTimestamps.length}/${this.maxWakesPerHour} wakes in last hour). Event deferred.`;
      await this.eventStore.updateStatus(event.id, 'pending', reason, now);
      return {
        woke: false,
        reason,
        timestamp: now
      };
    }

    // Stage 4 & 5: Agent Wake -> Reason -> Action
    this.wakeTimestamps.push(now);

    if (!this.wakeHandler) {
      await this.eventStore.updateStatus(event.id, 'processed', 'No wake handler registered', now);
      return {
        woke: true,
        reason: `Relevance ${relevance.score.toFixed(2)} qualified wake, but no handler registered`,
        timestamp: now
      };
    }

    try {
      const outcome = await this.wakeHandler(event, relevance);
      await this.eventStore.updateStatus(event.id, 'processed', outcome.actionTaken || 'Completed', now);
      return {
        woke: true,
        reason: relevance.reason,
        goalId: event.goalId,
        taskId: event.taskId,
        runId: event.runId,
        actionTaken: outcome.actionTaken,
        costUsd: (relevance.costUsd ?? 0) + (outcome.costUsd ?? 0),
        tokensUsed: (relevance.tokensUsed ?? 0) + (outcome.tokensUsed ?? 0),
        timestamp: now
      };
    } catch (err: any) {
      await this.eventStore.incrementRetry(event.id, `Agent wake handler failed: ${err.message}`);
      return {
        woke: false,
        reason: `Handler error: ${err.message}`,
        timestamp: now
      };
    }
  }

  /**
   * Deterministic Event Replay:
   * Re-evaluates a list of historical events matching the filter.
   */
  async replayEvents(filter?: DurableAgentEventFilter): Promise<{ replayedCount: number; decisions: AgentWakeDecision[] }> {
    const events = await this.eventStore.list(filter);
    const decisions: AgentWakeDecision[] = [];

    // Replay in chronological order
    const chronological = [...events].reverse();
    for (const event of chronological) {
      const decision = await this.processEvent({
        ...event,
        status: 'pending' // Reset for replay
      });
      decisions.push(decision);
    }

    return {
      replayedCount: chronological.length,
      decisions
    };
  }

  private async evaluateFilters(event: DurableAgentEvent, now: number): Promise<{ passed: boolean; reason?: string }> {
    for (const rule of this.rules.values()) {
      if (!this.topicMatches(rule.topicPattern, event.topic)) {
        continue;
      }

      // Check priority requirement
      if (rule.minPriority) {
        const priorityOrder: Record<EventPriority, number> = {
          low: 1,
          normal: 2,
          high: 3,
          critical: 4
        };
        if (priorityOrder[event.priority] < priorityOrder[rule.minPriority]) {
          return { passed: false, reason: `Priority "${event.priority}" below rule "${rule.name}" minimum "${rule.minPriority}"` };
        }
      }

      // Check quiet hours
      if (rule.quietHours) {
        const currentHour = new Date(now).getUTCHours();
        const inQuietHours =
          rule.quietHours.startHour <= rule.quietHours.endHour
            ? currentHour >= rule.quietHours.startHour && currentHour < rule.quietHours.endHour
            : currentHour >= rule.quietHours.startHour || currentHour < rule.quietHours.endHour;

        if (inQuietHours && (!rule.quietHours.allowCritical || event.priority !== 'critical')) {
          return { passed: false, reason: `Quiet hours active (${rule.quietHours.startHour}:00-${rule.quietHours.endHour}:00 UTC)` };
        }
      }

      // Check cooldown
      if (rule.cooldownMs) {
        const lastFired = this.ruleLastFired.get(rule.id) || 0;
        if (now - lastFired < rule.cooldownMs) {
          return { passed: false, reason: `Rule "${rule.name}" in cooldown (${rule.cooldownMs}ms)` };
        }
        this.ruleLastFired.set(rule.id, now);
      }

      // Check custom predicate function
      if (rule.predicate) {
        const match = await Promise.resolve(rule.predicate(event));
        if (!match) {
          return { passed: false, reason: `Rule "${rule.name}" predicate returned false` };
        }
      }
    }

    return { passed: true };
  }

  private topicMatches(pattern: string, topic: string): boolean {
    if (pattern === '*' || pattern === topic) return true;
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      return topic.startsWith(prefix);
    }
    return false;
  }

  private pruneWakeTimestamps(now: number): void {
    const oneHourAgo = now - 3600000;
    this.wakeTimestamps = this.wakeTimestamps.filter(t => t >= oneHourAgo);
  }
}
