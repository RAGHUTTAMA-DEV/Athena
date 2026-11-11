import { RunStore } from '../../storage/stores/types.js';
import { RunState } from '../../runtime/runState.js';
import { SSEManager } from '../events/sseManager.js';
import { createEventEnvelope } from '../events/eventEnvelope.js';
import { ApprovalService } from './approvalService.js';

function kindOfTool(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('skill')) return 'Skill';
  if (n.includes('semantic') || n.includes('memory')) return 'Memory';
  if (n.includes('cron')) return 'Scheduler';
  if (n === 'delegate_task' || n === 'agent_delegate') return 'Sub-agent';
  if (n.includes('coding') || n === 'bash' || n.includes('file') || n.includes('dir')) return 'Coding';
  if (n.includes('browser') || n.includes('browse') || n.includes('search') || n.includes('web_')) return 'Browser';
  if (/^(gmail|calendar|notion|excalidraw|filesystem)_/.test(n)) return 'MCP';
  return 'Tool';
}

function splitSubagentPrefix(message: string): { child?: string; rest: string } {
  const m = message.match(/^\[(sub-agent-[^\]]+|[^\]]+)\]\s*(.*)$/s);
  if (m && (m[1].startsWith('sub-agent-') || m[2].startsWith('Calling tool:') || m[2].startsWith('Tool ') || m[2].startsWith('Thinking'))) {
    return { child: m[1], rest: m[2] };
  }
  return { rest: message };
}

export interface DispatchMessageInput {
  sessionId: string;
  content: string;
  idempotencyKey?: string;
  attachments?: any[];
  metadata?: Record<string, any>;
  workspaceId?: number;
}

export interface DispatchResult {
  messageId: string;
  runId: string;
  status: string;
  eventsUrl: string;
  isDuplicate?: boolean;
}

export type AgentRunCallbacks = {
  onUpdate: (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void;
  confirm: (toolName: string, args: any) => Promise<boolean>;
};

export type AgentRunner = (
  input: DispatchMessageInput,
  runId: string,
  callbacks: AgentRunCallbacks
) => Promise<string>;

export class DispatchService {
  private idempotencyCache: Map<string, DispatchResult> = new Map();

  constructor(
    private runStore: RunStore,
    private sseManager: SSEManager,
    private runner?: AgentRunner,
    private approvalService?: ApprovalService
  ) {}

  async submitMessage(input: DispatchMessageInput): Promise<DispatchResult> {
    if (!input.content || input.content.trim() === '') {
      throw new Error('Message content cannot be empty');
    }

    // 1. Idempotency check
    if (input.idempotencyKey && this.idempotencyCache.has(input.idempotencyKey)) {
      const cached = this.idempotencyCache.get(input.idempotencyKey)!;
      return { ...cached, isDuplicate: true };
    }

    const now = Date.now();
    const runId = `run_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const messageId = `msg_${now}_${Math.random().toString(36).slice(2, 7)}`;

    // 2. Persist Initial Run State
    const runState: RunState = {
      runId,
      rootRunId: runId,
      sessionId: input.sessionId,
      task: input.content,
      status: 'queued',
      currentTurn: 0,
      budget: { maxTurns: 20 },
      usage: {
        elapsedTimeMs: 0,
        tokens: { input: 0, output: 0, total: 0 },
        costUsd: 0,
        toolCallsCount: 0,
        turnsCount: 0
      },
      idempotencyKeys: input.idempotencyKey ? [input.idempotencyKey] : [],
      createdAt: now,
      updatedAt: now
    };

    await this.runStore.save(runState);

    // 3. Emit SSE Lifecycle Events
    this.sseManager.broadcast(
      createEventEnvelope('message.started', { messageId, content: input.content }, {
        runId,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId ? String(input.workspaceId) : undefined
      })
    );

    this.sseManager.broadcast(
      createEventEnvelope('run.queued', { runId, status: 'queued' }, {
        runId,
        sessionId: input.sessionId,
        workspaceId: input.workspaceId ? String(input.workspaceId) : undefined
      })
    );

    const result: DispatchResult = {
      messageId,
      runId,
      status: 'queued',
      eventsUrl: `/api/v1/runs/${runId}/events`
    };

    if (input.idempotencyKey) {
      this.idempotencyCache.set(input.idempotencyKey, result);
    }

    // 4. Asynchronously launch background agent execution if a runner is attached
    if (this.runner) {
      setImmediate(() => {
        this.executeRun(input, runId, messageId).catch((err) => {
          console.error(`[DispatchService] Unhandled error in run ${runId}:`, err);
        });
      });
    }

    return result;
  }

  private async executeRun(input: DispatchMessageInput, runId: string, messageId: string): Promise<void> {
    if (!this.runner) return;

    try {
      await this.runStore.update(runId, { status: 'running' });
      this.sseManager.broadcast(
        createEventEnvelope('run.started', { runId, status: 'running' }, {
          runId,
          sessionId: input.sessionId
        })
      );

      const finalAnswer = await this.runner(input, runId, {
        onUpdate: (status) => {
          const { child, rest } = splitSubagentPrefix(status.message || '');

          if (status.type === 'thought' || status.type === 'memory') {
            this.sseManager.broadcast(
              createEventEnvelope('agent.progress', {
                runId,
                stage: status.type,
                kind: status.type === 'memory' ? 'Memory' : 'Thinking',
                child,
                message: rest
              }, {
                runId,
                sessionId: input.sessionId
              })
            );
          } else if (status.type === 'tool_call') {
            let toolName = rest;
            let toolArgs: any = undefined;
            const match = rest.match(/^Calling tool:\s*([^\s]+)\s+with args:\s*([\s\S]*)$/);
            if (match) {
              toolName = match[1];
              try {
                toolArgs = JSON.parse(match[2]);
              } catch {
                toolArgs = match[2];
              }
            }
            this.sseManager.broadcast(
              createEventEnvelope('tool.started', {
                runId,
                tool: toolName,
                kind: kindOfTool(toolName),
                child,
                args: toolArgs,
                message: rest
              }, {
                runId,
                sessionId: input.sessionId
              })
            );
          } else if (status.type === 'tool_response') {
            let toolName: string | undefined;
            let resultBody = rest;
            const match = rest.match(/^Tool\s+(\S+)\s+returned:\s*([\s\S]*)$/);
            const offloadMatch = rest.match(/^Tool\s+(\S+)\s+output offloaded to disk:\s*([\s\S]*)$/);
            if (match) {
              toolName = match[1];
              resultBody = match[2];
            } else if (offloadMatch) {
              toolName = offloadMatch[1];
              resultBody = `Output offloaded to disk: ${offloadMatch[2]}`;
            }
            this.sseManager.broadcast(
              createEventEnvelope('tool.completed', {
                runId,
                tool: toolName,
                kind: toolName ? kindOfTool(toolName) : 'Tool',
                child,
                result: resultBody,
                message: rest
              }, {
                runId,
                sessionId: input.sessionId
              })
            );
          } else if (status.type === 'error') {
            this.sseManager.broadcast(
              createEventEnvelope('agent.progress', {
                runId,
                stage: 'error',
                kind: 'Warning',
                child,
                message: rest
              }, {
                runId,
                sessionId: input.sessionId
              })
            );
          }
        },
        confirm: async (toolName: string, args: any) => {
          if (this.approvalService) {
            try {
              await this.runStore.update(runId, { status: 'approval_required' });
              this.sseManager.broadcast(
                createEventEnvelope('run.waiting_for_approval', {
                  runId,
                  status: 'approval_required',
                  tool: toolName
                }, {
                  runId,
                  sessionId: input.sessionId
                })
              );
            } catch {}

            const approved = await this.approvalService.requestApproval({
              runId,
              sessionId: input.sessionId,
              action: toolName,
              params: args
            });

            try {
              await this.runStore.update(runId, { status: 'running' });
              this.sseManager.broadcast(
                createEventEnvelope('run.progress', {
                  runId,
                  status: 'running',
                  stage: approved ? 'approval_granted' : 'approval_denied'
                }, {
                  runId,
                  sessionId: input.sessionId
                })
              );
            } catch {}

            return approved;
          }
          return true;
        }
      });

      await this.runStore.update(runId, {
        status: 'completed',
        terminationReason: 'goal_achieved',
        result: finalAnswer
      });

      this.sseManager.broadcast(
        createEventEnvelope('message.completed', {
          messageId: `msg_resp_${Date.now()}`,
          replyToMessageId: messageId,
          role: 'assistant',
          content: finalAnswer
        }, {
          runId,
          sessionId: input.sessionId
        })
      );

      this.sseManager.broadcast(
        createEventEnvelope('run.completed', {
          runId,
          status: 'completed',
          finalAnswer
        }, {
          runId,
          sessionId: input.sessionId
        })
      );
    } catch (err: any) {
      await this.runStore.update(runId, {
        status: 'failed',
        terminationReason: 'unrecoverable_error',
        error: {
          category: 'bug',
          code: 'EXECUTION_ERROR',
          message: err.message,
          retryable: false
        }
      });

      this.sseManager.broadcast(
        createEventEnvelope('run.progress', {
          runId,
          stage: 'failed',
          error: err.message
        }, {
          runId,
          sessionId: input.sessionId
        })
      );
    }
  }
}
