import { DurableAgentEvent, EventPriority } from '../storage/stores/types.js';

export interface EventFilterRule {
  id: string;
  name: string;
  topicPattern: string; // e.g. "webhook:*", "monitor:site_down", "*"
  minPriority?: EventPriority;
  quietHours?: {
    startHour: number; // 0-23 UTC or local
    endHour: number;   // 0-23
    allowCritical: boolean;
  };
  cooldownMs?: number; // Minimum time between handling events matching this rule
  predicate?: (event: DurableAgentEvent) => boolean | Promise<boolean>;
}

export interface RelevanceScore {
  score: number;       // 0.0 to 1.0
  urgency: 'none' | 'low' | 'medium' | 'high' | 'immediate';
  reason: string;
  requiresWake: boolean;
  suggestedAction?: string;
  costUsd?: number;
  tokensUsed?: number;
}

export interface RelevanceEvaluator {
  evaluate(event: DurableAgentEvent): Promise<RelevanceScore>;
}

export interface AgentWakeDecision {
  woke: boolean;
  reason: string;
  goalId?: string;
  taskId?: string;
  runId?: string;
  actionTaken?: string;
  costUsd?: number;
  tokensUsed?: number;
  timestamp: number;
}

export type AgentWakeHandler = (
  event: DurableAgentEvent,
  relevance: RelevanceScore
) => Promise<{ actionTaken?: string; costUsd?: number; tokensUsed?: number }>;

export interface EventPipelineOptions {
  wakeThreshold?: number; // Default 0.7
  maxWakesPerHour?: number; // Rate limit default 20
  evaluator?: RelevanceEvaluator;
}

export interface WebhookRequest {
  endpointId: string;
  headers: Record<string, string | undefined>;
  rawBody: string;
  parsedBody?: any;
  sourceIp?: string;
}

export interface WebhookResponse {
  statusCode: number;
  accepted: boolean;
  message: string;
  eventId?: string;
  receiptId?: string;
}

export interface HeartbeatConfig {
  agentId?: string;
  intervalMs: number;         // e.g. 300,000 (5 minutes)
  costCapPerHourUsd: number;  // e.g. 0.50 USD
  maxDailyCostUsd: number;    // e.g. 2.00 USD
  activeHours?: {
    startHour: number; // 0-23
    endHour: number;   // 0-23
  };
  stallThresholdMs?: number;  // Time without progress before goal is considered stalled (default 15m)
}

export interface HeartbeatTickResult {
  tickId: string;
  wokeAgent: boolean;
  itemsInspected: {
    activeGoals: number;
    stalledGoals: number;
    activeWaits: number;
    unreadMessages: number;
  };
  reason?: string;
  costUsd: number;
  tokensUsed: number;
  throttled: boolean;
  timestamp: number;
}
