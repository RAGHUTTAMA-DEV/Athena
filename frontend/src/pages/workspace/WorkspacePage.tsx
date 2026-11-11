import React, { useState, useEffect, useRef } from 'react';
import {
  AlertCircle,
  Sparkles,
  Terminal,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  XCircle,
  ShieldAlert,
  RotateCcw,
} from 'lucide-react';
import { ChatMessage, RunRecord, ApprovalRecord, FlowStep } from '../../types/api';
import { Composer, ComposerAttachment } from '../../components/domain/Composer';
import { InlineApprovalCard } from '../../components/domain/InlineApprovalCard';
import { ExecutionFlowRail } from '../../components/domain/ExecutionFlowRail';
import { StatusBadge } from '../../components/primitives/StatusBadge';
import { MarkdownRenderer } from '../../components/primitives/MarkdownRenderer';
import { apiClient } from '../../lib/api/client';
import { AthenaSSEClient } from '../../lib/events/sseClient';

function formatSafeText(val: any): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object' && 'message' in val) {
    return `${val.code ? `[${val.code}] ` : ''}${val.message}`;
  }
  return JSON.stringify(val, null, 2);
}

function formatTimestamp(ts: string | number): string {
  if (typeof ts === 'string' && ts.includes(':') && !ts.includes('T')) return ts;
  const date = new Date(ts);
  if (isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface WorkspacePageProps {
  sessionId: string;
  onOpenInspector?: () => void;
  onSelectRun?: (run: RunRecord | null) => void;
  onSessionActivity?: () => void;
}

export const WorkspacePage: React.FC<WorkspacePageProps> = ({
  sessionId,
  onOpenInspector,
  onSelectRun,
  onSessionActivity,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeRun, setActiveRun] = useState<RunRecord | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showFlowView, setShowFlowView] = useState<boolean>(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [
    messages.length,
    messages[messages.length - 1]?.content,
    messages[messages.length - 1]?.flowSteps?.length,
    messages[messages.length - 1]?.approvals?.length,
  ]);

  const loadSessionData = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      const [stateRes, msgsRes] = await Promise.allSettled([
        apiClient.getSessionState(sessionId),
        apiClient.getSessionMessages(sessionId),
      ]);

      if (stateRes.status === 'fulfilled') {
        setActiveRun(stateRes.value.activeRun || null);
        onSelectRun?.(stateRes.value.activeRun || null);
      }

      if (msgsRes.status === 'fulfilled') {
        const loaded: ChatMessage[] = (msgsRes.value.messages || []).map((m: any) => ({
          id: m.id,
          sender: m.sender,
          senderName: m.senderName,
          content: formatSafeText(m.content),
          error: m.error,
          status: m.status,
          timestamp: m.timestamp,
          runId: m.runId,
          toolCalls: m.toolCalls || [],
          flowSteps: m.flowSteps || [],
          approvals: m.approvals || [],
          thoughts: m.thoughts || [],
        }));
        setMessages(loaded);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Unable to connect to local Athena backend.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    setMessages([]);
    setActiveRun(null);
    loadSessionData();

    const sse = new AthenaSSEClient(`/api/v1/sessions/${sessionId}/events`);

    const upsertAgentMessage = (
      prev: ChatMessage[],
      runId: string,
      updater: (m: ChatMessage) => ChatMessage
    ): ChatMessage[] => {
      const idx = prev.findIndex((m) => m.sender === 'agent' && m.runId === runId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = updater(next[idx]);
        return next;
      }
      const base: ChatMessage = {
        id: `agent_${runId}`,
        sender: 'agent',
        senderName: 'Athena',
        content: '',
        timestamp: Date.now(),
        runId,
        status: 'running',
        thoughts: [],
        toolCalls: [],
        flowSteps: [],
        approvals: [],
      };
      return [...prev, updater(base)];
    };

    sse.subscribe((envelope) => {
      const runId = envelope.runId || envelope.data?.runId;
      if (!runId) return;

      if (envelope.type === 'agent.progress') {
        const msgText = envelope.data?.message;
        if (!msgText) return;
        const kind = envelope.data?.kind || (envelope.data?.stage === 'memory' ? 'Memory' : envelope.data?.stage === 'error' ? 'Warning' : 'Thinking');
        const child = envelope.data?.child;

        const step: FlowStep = {
          id: envelope.eventId || `step_${Date.now()}_${Math.random()}`,
          kind,
          child,
          title: kind === 'Memory' ? 'retrieved from the archive' : msgText,
          detail: kind === 'Memory' ? msgText : undefined,
          status: 'done',
          timestamp: Date.now(),
        };

        setMessages((prev) =>
          upsertAgentMessage(prev, runId, (m) => ({
            ...m,
            thoughts: [...(m.thoughts || []), msgText],
            flowSteps: [...(m.flowSteps || []), step],
          }))
        );
      } else if (envelope.type === 'tool.started') {
        const toolName = envelope.data?.tool || 'tool';
        const args = envelope.data?.args;
        const kind = envelope.data?.kind || 'Tool';
        const child = envelope.data?.child;

        const step: FlowStep = {
          id: envelope.eventId || `tool_${Date.now()}_${Math.random()}`,
          kind,
          child,
          tool: toolName,
          title: toolName,
          args,
          status: 'running',
          timestamp: Date.now(),
        };

        setMessages((prev) =>
          upsertAgentMessage(prev, runId, (m) => ({
            ...m,
            toolCalls: [
              ...(m.toolCalls || []),
              { tool: toolName, args, status: 'running' as const },
            ],
            flowSteps: [...(m.flowSteps || []), step],
          }))
        );
      } else if (envelope.type === 'tool.completed') {
        const resultText = envelope.data?.result;
        const toolName = envelope.data?.tool;
        setMessages((prev) =>
          upsertAgentMessage(prev, runId, (m) => {
            const calls = [...(m.toolCalls || [])];
            const runningIdx = calls.findIndex((t) => (!toolName || t.tool === toolName) && t.status === 'running');
            if (runningIdx >= 0) {
              calls[runningIdx] = {
                ...calls[runningIdx],
                status: 'completed',
                result: resultText,
              };
            }

            const steps = [...(m.flowSteps || [])];
            const stepIdx = steps.findIndex((s) => s.tool && (!toolName || s.tool === toolName) && s.status === 'running');
            if (stepIdx >= 0) {
              steps[stepIdx] = {
                ...steps[stepIdx],
                status: 'completed',
                result: resultText,
                durationMs: steps[stepIdx].timestamp ? Date.now() - steps[stepIdx].timestamp! : undefined,
              };
            }

            return { ...m, toolCalls: calls, flowSteps: steps };
          })
        );
      } else if (envelope.type === 'approval.required') {
        const apprData = envelope.data;
        const newAppr: ApprovalRecord = {
          id: apprData.approvalId,
          approvalId: apprData.approvalId,
          runId,
          action: apprData.action,
          riskLevel: apprData.riskLevel || 'medium',
          explanation: apprData.explanation,
          proposedAction: apprData.params,
          status: 'pending',
          createdAt: Date.now(),
          expiresAt: apprData.expiresAt,
        };

        setMessages((prev) =>
          upsertAgentMessage(prev, runId, (m) => {
            const existing = m.approvals || [];
            if (existing.some((a) => (a.id || a.approvalId) === newAppr.id)) return m;
            return {
              ...m,
              status: 'approval_required',
              approvals: [...existing, newAppr],
            };
          })
        );
        onSessionActivity?.();
      } else if (envelope.type === 'approval.resolved') {
        const { approvalId, status } = envelope.data;
        setMessages((prev) =>
          prev.map((m) => {
            if (!m.approvals) return m;
            return {
              ...m,
              status: status === 'approved' ? 'running' : m.status,
              approvals: m.approvals.map((a) =>
                (a.id || a.approvalId) === approvalId ? { ...a, status } : a
              ),
            };
          })
        );
        onSessionActivity?.();
      } else if (envelope.type === 'message.completed') {
        const content = formatSafeText(envelope.data?.content);
        setMessages((prev) =>
          upsertAgentMessage(prev, runId, (m) => ({
            ...m,
            content,
            status: 'completed',
          }))
        );
        onSessionActivity?.();
      } else if (envelope.type === 'run.completed' || envelope.type === 'run.started' || envelope.type === 'run.queued' || envelope.type === 'run.waiting_for_approval') {
        apiClient.getRun(runId).then((updated) => {
          setActiveRun(updated);
          onSelectRun?.(updated);
          setMessages((prev) =>
            upsertAgentMessage(prev, runId, (m) => ({
              ...m,
              status: updated.status,
              content: updated.result ? formatSafeText(updated.result) : m.content,
              error: updated.error,
            }))
          );
        }).catch(() => {});
        onSessionActivity?.();
      } else if (envelope.type === 'run.progress' && envelope.data?.stage === 'failed') {
        const errText = envelope.data?.error || 'Execution failed';
        setMessages((prev) =>
          upsertAgentMessage(prev, runId, (m) => ({
            ...m,
            status: 'failed',
            error: errText,
          }))
        );
        onSessionActivity?.();
      }
    });

    sse.connect();

    return () => {
      sse.close();
    };
  }, [sessionId]);

  const handleSendMessage = async (text: string, attachments?: ComposerAttachment[]) => {
    if ((!text.trim() && (!attachments || attachments.length === 0)) || isSending) return;

    const attachmentNames = attachments && attachments.length > 0
      ? `\n\n[Attached: ${attachments.map((a) => {
          const tags: string[] = [];
          if (a.format) tags.push(a.format.toUpperCase());
          if (a.pageCount) tags.push(`${a.pageCount}p`);
          if (a.mediaCount) tags.push(`${a.mediaCount} photo${a.mediaCount > 1 ? 's' : ''}`);
          if (a.hasIndexPage) tags.push('Index');
          return tags.length > 0 ? `${a.name} (${tags.join(', ')})` : a.name;
        }).join(', ')}]`
      : '';

    const now = Date.now();
    const userMsg: ChatMessage = {
      id: `user_${now}`,
      sender: 'user',
      content: `${text}${attachmentNames}`,
      timestamp: now,
    };

    setMessages((prev) => [...prev, userMsg]);
    setIsSending(true);
    setErrorMessage(null);

    try {
      const result = await apiClient.submitMessage(sessionId, text, attachments);

      const agentMsg: ChatMessage = {
        id: `agent_${result.runId}`,
        sender: 'agent',
        senderName: 'Athena',
        content: '',
        timestamp: Date.now(),
        runId: result.runId,
        status: 'queued',
        thoughts: [],
        toolCalls: [],
        approvals: [],
      };
      setMessages((prev) => {
        if (prev.some((m) => m.sender === 'agent' && m.runId === result.runId)) return prev;
        return [...prev, agentMsg];
      });

      apiClient.getRun(result.runId).then((r) => {
        setActiveRun(r);
        onSelectRun?.(r);
      }).catch(() => {});

      onSessionActivity?.();
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err_${Date.now()}`,
          sender: 'system',
          senderName: 'System Error',
          content: `Failed to dispatch run: ${err.message || 'Network or server error'}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  const handleApprovalDecision = async (approvalId: string, decision: 'approved' | 'rejected') => {
    await apiClient.decideApproval(approvalId, decision);
    setMessages((prev) =>
      prev.map((m) => ({
        ...m,
        approvals: m.approvals?.map((a) =>
          (a.id || a.approvalId) === approvalId ? { ...a, status: decision } : a
        ),
      }))
    );
    onSessionActivity?.();
  };

  // Check if any pending approvals exist in the current chat
  const pendingInChat = messages.flatMap((m) => m.approvals || []).filter((a) => a.status === 'pending');

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        overflow: 'hidden',
      }}
    >
      {/* Secondary Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 28px',
          borderBottom: '1px solid var(--athena-border-subtle)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)', flexShrink: 0 }}>
            Workspace
          </span>
          <span
            style={{
              fontSize: '12px',
              color: 'var(--athena-text-muted)',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            · {sessionId}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {activeRun && <StatusBadge status={activeRun.status} size="sm" />}

          <button
            onClick={() => setShowFlowView((prev) => !prev)}
            title="Toggle Hermes/Terminal Thinking & Tool Flow View"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              fontSize: '11px',
              color: showFlowView ? '#171819' : 'var(--athena-text-secondary)',
              backgroundColor: showFlowView ? 'var(--athena-accent)' : 'var(--athena-surface)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-xs)',
              padding: '3px 8px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Terminal size={12} />
            <span>{showFlowView ? 'Flow View: On' : 'Flow View: Off'}</span>
          </button>

          {activeRun && onOpenInspector && (
            <button
              onClick={onOpenInspector}
              style={{
                fontSize: '11px',
                color: 'var(--athena-text-secondary)',
                padding: '3px 8px',
                border: '1px solid var(--athena-border)',
                borderRadius: 'var(--radius-xs)',
                backgroundColor: 'var(--athena-surface)',
                cursor: 'pointer',
              }}
            >
              Inspect Run
            </button>
          )}

          <button
            onClick={loadSessionData}
            title="Refresh session from backend"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '11px',
              color: 'var(--athena-text-muted)',
              cursor: 'pointer',
              padding: '3px 6px',
            }}
          >
            <RotateCcw size={12} />
            <span>Sync</span>
          </button>
        </div>
      </div>

      {/* Main Scrollable Chat Surface */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 28px',
        }}
      >
        {errorMessage && (
          <div
            style={{
              maxWidth: '880px',
              margin: '0 auto 16px auto',
              padding: '10px 14px',
              backgroundColor: 'var(--athena-danger-dim)',
              border: '1px solid var(--athena-danger)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--athena-danger)',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle size={15} />
            <span>{errorMessage}</span>
          </div>
        )}

        {messages.length === 0 && !isLoading ? (
          <div
            style={{
              maxWidth: '720px',
              margin: '60px auto',
              textAlign: 'center',
              padding: '44px 24px',
              border: '1px dashed var(--athena-border)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--athena-surface-deep)',
            }}
          >
            <Sparkles size={26} color="var(--athena-accent)" style={{ marginBottom: '12px' }} />
            <h2 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--athena-text)', marginBottom: '6px' }}>
              Start a conversation with Athena
            </h2>
            <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)', maxWidth: '460px', margin: '0 auto' }}>
              Ask Athena to research, run commands, edit files, or manage goals. Live tool execution and permission prompts will appear directly in this stream.
            </p>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '24px',
              maxWidth: '880px',
              margin: '0 auto',
            }}
          >
            {messages.map((msg) => {
              const isUser = msg.sender === 'user';
              const isSystem = msg.sender === 'system';
              const isActive = msg.status === 'running' || msg.status === 'queued' || msg.status === 'approval_required';

              const flowSteps: FlowStep[] =
                msg.flowSteps && msg.flowSteps.length > 0
                  ? msg.flowSteps
                  : (msg.toolCalls || []).map((tc, i) => ({
                      id: `${msg.id}_tc_${i}`,
                      kind: 'Tool',
                      tool: tc.tool,
                      title: tc.tool,
                      args: tc.args,
                      result: tc.result,
                      status: tc.status === 'failed' ? 'failed' : tc.status === 'completed' ? 'completed' : 'running',
                      durationMs: tc.durationMs,
                    }));

              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    gap: '14px',
                    alignItems: 'flex-start',
                  }}
                >
                  {/* Avatar */}
                  <div
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: 'var(--radius-sm)',
                      backgroundColor: 'var(--athena-surface-raised)',
                      border: `1px solid ${isSystem ? 'var(--athena-danger)' : 'var(--athena-border)'}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: '2px',
                    }}
                  >
                    {isUser ? (
                      <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text-secondary)' }}>
                        Y
                      </span>
                    ) : isSystem ? (
                      <AlertCircle size={14} color="var(--athena-danger)" />
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        width="14"
                        height="14"
                        fill="none"
                        stroke="var(--athena-accent)"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M12 3 L3 20 L21 20 Z" />
                        <path d="M12 9 L7.5 17 L16.5 17 Z" stroke="var(--athena-text-secondary)" strokeWidth="1.5" />
                      </svg>
                    )}
                  </div>

                  {/* Message Column */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>
                        {isUser ? 'You' : msg.senderName || 'Athena'}
                      </span>
                      <span style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>
                        {formatTimestamp(msg.timestamp)}
                      </span>
                      {!isUser && !isSystem && (
                        <span
                          style={{
                            fontSize: '9px',
                            fontWeight: 700,
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            padding: '1px 5px',
                            borderRadius: 'var(--radius-xs)',
                            color: 'var(--athena-text-muted)',
                            border: '1px solid var(--athena-border)',
                            backgroundColor: 'var(--athena-surface)',
                          }}
                        >
                          AGENT
                        </span>
                      )}
                      {msg.status && isActive && <StatusBadge status={msg.status} size="sm" />}
                    </div>

                    {/* Unified Hermes / Terminal Execution Flow Rail */}
                    {!isUser && !isSystem && flowSteps.length > 0 && (
                      <ExecutionFlowRail
                        key={`${msg.id}_${showFlowView}`}
                        steps={flowSteps}
                        isRunning={isActive}
                        defaultExpanded={showFlowView}
                      />
                    )}

                    {/* Inline Approvals Right Inside Chat! */}
                    {msg.approvals && msg.approvals.length > 0 && (
                      <div style={{ marginBottom: '12px' }}>
                        {msg.approvals.map((appr) => (
                          <InlineApprovalCard
                            key={appr.id || appr.approvalId}
                            approval={appr}
                            onDecide={handleApprovalDecision}
                          />
                        ))}
                      </div>
                    )}

                    {/* Message Text / Result */}
                    {msg.content ? (
                      isUser ? (
                        <div
                          style={{
                            fontSize: '13.5px',
                            color: 'var(--athena-text)',
                            lineHeight: 1.6,
                            wordBreak: 'break-word',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {msg.content}
                        </div>
                      ) : (
                        <MarkdownRenderer content={msg.content} />
                      )
                    ) : isActive && (!msg.approvals || msg.approvals.every((a) => a.status !== 'pending')) ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--athena-text-muted)' }}>
                        <Loader2 size={13} className="animate-spin" />
                        <span>
                          {msg.status === 'queued'
                            ? 'Queued for execution...'
                            : 'Athena is working...'}
                        </span>
                      </div>
                    ) : null}

                    {/* Run Error Display */}
                    {msg.error && (
                      <div
                        style={{
                          marginTop: '10px',
                          padding: '10px 12px',
                          backgroundColor: 'var(--athena-danger-dim)',
                          border: '1px solid var(--athena-danger)',
                          borderRadius: 'var(--radius-xs)',
                          fontSize: '12px',
                          color: 'var(--athena-danger)',
                        }}
                      >
                        {formatSafeText(msg.error)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Attention Banner if Pending Approval exists */}
      {pendingInChat.length > 0 && (
        <div
          style={{
            padding: '8px 28px',
            backgroundColor: 'var(--athena-warning-dim)',
            borderTop: '1px solid var(--athena-warning)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '12px',
            color: 'var(--athena-warning)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
            <ShieldAlert size={15} />
            <span>
              Athena is waiting for your permission above to execute "{pendingInChat[0].action}".
            </span>
          </div>
          <button
            onClick={scrollToBottom}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Jump to prompt
          </button>
        </div>
      )}

      {/* Composer */}
      <div
        style={{
          padding: '12px 28px 18px 28px',
          borderTop: '1px solid var(--athena-border-subtle)',
          backgroundColor: 'var(--athena-canvas)',
          flexShrink: 0,
        }}
      >
        <Composer
          sessionId={sessionId}
          onSendMessage={handleSendMessage}
          isSending={isSending}
          disabled={isSending}
          placeholder="Message Athena... (type @ to reference workspace files, or attach/drop PDFs, DOCX, Images)"
        />
      </div>
    </div>
  );
};
