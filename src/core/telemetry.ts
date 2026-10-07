import * as dotenv from 'dotenv';
dotenv.config();

import {
  startActiveObservation,
  propagateAttributes,
  getActiveTraceId,
  getActiveSpanId
} from '@langfuse/tracing';
import { Langfuse } from 'langfuse';

export interface TelemetrySpanRecord {
  id: string;
  name: string;
  traceId: string;
  parentSpanId?: string;
  type: 'trace' | 'generation' | 'tool' | 'event' | 'span';
  startTime: number;
  endTime?: number;
  durationMs?: number;
  attributes: Record<string, any>;
  input?: any;
  output?: any;
  error?: string;
  status: 'ok' | 'error';
}

export interface TraceContext {
  traceId: string;
  spanId?: string;
  traceparent?: string;
  runId?: string;
  parentRunId?: string;
  rootRunId?: string;
  sessionId?: string;
  goalId?: string;
  taskId?: string;
}

export interface GenerationSpanOptions {
  model?: string;
  input?: any;
  turn?: number;
  runId?: string;
  sessionId?: string;
}

export interface ToolSpanOptions {
  toolName: string;
  runId?: string;
  turn?: number;
  args?: Record<string, any>;
  callId?: string;
}

export class TelemetryManager {
  private static instance: TelemetryManager;
  private langfuseClient: Langfuse | null = null;
  private recordedSpans: TelemetrySpanRecord[] = [];
  private activeContext: TraceContext | null = null;
  private maxRecordedSpans = 2000;

  private constructor() {
    this.initClient();
  }

  static getInstance(): TelemetryManager {
    if (!TelemetryManager.instance) {
      TelemetryManager.instance = new TelemetryManager();
    }
    return TelemetryManager.instance;
  }

  private initClient(): void {
    if (process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY) {
      try {
        this.langfuseClient = new Langfuse({
          publicKey: process.env.LANGFUSE_PUBLIC_KEY,
          secretKey: process.env.LANGFUSE_SECRET_KEY,
          baseUrl: process.env.LANGFUSE_BASE_URL,
        });
      } catch (err) {
        console.warn('[TelemetryManager] Failed to initialize Langfuse client:', err);
      }
    }
  }

  public getClient(): Langfuse | null {
    return this.langfuseClient;
  }

  public isLangfuseEnabled(): boolean {
    return !!(process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);
  }

  /**
   * Generates a new unique 32-character hex trace ID (OpenTelemetry standard)
   */
  public generateTraceId(): string {
    try {
      const bytes = new Uint8Array(16);
      for (let i = 0; i < 16; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {
      return `tr_${Math.random().toString(36).substring(2, 12)}_${Date.now()}`;
    }
  }

  /**
   * Builds a standard W3C traceparent string: 00-{traceId}-{spanId}-01
   */
  public buildTraceparent(traceId: string, spanId?: string): string {
    const formattedTraceId = traceId.replace(/[^a-f0-9]/gi, '').padStart(32, '0').slice(-32);
    const formattedSpanId = (spanId || Math.random().toString(16).substring(2, 10))
      .replace(/[^a-f0-9]/gi, '')
      .padStart(16, '0')
      .slice(-16);
    return `00-${formattedTraceId}-${formattedSpanId}-01`;
  }

  /**
   * Injects current trace context into an outbound carrier object
   */
  public injectContext(carrier: Record<string, any> = {}): Record<string, any> {
    const currentTraceId = this.getCurrentTraceId();
    const currentSpanId = this.getCurrentSpanId();
    if (currentTraceId) {
      carrier['traceId'] = currentTraceId;
      carrier['traceparent'] = this.buildTraceparent(currentTraceId, currentSpanId);
      if (currentSpanId) carrier['parentSpanId'] = currentSpanId;
    }
    if (this.activeContext) {
      if (this.activeContext.runId) carrier['runId'] = this.activeContext.runId;
      if (this.activeContext.parentRunId) carrier['parentRunId'] = this.activeContext.parentRunId;
      if (this.activeContext.rootRunId) carrier['rootRunId'] = this.activeContext.rootRunId;
      if (this.activeContext.sessionId) carrier['sessionId'] = this.activeContext.sessionId;
      if (this.activeContext.goalId) carrier['goalId'] = this.activeContext.goalId;
      if (this.activeContext.taskId) carrier['taskId'] = this.activeContext.taskId;
    }
    return carrier;
  }

  /**
   * Extracts trace context from an inbound carrier (e.g. args, headers)
   */
  public extractContext(carrier: Record<string, any> | undefined): TraceContext | null {
    if (!carrier) return null;
    let traceId = carrier['traceId'] || carrier['trace_id'] || carrier['traceId'];
    const traceparent = carrier['traceparent'] || carrier['traceParent'];
    if (!traceId && traceparent && typeof traceparent === 'string') {
      const parts = traceparent.split('-');
      if (parts.length >= 3) {
        traceId = parts[1];
      }
    }
    if (!traceId) return null;

    return {
      traceId,
      spanId: carrier['parentSpanId'] || carrier['spanId'],
      traceparent,
      runId: carrier['runId'],
      parentRunId: carrier['parentRunId'],
      rootRunId: carrier['rootRunId'],
      sessionId: carrier['sessionId'],
      goalId: carrier['goalId'],
      taskId: carrier['taskId']
    };
  }

  public getCurrentTraceId(): string | undefined {
    try {
      const id = getActiveTraceId();
      if (id) return id;
    } catch {}
    return this.activeContext?.traceId;
  }

  public getCurrentSpanId(): string | undefined {
    try {
      const id = getActiveSpanId();
      if (id) return id;
    } catch {}
    return this.activeContext?.spanId;
  }

  public setActiveContext(ctx: TraceContext | null): void {
    this.activeContext = ctx;
  }

  public getActiveContext(): TraceContext | null {
    return this.activeContext;
  }

  /**
   * Starts a root trace/span for a Goal execution.
   */
  public async startGoalSpan<T>(
    goal: { id: string; title: string },
    fn: (ctx: TraceContext) => Promise<T>
  ): Promise<T> {
    const traceId = this.activeContext?.traceId || this.generateTraceId();
    const spanId = `span_goal_${Math.random().toString(36).substring(2, 10)}`;
    const startTime = Date.now();
    const previousContext = this.activeContext;

    const ctx: TraceContext = {
      traceId,
      spanId,
      goalId: goal.id,
      traceparent: this.buildTraceparent(traceId, spanId)
    };
    this.activeContext = ctx;

    const record: TelemetrySpanRecord = {
      id: spanId,
      name: `Goal: ${goal.title}`,
      traceId,
      parentSpanId: previousContext?.spanId,
      type: 'trace',
      startTime,
      attributes: {
        'athena.goal_id': goal.id,
        'athena.goal_title': goal.title
      },
      status: 'ok'
    };
    this.recordSpan(record);

    try {
      const result = await fn(ctx);
      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.status = 'ok';
      return result;
    } catch (err: any) {
      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.error = err.message;
      record.status = 'error';
      throw err;
    } finally {
      this.activeContext = previousContext;
    }
  }

  /**
   * Starts a child span for a Task execution under a Goal.
   */
  public async startTaskSpan<T>(
    task: { id: string; goalId: string; title: string },
    fn: (ctx: TraceContext) => Promise<T>
  ): Promise<T> {
    const traceId = this.activeContext?.traceId || this.generateTraceId();
    const spanId = `span_task_${Math.random().toString(36).substring(2, 10)}`;
    const startTime = Date.now();
    const previousContext = this.activeContext;

    const ctx: TraceContext = {
      traceId,
      spanId,
      goalId: task.goalId,
      taskId: task.id,
      traceparent: this.buildTraceparent(traceId, spanId)
    };
    this.activeContext = ctx;

    const record: TelemetrySpanRecord = {
      id: spanId,
      name: `Task: ${task.title}`,
      traceId,
      parentSpanId: previousContext?.spanId,
      type: 'span',
      startTime,
      attributes: {
        'athena.goal_id': task.goalId,
        'athena.task_id': task.id,
        'athena.task_title': task.title
      },
      status: 'ok'
    };
    this.recordSpan(record);

    try {
      const result = await fn(ctx);
      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.status = 'ok';
      return result;
    } catch (err: any) {
      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.error = err.message;
      record.status = 'error';
      throw err;
    } finally {
      this.activeContext = previousContext;
    }
  }

  /**
   * Starts a trace for an Agent execution, aligning attributes
   */
  public async startAgentTrace<T>(
    name: string,
    metadata: {
      runId: string;
      parentRunId?: string;
      rootRunId: string;
      sessionId: string;
      goalId?: string;
      taskId?: string;
      task: string;
      modelName: string;
      maxTurns?: number;
      depth?: number;
    },
    fn: (traceSpan: any) => Promise<T>
  ): Promise<T> {
    const traceId = this.activeContext?.traceId || this.generateTraceId();
    const spanId = `span_${Math.random().toString(36).substring(2, 10)}`;
    const startTime = Date.now();

    const previousContext = this.activeContext;
    const parentSpanId = previousContext?.spanId;

    this.activeContext = {
      traceId,
      spanId,
      runId: metadata.runId,
      parentRunId: metadata.parentRunId,
      rootRunId: metadata.rootRunId,
      sessionId: metadata.sessionId,
      goalId: metadata.goalId || previousContext?.goalId,
      taskId: metadata.taskId || previousContext?.taskId,
      traceparent: this.buildTraceparent(traceId, spanId)
    };

    const record: TelemetrySpanRecord = {
      id: spanId,
      name,
      traceId,
      parentSpanId,
      type: 'trace',
      startTime,
      attributes: {
        'athena.run_id': metadata.runId,
        'athena.parent_run_id': metadata.parentRunId,
        'athena.root_run_id': metadata.rootRunId,
        'athena.session_id': metadata.sessionId,
        'athena.goal_id': metadata.goalId || previousContext?.goalId,
        'athena.task_id': metadata.taskId || previousContext?.taskId,
        'athena.task': metadata.task,
        'athena.model': metadata.modelName,
        'athena.max_turns': metadata.maxTurns,
        'athena.depth': metadata.depth || 0,
      },
      input: metadata.task,
      status: 'ok'
    };
    this.recordSpan(record);

    try {
      let result: T;
      if (!this.isLangfuseEnabled()) {
        result = await fn({
          update: (data: any) => {
            if (data.output) record.output = data.output;
            if (data.metadata) Object.assign(record.attributes, data.metadata);
          }
        });
      } else {
        let fnExecuted = false;
        try {
          result = await startActiveObservation(
            name,
            async (traceSpan) => {
              traceSpan.update({
                input: metadata.task,
                metadata: {
                  ...record.attributes,
                  traceId,
                  spanId,
                }
              });

              return propagateAttributes(
                {
                  sessionId: metadata.sessionId,
                  tags: [name, metadata.runId],
                  metadata: {
                    runId: metadata.runId,
                    parentRunId: metadata.parentRunId || '',
                    rootRunId: metadata.rootRunId,
                  }
                },
                async () => {
                  fnExecuted = true;
                  return fn(traceSpan);
                }
              );
            }
          );
        } catch (err: any) {
          if (fnExecuted) {
            throw err;
          }
          // Fallback execution if observation wrapper itself is unavailable or errors
          result = await fn({
            update: (data: any) => {
              if (data.output) record.output = data.output;
              if (data.metadata) Object.assign(record.attributes, data.metadata);
            }
          });
        }
      }

      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.output = typeof result === 'string' ? result : JSON.stringify(result);
      record.status = 'ok';
      return result;
    } catch (err: any) {
      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.error = err.message;
      record.status = 'error';
      throw err;
    } finally {
      this.activeContext = previousContext;
    }
  }

  /**
   * Starts an observation span for an LLM Generation turn
   */
  public async startGenerationSpan<T>(
    name: string,
    options: GenerationSpanOptions,
    fn: (generation: any) => Promise<T>
  ): Promise<T> {
    const traceId = this.getCurrentTraceId() || this.generateTraceId();
    const spanId = `gen_${Math.random().toString(36).substring(2, 10)}`;
    const startTime = Date.now();

    const record: TelemetrySpanRecord = {
      id: spanId,
      name,
      traceId,
      parentSpanId: this.getCurrentSpanId(),
      type: 'generation',
      startTime,
      attributes: {
        'athena.run_id': options.runId || this.activeContext?.runId,
        'athena.session_id': options.sessionId || this.activeContext?.sessionId,
        'athena.turn': options.turn,
        'gen_ai.system': 'llm',
        'gen_ai.request.model': options.model,
      },
      input: options.input,
      status: 'ok'
    };
    this.recordSpan(record);

    try {
      let res: T;
      const handleUpdate = (data: any) => {
        if (data.output) record.output = data.output;
        if (data.usageDetails) {
          record.attributes['gen_ai.usage.input_tokens'] = data.usageDetails.input || 0;
          record.attributes['gen_ai.usage.output_tokens'] = data.usageDetails.output || 0;
          record.attributes['gen_ai.usage.total_tokens'] = data.usageDetails.total || 0;
        }
        if (data.metadata) Object.assign(record.attributes, data.metadata);
      };

      if (!this.isLangfuseEnabled()) {
        res = await fn({
          update: handleUpdate
        });
      } else {
        let fnExecuted = false;
        try {
          res = await startActiveObservation(
            name,
            async (generation) => {
              generation.update({
                input: typeof options.input === 'string' ? options.input : JSON.stringify(options.input),
                model: options.model,
                metadata: {
                  turn: options.turn,
                  runId: options.runId || this.activeContext?.runId
                }
              });
              const wrappedGen = {
                update: (data: any) => {
                  try { generation.update(data); } catch {}
                  handleUpdate(data);
                }
              };
              fnExecuted = true;
              return fn(wrappedGen);
            },
            { asType: 'generation' }
          );
        } catch (err: any) {
          if (fnExecuted) {
            throw err;
          }
          // Fallback
          res = await fn({
            update: handleUpdate
          });
        }
      }

      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.output = typeof res === 'object' ? JSON.stringify(res) : String(res);
      return res;
    } catch (err: any) {
      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.error = err.message;
      record.status = 'error';
      throw err;
    }
  }

  /**
   * Starts an observation span for Tool execution
   */
  public async startToolSpan<T>(
    options: ToolSpanOptions,
    fn: (span: any) => Promise<T>
  ): Promise<T> {
    const traceId = this.getCurrentTraceId() || this.generateTraceId();
    const spanId = `tool_${options.toolName}_${Math.random().toString(36).substring(2, 10)}`;
    const startTime = Date.now();

    const record: TelemetrySpanRecord = {
      id: spanId,
      name: `tool:${options.toolName}`,
      traceId,
      parentSpanId: this.getCurrentSpanId(),
      type: 'tool',
      startTime,
      attributes: {
        'athena.run_id': options.runId || this.activeContext?.runId,
        'athena.turn': options.turn,
        'tool.name': options.toolName,
        'tool.call_id': options.callId,
      },
      input: options.args,
      status: 'ok'
    };
    this.recordSpan(record);

    try {
      let res: T;
      const handleToolUpdate = (data: any) => {
        if (data.output) record.output = data.output;
        if (data.metadata) Object.assign(record.attributes, data.metadata);
      };

      if (!this.isLangfuseEnabled()) {
        res = await fn({
          update: handleToolUpdate
        });
      } else {
        let fnExecuted = false;
        try {
          res = await startActiveObservation(
            `tool:${options.toolName}`,
            async (toolSpan) => {
              toolSpan.update({
                input: JSON.stringify(options.args || {}),
                metadata: {
                  ...record.attributes,
                }
              });
              const wrappedSpan = {
                update: (data: any) => {
                  try { toolSpan.update(data); } catch {}
                  handleToolUpdate(data);
                }
              };
              fnExecuted = true;
              return fn(wrappedSpan);
            },
            { asType: 'tool' }
          );
        } catch (err: any) {
          if (fnExecuted) {
            throw err;
          }
          res = await fn({
            update: handleToolUpdate
          });
        }
      }

      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.output = typeof res === 'object' ? JSON.stringify(res) : String(res);
      record.attributes['tool.duration_ms'] = record.durationMs;

      // Extract result metadata if available
      const anyRes = res as any;
      if (anyRes && typeof anyRes === 'object') {
        record.attributes['tool.status'] = anyRes.success ? 'success' : 'error';
        if (anyRes.error) {
          record.attributes['tool.error_code'] = anyRes.error.code || 'ERROR';
          record.status = 'error';
          record.error = anyRes.error.message || JSON.stringify(anyRes.error);
        }
        if (anyRes.metadata?.truncated) record.attributes['tool.truncated'] = true;
        if (anyRes.metadata?.artifactPath) record.attributes['tool.artifact_path'] = anyRes.metadata.artifactPath;
      }

      return res;
    } catch (err: any) {
      record.endTime = Date.now();
      record.durationMs = record.endTime - startTime;
      record.error = err.message;
      record.status = 'error';
      record.attributes['tool.status'] = 'error';
      record.attributes['tool.duration_ms'] = record.durationMs;
      throw err;
    }
  }

  /**
   * Internal span recorder for in-memory trajectory debugging and tests
   */
  private recordSpan(span: TelemetrySpanRecord): void {
    this.recordedSpans.push(span);
    if (this.recordedSpans.length > this.maxRecordedSpans) {
      this.recordedSpans.shift();
    }
  }

  /**
   * Retrieves all recorded in-memory spans, optionally filtered by runId or traceId
   */
  public getRecordedSpans(filter?: { runId?: string; traceId?: string; type?: string }): TelemetrySpanRecord[] {
    if (!filter) return [...this.recordedSpans];
    return this.recordedSpans.filter((s) => {
      if (filter.runId && s.attributes['athena.run_id'] !== filter.runId) return false;
      if (filter.traceId && s.traceId !== filter.traceId) return false;
      if (filter.type && s.type !== filter.type) return false;
      return true;
    });
  }

  public clearRecordedSpans(): void {
    this.recordedSpans = [];
  }

  public async flushAsync(): Promise<void> {
    if (this.langfuseClient) {
      try {
        await this.langfuseClient.flushAsync();
      } catch (err) {
        console.warn('[TelemetryManager] Failed to flush Langfuse:', err);
      }
    }
  }
}
