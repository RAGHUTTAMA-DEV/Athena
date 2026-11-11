import { AthenaEventEnvelope, AthenaEventFamily, ConnectionStatus } from '../../types/events';

export type EventCallback = (event: AthenaEventEnvelope) => void;
export type StatusCallback = (status: ConnectionStatus) => void;

const DEFAULT_API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

const ALL_EVENT_TYPES: AthenaEventFamily[] = [
  'run.queued',
  'run.started',
  'run.progress',
  'run.waiting_for_approval',
  'run.cancellation_requested',
  'run.completed',
  'message.started',
  'message.delta',
  'message.completed',
  'agent.progress',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'subagent.started',
  'subagent.progress',
  'subagent.completed',
  'approval.required',
  'approval.resolved',
  'artifact.created',
  'artifact.updated',
  'task.updated',
  'heartbeat',
];

export class AthenaSSEClient {
  private eventSource: EventSource | null = null;
  private url: string;
  private lastEventId?: string;
  private seenEventIds = new Set<string>();
  private listeners: Set<EventCallback> = new Set();
  private statusListeners: Set<StatusCallback> = new Set();
  private reconnectTimeout: any = null;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 10000;
  private baseReconnectDelay = 1000;
  private isExplicitlyClosed = false;
  private currentStatus: ConnectionStatus = 'disconnected';

  constructor(endpoint: string, initialLastEventId?: string) {
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      this.url = endpoint;
    } else {
      this.url = `${DEFAULT_API_BASE.replace(/\/+$/, '')}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    }
    this.lastEventId = initialLastEventId;
  }

  getStatus(): ConnectionStatus {
    return this.currentStatus;
  }

  private setStatus(status: ConnectionStatus) {
    if (this.currentStatus !== status) {
      this.currentStatus = status;
      this.statusListeners.forEach((cb) => cb(status));
    }
  }

  private handleIncomingEvent = (e: MessageEvent) => {
    try {
      if (!e.data || String(e.data).startsWith(':')) {
        return;
      }
      const envelope: AthenaEventEnvelope = JSON.parse(e.data);
      if (envelope.eventId) {
        if (this.seenEventIds.has(envelope.eventId)) {
          return; // Deduplicate
        }
        this.seenEventIds.add(envelope.eventId);
        this.lastEventId = envelope.eventId;

        if (this.seenEventIds.size > 2000) {
          const iterator = this.seenEventIds.values();
          for (let i = 0; i < 500; i++) {
            const item = iterator.next().value;
            if (item) this.seenEventIds.delete(item);
          }
        }
      }

      this.listeners.forEach((cb) => cb(envelope));
    } catch (err) {
      console.warn('[SSE] Failed to parse event payload:', err);
    }
  };

  connect() {
    this.isExplicitlyClosed = false;
    this.cleanup();
    this.setStatus(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');

    const sseUrl = new URL(this.url);
    if (this.lastEventId) {
      sseUrl.searchParams.set('lastEventId', this.lastEventId);
    }

    try {
      this.eventSource = new EventSource(sseUrl.toString());

      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
      };

      // Listen for unnamed default messages
      this.eventSource.onmessage = this.handleIncomingEvent;

      // Listen for all named Athena SSE event families
      for (const evtType of ALL_EVENT_TYPES) {
        this.eventSource.addEventListener(evtType, this.handleIncomingEvent as EventListener);
      }

      this.eventSource.onerror = () => {
        if (this.isExplicitlyClosed) return;
        this.setStatus('reconnecting');
        this.cleanup();
        this.scheduleReconnect();
      };
    } catch (err) {
      console.warn('[SSE] Connection error:', err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.isExplicitlyClosed) return;
    this.reconnectAttempts++;
    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(1.5, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );
    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, delay);
  }

  subscribe(callback: EventCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  onStatusChange(callback: StatusCallback): () => void {
    this.statusListeners.add(callback);
    callback(this.currentStatus);
    return () => this.statusListeners.delete(callback);
  }

  close() {
    this.isExplicitlyClosed = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.cleanup();
    this.setStatus('disconnected');
  }

  private cleanup() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
