import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  RotateCcw,
  Terminal,
  MessageSquare,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  ShieldAlert,
  ArrowUpRight,
} from 'lucide-react';
import { RunRecord, RunTraceResponse } from '../../types/api';
import { StatusBadge } from '../../components/primitives/StatusBadge';
import { MarkdownRenderer } from '../../components/primitives/MarkdownRenderer';
import { apiClient } from '../../lib/api/client';

interface ActivityPageProps {
  onSelectSession?: (sessionId: string) => void;
}

export const ActivityPage: React.FC<ActivityPageProps> = ({ onSelectSession }) => {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [traceData, setTraceData] = useState<RunTraceResponse | null>(null);
  const [isTraceLoading, setIsTraceLoading] = useState(false);

  const fetchRuns = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await apiClient.listRuns(undefined, 100);
      setRuns(data);
    } catch (err: any) {
      setError(err?.message || 'Failed to load runs from backend');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchRuns();
  }, []);

  const handleSelectRun = async (run: RunRecord) => {
    setSelectedRunId(run.runId);
    setIsTraceLoading(true);
    try {
      const trace = await apiClient.getRunTrace(run.runId);
      setTraceData(trace);
    } catch (err) {
      // Fallback to basic run record if trace fails
      setTraceData({ run, events: [], approvals: [], replaySteps: [] });
    } finally {
      setIsTraceLoading(false);
    }
  };

  const handleOpenInChat = (sessionId: string) => {
    onSelectSession?.(sessionId);
    navigate('/');
  };

  const filteredRuns = runs.filter((r) => {
    if (filter !== 'all' && r.status !== filter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const task = (typeof r.task === 'string' ? r.task : '').toLowerCase();
      const id = (r.runId || '').toLowerCase();
      const sess = (r.sessionId || '').toLowerCase();
      return task.includes(q) || id.includes(q) || sess.includes(q);
    }
    return true;
  });

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%', overflow: 'hidden' }}>
      {/* Left: Runs List */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '24px 28px',
          minWidth: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <div>
            <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--athena-text)', marginBottom: '4px' }}>
              Run Activity
            </h1>
            <p style={{ fontSize: '12px', color: 'var(--athena-text-muted)' }}>
              Click any run to inspect its full execution timeline, tool calls, and output, or jump into its chat session.
            </p>
          </div>

          <button
            onClick={fetchRuns}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '5px 10px',
              backgroundColor: 'var(--athena-surface)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-xs)',
              fontSize: '11px',
              color: 'var(--athena-text-secondary)',
              cursor: 'pointer',
            }}
          >
            <RotateCcw size={12} />
            <span>Reload</span>
          </button>
        </div>

        {error && (
          <div
            style={{
              marginBottom: '16px',
              padding: '10px 14px',
              backgroundColor: 'var(--athena-danger-dim)',
              border: '1px solid var(--athena-danger)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--athena-danger)',
              fontSize: '12px',
            }}
          >
            {error}
          </div>
        )}

        {/* Filter and Search Bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
          <div
            style={{
              flex: 1,
              minWidth: '220px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              backgroundColor: 'var(--athena-surface)',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
            }}
          >
            <Search size={14} color="var(--athena-text-muted)" />
            <input
              type="text"
              placeholder="Search runs by ID, session, or prompt..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: '100%', fontSize: '12px' }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              gap: '4px',
              backgroundColor: 'var(--athena-surface)',
              padding: '2px',
              border: '1px solid var(--athena-border)',
              borderRadius: 'var(--radius-xs)',
            }}
          >
            {['all', 'running', 'approval_required', 'completed', 'failed', 'cancelled'].map((st) => (
              <button
                key={st}
                onClick={() => setFilter(st)}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  fontWeight: filter === st ? 600 : 500,
                  color: filter === st ? 'var(--athena-text)' : 'var(--athena-text-muted)',
                  backgroundColor: filter === st ? 'var(--athena-surface-raised)' : 'transparent',
                  borderRadius: 'var(--radius-xs)',
                  textTransform: 'capitalize',
                  cursor: 'pointer',
                }}
              >
                {st.replace('_', ' ')}
              </button>
            ))}
          </div>
        </div>

        {/* Runs Table */}
        <div
          style={{
            backgroundColor: 'var(--athena-surface)',
            border: '1px solid var(--athena-border)',
            borderRadius: 'var(--radius-sm)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr 130px 120px 80px',
              padding: '8px 16px',
              borderBottom: '1px solid var(--athena-border-subtle)',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              fontWeight: 700,
              color: 'var(--athena-text-muted)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            <span>Run ID</span>
            <span>Task / Prompt</span>
            <span>Status</span>
            <span>Session</span>
            <span style={{ textAlign: 'right' }}>Time</span>
          </div>

          {filteredRuns.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--athena-text-muted)', fontSize: '12px' }}>
              {isLoading ? 'Loading runs from storage...' : 'No runs found in database.'}
            </div>
          ) : (
            filteredRuns.map((r) => {
              const isSelected = r.runId === selectedRunId;
              return (
                <div
                  key={r.runId}
                  onClick={() => handleSelectRun(r)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '140px 1fr 130px 120px 80px',
                    alignItems: 'center',
                    padding: '12px 16px',
                    borderBottom: '1px solid var(--athena-border-subtle)',
                    fontSize: '12px',
                    backgroundColor: isSelected ? 'var(--athena-surface-raised)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--athena-surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--athena-text)', fontSize: '11px' }}>
                    {r.runId}
                  </span>
                  <div style={{ minWidth: 0, paddingRight: '12px' }}>
                    <div style={{ fontWeight: 600, color: 'var(--athena-text)', marginBottom: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {typeof r.task === 'string' ? r.task : 'Autonomous Run'}
                    </div>
                    {r.result && (
                      <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {typeof r.result === 'string' ? r.result : JSON.stringify(r.result)}
                      </div>
                    )}
                    {!r.result && r.error && (
                      <div style={{ fontSize: '11px', color: 'var(--athena-danger)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {typeof r.error === 'string' ? r.error : `${r.error.code || 'ERROR'}: ${r.error.message || JSON.stringify(r.error)}`}
                      </div>
                    )}
                  </div>
                  <div>
                    <StatusBadge status={r.status} size="sm" />
                  </div>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text-secondary)', fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.sessionId}
                  </span>
                  <span style={{ color: 'var(--athena-text-muted)', textAlign: 'right', fontSize: '11px' }}>
                    {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right: Run Detail Trace Drawer */}
      {selectedRunId && (
        <aside
          style={{
            width: '440px',
            height: '100%',
            backgroundColor: 'var(--athena-surface)',
            borderLeft: '1px solid var(--athena-border)',
            display: 'flex',
            flexDirection: 'column',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--athena-border-subtle)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '12px', fontWeight: 700, color: 'var(--athena-text)' }}>
                {selectedRunId}
              </span>
              {traceData?.run && <StatusBadge status={traceData.run.status} size="sm" />}
            </div>

            <button
              onClick={() => {
                setSelectedRunId(null);
                setTraceData(null);
              }}
              style={{ padding: '4px', color: 'var(--athena-text-muted)', cursor: 'pointer' }}
            >
              <X size={15} />
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: '18px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
            {isTraceLoading ? (
              <div style={{ textAlign: 'center', color: 'var(--athena-text-muted)', fontSize: '12px', padding: '32px 0' }}>
                Loading execution trace...
              </div>
            ) : traceData ? (
              <>
                {/* Jump to Chat CTA */}
                <button
                  onClick={() => handleOpenInChat(traceData.run.sessionId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                    width: '100%',
                    padding: '8px 12px',
                    backgroundColor: 'var(--athena-accent)',
                    color: '#171819',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <MessageSquare size={14} />
                  <span>Open Conversation in Workspace</span>
                  <ArrowUpRight size={14} />
                </button>

                {/* Prompt */}
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                    User Prompt
                  </div>
                  <div
                    style={{
                      fontSize: '12px',
                      color: 'var(--athena-text)',
                      backgroundColor: 'var(--athena-surface-deep)',
                      padding: '10px 12px',
                      borderRadius: 'var(--radius-xs)',
                      border: '1px solid var(--athena-border-subtle)',
                    }}
                  >
                    {traceData.run.task}
                  </div>
                </div>

                {/* Metrics */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: '8px',
                    fontSize: '11px',
                  }}
                >
                  <div style={{ padding: '8px 10px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ color: 'var(--athena-text-muted)', fontSize: '10px' }}>Session</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>{traceData.run.sessionId}</div>
                  </div>
                  <div style={{ padding: '8px 10px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ color: 'var(--athena-text-muted)', fontSize: '10px' }}>Tool Calls / Turns</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>
                      {traceData.run.usage?.toolCallsCount || 0} tools · {traceData.run.currentTurn || 0} turns
                    </div>
                  </div>
                  <div style={{ padding: '8px 10px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ color: 'var(--athena-text-muted)', fontSize: '10px' }}>Tokens</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>
                      {traceData.run.usage?.tokens?.total || 0} total
                    </div>
                  </div>
                  <div style={{ padding: '8px 10px', backgroundColor: 'var(--athena-surface-deep)', borderRadius: 'var(--radius-xs)' }}>
                    <div style={{ color: 'var(--athena-text-muted)', fontSize: '10px' }}>Duration</div>
                    <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--athena-text)' }}>
                      {traceData.run.usage?.elapsedTimeMs ? `${(traceData.run.usage.elapsedTimeMs / 1000).toFixed(1)}s` : '—'}
                    </div>
                  </div>
                </div>

                {/* Output / Error */}
                {traceData.run.result && (
                  <div>
                    <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase', marginBottom: '4px' }}>
                      Final Response
                    </div>
                    <div
                      style={{
                        backgroundColor: 'var(--athena-surface-deep)',
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-xs)',
                        maxHeight: '280px',
                        overflowY: 'auto',
                      }}
                    >
                      <MarkdownRenderer
                        content={
                          typeof traceData.run.result === 'string'
                            ? traceData.run.result
                            : JSON.stringify(traceData.run.result, null, 2)
                        }
                      />
                    </div>
                  </div>
                )}

                {traceData.run.error && (
                  <div
                    style={{
                      padding: '10px 12px',
                      backgroundColor: 'var(--athena-danger-dim)',
                      border: '1px solid var(--athena-danger)',
                      borderRadius: 'var(--radius-xs)',
                      fontSize: '12px',
                      color: 'var(--athena-danger)',
                    }}
                  >
                    {typeof traceData.run.error === 'string'
                      ? traceData.run.error
                      : `[${traceData.run.error.code}] ${traceData.run.error.message}`}
                  </div>
                )}

                {/* Execution Events / Tool Calls */}
                <div>
                  <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Execution Events & Tool Calls ({traceData.events.length})
                  </div>

                  {traceData.events.length === 0 ? (
                    <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)' }}>
                      No granular tool events recorded for this run.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {traceData.events.map((ev: any, idx: number) => (
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
                      ))}
                    </div>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </aside>
      )}
    </div>
  );
};
