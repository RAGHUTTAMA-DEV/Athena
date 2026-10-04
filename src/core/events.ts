import { RunStatus, TerminationReason, StructuredFailure } from './runState.js';

export type AgentEventType =
  | 'status_change'
  | 'turn_start'
  | 'thought'
  | 'tool_call'
  | 'tool_result'
  | 'subagent_spawn'
  | 'subagent_finish'
  | 'budget_warning'
  | 'error'
  | 'completed';

export interface BaseAgentEvent {
  runId: string;
  parentRunId?: string;
  timestamp: number;
}

export interface StatusChangeEvent extends BaseAgentEvent {
  type: 'status_change';
  from: RunStatus;
  to: RunStatus;
}

export interface TurnStartEvent extends BaseAgentEvent {
  type: 'turn_start';
  turn: number;
  maxTurns: number;
}

export interface ThoughtEvent extends BaseAgentEvent {
  type: 'thought';
  turn: number;
  text: string;
}

export interface ToolCallEvent extends BaseAgentEvent {
  type: 'tool_call';
  turn: number;
  callId?: string;
  toolName: string;
  args: Record<string, any>;
  idempotencyKey?: string;
}

export interface ToolResultEvent extends BaseAgentEvent {
  type: 'tool_result';
  turn: number;
  callId?: string;
  toolName: string;
  success: boolean;
  result?: any;
  error?: string;
  durationMs: number;
}

export interface SubagentSpawnEvent extends BaseAgentEvent {
  type: 'subagent_spawn';
  childRunId: string;
  goal: string;
  allowedTools?: string[];
}

export interface SubagentFinishEvent extends BaseAgentEvent {
  type: 'subagent_finish';
  childRunId: string;
  status: RunStatus;
  result?: string;
  error?: string;
}

export interface BudgetWarningEvent extends BaseAgentEvent {
  type: 'budget_warning';
  resource: 'time' | 'tokens' | 'cost' | 'toolCalls' | 'turns';
  current: number;
  limit: number;
  percentageUsed: number;
}

export interface AgentErrorEvent extends BaseAgentEvent {
  type: 'error';
  failure: StructuredFailure;
}

export interface CompletedEvent extends BaseAgentEvent {
  type: 'completed';
  status: RunStatus;
  terminationReason: TerminationReason;
  result?: string;
}

export type AgentEvent =
  | StatusChangeEvent
  | TurnStartEvent
  | ThoughtEvent
  | ToolCallEvent
  | ToolResultEvent
  | SubagentSpawnEvent
  | SubagentFinishEvent
  | BudgetWarningEvent
  | AgentErrorEvent
  | CompletedEvent;

export type EventHandler<T extends AgentEvent = AgentEvent> = (event: T) => void | Promise<void>;

export class AgentEventEmitter {
  private handlers = new Map<string, Set<EventHandler<any>>>();
  private wildcardHandlers = new Set<EventHandler<AgentEvent>>();

  on<T extends AgentEvent>(eventType: T['type'], handler: EventHandler<T>): () => void {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }
    this.handlers.get(eventType)!.add(handler);
    return () => {
      this.handlers.get(eventType)?.delete(handler);
    };
  }

  onAny(handler: EventHandler<AgentEvent>): () => void {
    this.wildcardHandlers.add(handler);
    return () => {
      this.wildcardHandlers.delete(handler);
    };
  }

  emit(event: AgentEvent): void {
    const specific = this.handlers.get(event.type);
    if (specific) {
      for (const h of specific) {
        try {
          h(event);
        } catch (err) {
          console.error(`[AgentEventEmitter] Error in "${event.type}" listener:`, err);
        }
      }
    }

    for (const wh of this.wildcardHandlers) {
      try {
        wh(event);
      } catch (err) {
        console.error('[AgentEventEmitter] Error in wildcard listener:', err);
      }
    }
  }
}
