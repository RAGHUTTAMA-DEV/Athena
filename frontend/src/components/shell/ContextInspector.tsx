import React, { useState, useEffect } from 'react';
import {
  PanelRightClose,
  PanelRightOpen,
  FileCode,
  Terminal,
  RotateCcw,
} from 'lucide-react';
import { RunRecord, ApprovalRecord, ArtifactRecord } from '../../types/api';
import { StatusBadge } from '../primitives/StatusBadge';
import { MarkdownRenderer } from '../primitives/MarkdownRenderer';
import { apiClient } from '../../lib/api/client';

interface ContextInspectorProps {
  run?: RunRecord | null;
  isOpen: boolean;
  onToggle: () => void;
  onAbortRun?: (runId: string) => void;
}

export const ContextInspector: React.FC<ContextInspectorProps> = ({
  run,
  isOpen,
  onToggle,
  onAbortRun,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'events' | 'approvals' | 'artifacts'>('overview');
  const [recentRuns, setRecentRuns] = useState<RunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(run || null);
  const [events, setEvents] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactRecord[]>([]);

  useEffect(() => {
    if (run) {
      setSelectedRun(run);
    }
  }, [run]);

  const loadInspectorData = async (targetRun?: RunRecord | null) => {
    try {
      const runsList = await apiClient.listRuns(undefined, 15);
      setRecentRuns(runsList);

      const effective = targetRun || selectedRun || runsList[0] || null;
      if (effective && !selectedRun) {
        setSelectedRun(effective);
      }

      if (effective?.runId) {
        const [traceRes, artsRes] = await Promise.allSettled([
          apiClient.getRunTrace(effective.runId),
          apiClient.listArtifacts(),
        ]);

        if (traceRes.status === 'fulfilled') {
          if (traceRes.value.run) setSelectedRun(traceRes.value.run);
          setEvents(traceRes.value.events || []);
          setApprovals(traceRes.value.approvals || []);
        }
        if (artsRes.status === 'fulfilled') {
          setArtifacts(artsRes.value.filter((a) => a.runId === effective.runId));
        }
      }
    } catch {}
  };

  useEffect(() => {
    if (isOpen) {
      loadInspectorData(run || selectedRun);
    }
  }, [isOpen, run?.runId, selectedRun?.runId]);

  const activeRun = selectedRun || run;
  const pendingCount = approvals.filter((a) => a.status === 'pending').length;

  if (!isOpen) {
    // Entire collapsed vertical strip is clickable!
    return (
      <aside
        onClick={onToggle}
        title="Click to open Run Inspector"
        style={{
          width: 'var(--inspector-width-collapsed)',
          height: '100%',
          backgroundColor: 'var(--athena-surface)',
          borderLeft: '1px solid var(--athena-border)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '16px 0',
          userSelect: 'none',
          flexShrink: 0,
          cursor: 'pointer',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--athena-surface-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--athena-surface)')}
      >
        <div
          style={{
            padding: '6px',
            color: 'var(--athena-text-secondary)',
            borderRadius: 'var(--radius-xs)',
            marginBottom: '16px',
          }}
        >
          <PanelRightOpen size={16} />
        </div>

        <div
          style={{
            writingMode: 'vertical-rl',
            transform: 'rotate(180deg)',
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            fontWeight: 700,
            letterSpacing: '0.12em',
            color: 'var(--athena-text-muted)',
            textTransform: 'uppercase',
            margin: '24px 0',
          }}
        >
          RUN INSPECTOR
        </div>

        {activeRun && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '8px',
              margin: '12px 0',
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor:
                  activeRun.status === 'running'
                    ? 'var(--athena-success)'
                    : activeRun.status === 'approval_required'
                    ? 'var(--athena-warning)'
                    : 'var(--athena-text-muted)',
                boxShadow: activeRun.status === 'running' ? '0 0 6px var(--athena-success)' : 'none',
              }}
            />
            <span
              style={{
                writingMode: 'vertical-rl',
                transform: 'rotate(180deg)',
                fontSize: '9px',
                fontFamily: 'var(--font-mono)',
                fontWeight: 700,
                color:
                  activeRun.status === 'running'
                    ? 'var(--athena-success)'
                    : activeRun.status === 'approval_required'
                    ? 'var(--athena-warning)'
                    : 'var(--athena-text-muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {activeRun.status}
            </span>
          </div>
        )}

        {pendingCount > 0 && (
          <div
            style={{
              width: '18px',
              height: '18px',
              borderRadius: '50%',
              backgroundColor: 'var(--athena-surface-raised)',
              border: '1px solid var(--athena-warning)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '10px',
              fontWeight: 700,
              color: 'var(--athena-warning)',
              margin: '12px 0',
            }}
          >
            {pendingCount}
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside
      style={{
        width: '380px',
        height: '100%',
        backgroundColor: 'var(--athena-surface)',
        borderLeft: '1px solid var(--athena-border)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      }}
    >
      {/* Header */}
      <div
        style={{
          height: 'var(--header-height)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 14px',
          borderBottom: '1px solid var(--athena-border-subtle)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: 'var(--athena-text)',
              fontFamily: 'var(--font-mono)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activeRun?.runId || 'RUN INSPECTOR'}
          </span>
          {activeRun && <StatusBadge status={activeRun.status} size="sm" />}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            onClick={() => loadInspectorData(activeRun)}
            title="Refresh Trace"
            style={{ padding: '4px', color: 'var(--athena-text-muted)', cursor: 'pointer' }}
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={onToggle}
            title="Close Inspector"
            style={{ padding: '4px', color: 'var(--athena-text-secondary)', cursor: 'pointer' }}
          >
            <PanelRightClose size={15} />
          </button>
        </div>
      </div>

      {/* Run Switcher if multiple runs exist */}
      {recentRuns.length > 0 && (
        <div
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid var(--athena-border-subtle)',
            backgroundColor: 'var(--athena-surface-deep)',
          }}
        >
          <select
            value={activeRun?.runId || ''}
            onChange={(e) => {
              const found = recentRuns.find((r) => r.runId === e.target.value);
              if (found) setSelectedRun(found);
            }}
            style={{
              width: '100%',
              padding: '5px 8px',
              backgroundColor: 'var(--athena-surface-raised)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-xs)',
              fontSize: '11px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--athena-text)',
            }}
          >
            {recentRuns.map((r) => (
              <option key={r.runId} value={r.runId}>
                {r.runId} · {(r.task || '').slice(0, 32)} ({r.status})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--athena-border-subtle)',
          backgroundColor: 'var(--athena-surface-deep)',
          padding: '2px 8px 0 8px',
          gap: '4px',
        }}
      >
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'events', label: `Events (${events.length})` },
          { id: 'approvals', label: `Approvals (${approvals.length})` },
          { id: 'artifacts', label: `Artifacts (${artifacts.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            style={{
              padding: '6px 8px',
              fontSize: '11px',
              fontWeight: activeTab === tab.id ? 600 : 500,
              color: activeTab === tab.id ? 'var(--athena-text)' : 'var(--athena-text-muted)',
              borderBottom: activeTab === tab.id ? '2px solid var(--athena-accent)' : '2px solid transparent',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {!activeRun ? (
          <div style={{ textAlign: 'center', color: 'var(--athena-text-muted)', fontSize: '12px', padding: '32px 0' }}>
            No runs available to inspect yet.
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                    Task / Intent
                  </div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>
                    {activeRun.task || 'Autonomous Run'}
                  </div>
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    backgroundColor: 'var(--athena-surface-deep)',
                    border: '1px solid var(--athena-border)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px',
                    fontSize: '11px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--athena-text-muted)' }}>Session:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>{activeRun.sessionId}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--athena-text-muted)' }}>Turns:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>
                      {activeRun.currentTurn || 0} / {activeRun.budget?.maxTurns || 20}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--athena-text-muted)' }}>Tool Invocations:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>
                      {activeRun.usage?.toolCallsCount || 0}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--athena-text-muted)' }}>Tokens Total:</span>
                    <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>
                      {activeRun.usage?.tokens?.total || 0}
                    </span>
                  </div>
                </div>

                {activeRun.result && (
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                      Final Answer / Output
                    </div>
                    <div
                      style={{
                        backgroundColor: 'var(--athena-surface-deep)',
                        padding: '10px 12px',
                        borderRadius: 'var(--radius-xs)',
                        maxHeight: '260px',
                        overflowY: 'auto',
                      }}
                    >
                      <MarkdownRenderer
                        content={
                          typeof activeRun.result === 'string'
                            ? activeRun.result
                            : JSON.stringify(activeRun.result, null, 2)
                        }
                      />
                    </div>
                  </div>
                )}

                {activeRun.error && (
                  <div
                    style={{
                      padding: '10px',
                      backgroundColor: 'var(--athena-danger-dim)',
                      border: '1px solid var(--athena-danger)',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: '11px',
                      color: 'var(--athena-danger)',
                    }}
                  >
                    {typeof activeRun.error === 'string'
                      ? activeRun.error
                      : (
                        <div>
                          <div style={{ fontWeight: 700, marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>
                            [{activeRun.error.category?.toUpperCase() || 'ERROR'} · {activeRun.error.code || 'FAILED'}]
                          </div>
                          <div>{activeRun.error.message || JSON.stringify(activeRun.error)}</div>
                        </div>
                      )}
                  </div>
                )}

                {(activeRun.status === 'running' || activeRun.status === 'queued' || activeRun.status === 'approval_required') && (
                  <button
                    onClick={() => onAbortRun?.(activeRun.runId)}
                    style={{
                      marginTop: '8px',
                      padding: '7px 12px',
                      backgroundColor: 'var(--athena-danger-dim)',
                      border: '1px solid var(--athena-danger)',
                      color: 'var(--athena-danger)',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    Abort Execution Run
                  </button>
                )}
              </div>
            )}

            {activeTab === 'events' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {events.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)', textAlign: 'center', padding: '24px 0' }}>
                    No persisted execution events for this run.
                  </div>
                ) : (
                  events.map((ev, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '8px 10px',
                        backgroundColor: 'var(--athena-surface-deep)',
                        border: '1px solid var(--athena-border-subtle)',
                        borderRadius: 'var(--radius-xs)',
                        fontSize: '11px',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--athena-accent)' }}>
                          {ev.type} {ev.toolName ? `· ${ev.toolName}` : ''}
                        </span>
                        <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>
                          {ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : ''}
                        </span>
                      </div>
                      {ev.args && (
                        <pre style={{ margin: '4px 0 0 0', fontSize: '10px', color: 'var(--athena-text-secondary)', whiteSpace: 'pre-wrap' }}>
                          {JSON.stringify(ev.args)}
                        </pre>
                      )}
                      {ev.resultSummary && (
                        <div style={{ marginTop: '4px', fontSize: '10px', color: 'var(--athena-text-muted)', whiteSpace: 'pre-wrap' }}>
                          {String(ev.resultSummary).slice(0, 300)}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'approvals' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {approvals.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)', textAlign: 'center', padding: '24px 0' }}>
                    No approvals recorded for this run.
                  </div>
                ) : (
                  approvals.map((appr) => (
                    <div
                      key={appr.id}
                      style={{
                        padding: '10px',
                        backgroundColor: 'var(--athena-surface-deep)',
                        border: `1px solid ${appr.status === 'pending' ? 'var(--athena-warning)' : 'var(--athena-border)'}`,
                        borderRadius: 'var(--radius-sm)',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--athena-text)' }}>
                          {appr.action}
                        </span>
                        <StatusBadge status={appr.status} size="sm" />
                      </div>
                      <p style={{ fontSize: '11px', color: 'var(--athena-text-secondary)', margin: 0 }}>
                        {appr.explanation || 'Requires operator authorization.'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            )}

            {activeTab === 'artifacts' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {artifacts.length === 0 ? (
                  <div style={{ fontSize: '12px', color: 'var(--athena-text-muted)', textAlign: 'center', padding: '24px 0' }}>
                    No artifacts generated in this run.
                  </div>
                ) : (
                  artifacts.map((art) => (
                    <div
                      key={art.id}
                      style={{
                        padding: '8px 10px',
                        backgroundColor: 'var(--athena-surface-deep)',
                        border: '1px solid var(--athena-border)',
                        borderRadius: 'var(--radius-xs)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--athena-text)' }}>{art.name}</div>
                        <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>{art.type}</div>
                      </div>
                      <FileCode size={14} color="var(--athena-accent)" />
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
