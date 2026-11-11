import React, { useState } from 'react';
import { ChevronDown, ChevronRight, Loader2, CheckCircle2, XCircle, Terminal } from 'lucide-react';
import { FlowStep } from '../../types/api';

interface ExecutionFlowRailProps {
  steps: FlowStep[];
  isRunning?: boolean;
  defaultExpanded?: boolean;
}

const KIND_COLORS: Record<string, string> = {
  System: '#D4B46A',
  Ready: '#8EAD9A',
  Memory: '#6BB8E8',
  Skill: '#8EAD9A',
  Browser: '#5EB5A6',
  Coding: '#D4B46A',
  'Sub-agent': '#D99B52',
  MCP: '#D4B46A',
  Scheduler: '#C77D7D',
  Tool: '#D99B52',
  Thinking: '#8B9194',
  Warning: '#C77D7D',
};

function kindOfTool(name?: string): string {
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

function compactPreview(val: any, maxLen = 110): string {
  if (val === undefined || val === null) return '';
  let str = '';
  if (typeof val === 'string') {
    str = val.replace(/\s+/g, ' ').trim();
  } else {
    try {
      str = JSON.stringify(val);
    } catch {
      str = String(val);
    }
  }
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

export const ExecutionFlowRail: React.FC<ExecutionFlowRailProps> = ({
  steps,
  isRunning = false,
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded || isRunning);
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  if (!steps || steps.length === 0) return null;

  const toolCount = steps.filter((s) => !!s.tool).length;
  const effectiveExpanded = isRunning ? true : isExpanded;

  return (
    <div
      style={{
        marginBottom: '12px',
        backgroundColor: '#131416',
        border: '1px solid var(--athena-border)',
        borderRadius: 'var(--radius-sm)',
        overflow: 'hidden',
        maxWidth: '820px',
      }}
    >
      {/* Rail Header Bar */}
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 12px',
          backgroundColor: 'var(--athena-surface-deep)',
          borderBottom: effectiveExpanded ? '1px solid var(--athena-border-subtle)' : 'none',
          fontSize: '11px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--athena-text-secondary)',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {effectiveExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <Terminal size={12} color="var(--athena-accent)" />
          <span style={{ fontWeight: 600, color: 'var(--athena-text)' }}>
            {isRunning ? 'Agent Thinking & Tool Flow (Live)' : 'Execution Flow'}
          </span>
          <span style={{ color: 'var(--athena-text-muted)', fontSize: '10px' }}>
            {steps.length} steps{toolCount > 0 ? ` · ${toolCount} tool${toolCount > 1 ? 's' : ''}` : ''}
          </span>
        </div>

        {isRunning && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--athena-success)', fontSize: '10px' }}>
            <Loader2 size={11} className="animate-spin" />
            <span>streaming</span>
          </div>
        )}
      </button>

      {/* Chronological Hermes/Terminal Flow Rail */}
      {effectiveExpanded && (
        <div
          style={{
            padding: '10px 14px',
            fontFamily: 'var(--font-mono)',
            fontSize: '11.5px',
            lineHeight: 1.5,
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            maxHeight: '420px',
            overflowY: 'auto',
          }}
        >
          {steps.map((step, idx) => {
            const resolvedKind = step.tool ? kindOfTool(step.tool) : step.kind || 'Thinking';
            const color = KIND_COLORS[resolvedKind] || '#A8B6AE';
            const hasDetails = !!(step.args || step.result || step.detail);
            const itemOpen = !!expandedItems[step.id || String(idx)];
            const isStepRunning = step.status === 'running';

            return (
              <div key={step.id || idx} style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Primary Rail Line: ◆ Kind   title */}
                <div
                  onClick={() => {
                    if (hasDetails) {
                      setExpandedItems((prev) => ({
                        ...prev,
                        [step.id || String(idx)]: !prev[step.id || String(idx)],
                      }));
                    }
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    cursor: hasDetails ? 'pointer' : 'default',
                    padding: '1px 0',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', minWidth: 0, flex: 1 }}>
                    <span style={{ color, fontSize: '10px', flexShrink: 0 }}>◆</span>
                    <span
                      style={{
                        color,
                        fontWeight: 700,
                        width: '78px',
                        flexShrink: 0,
                        fontSize: '11px',
                      }}
                    >
                      {resolvedKind}
                    </span>
                    <span
                      style={{
                        color: 'var(--athena-text)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {step.child && (
                        <span style={{ color: '#D99B52', marginRight: '6px' }}>[{step.child}]</span>
                      )}
                      {step.title}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                    {isStepRunning ? (
                      <Loader2 size={11} color={color} className="animate-spin" />
                    ) : step.tool && step.status === 'completed' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#8EAD9A', fontSize: '10px' }}>
                        <CheckCircle2 size={11} />
                        {step.durationMs ? `${step.durationMs}ms` : 'ok'}
                      </span>
                    ) : step.tool && step.status === 'failed' ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#C77D7D', fontSize: '10px' }}>
                        <XCircle size={11} />
                        err
                      </span>
                    ) : null}
                  </div>
                </div>

                {/* Rail Sub-lines: │ preview */}
                {step.detail && !itemOpen && (
                  <div style={{ display: 'flex', gap: '8px', paddingLeft: '17px', color: 'var(--athena-text-muted)', fontSize: '11px' }}>
                    <span style={{ color, opacity: 0.7 }}>│</span>
                    <span style={{ whiteSpace: 'pre-wrap' }}>{step.detail}</span>
                  </div>
                )}

                {step.args && !itemOpen && (
                  <div
                    onClick={() =>
                      setExpandedItems((prev) => ({
                        ...prev,
                        [step.id || String(idx)]: true,
                      }))
                    }
                    style={{
                      display: 'flex',
                      gap: '8px',
                      paddingLeft: '17px',
                      color: 'var(--athena-text-muted)',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ color, opacity: 0.7 }}>│</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {compactPreview(step.args)}
                    </span>
                  </div>
                )}

                {step.result && !itemOpen && (
                  <div
                    onClick={() =>
                      setExpandedItems((prev) => ({
                        ...prev,
                        [step.id || String(idx)]: true,
                      }))
                    }
                    style={{
                      display: 'flex',
                      gap: '8px',
                      paddingLeft: '17px',
                      color: '#8B9194',
                      fontSize: '11px',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ color, opacity: 0.7 }}>│</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      ↳ {compactPreview(step.result)}
                    </span>
                  </div>
                )}

                {/* Expanded Full JSON / Output */}
                {itemOpen && hasDetails && (
                  <div
                    style={{
                      marginLeft: '17px',
                      marginTop: '4px',
                      marginBottom: '6px',
                      paddingLeft: '10px',
                      borderLeft: `2px solid ${color}`,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    {step.detail && (
                      <div style={{ color: 'var(--athena-text-secondary)', whiteSpace: 'pre-wrap', fontSize: '11px' }}>
                        {step.detail}
                      </div>
                    )}
                    {step.args && (
                      <div>
                        <div style={{ fontSize: '9px', color: 'var(--athena-text-muted)', marginBottom: '2px' }}>ARGS</div>
                        <pre
                          style={{
                            margin: 0,
                            padding: '6px 8px',
                            backgroundColor: '#191B1E',
                            borderRadius: '3px',
                            color: '#D4D6D9',
                            fontSize: '11px',
                            whiteSpace: 'pre-wrap',
                            overflowX: 'auto',
                          }}
                        >
                          {typeof step.args === 'string' ? step.args : JSON.stringify(step.args, null, 2)}
                        </pre>
                      </div>
                    )}
                    {step.result && (
                      <div>
                        <div style={{ fontSize: '9px', color: 'var(--athena-text-muted)', marginBottom: '2px' }}>RETURNED</div>
                        <pre
                          style={{
                            margin: 0,
                            padding: '6px 8px',
                            backgroundColor: '#191B1E',
                            borderRadius: '3px',
                            color: '#A8B6AE',
                            fontSize: '11px',
                            whiteSpace: 'pre-wrap',
                            maxHeight: '220px',
                            overflowY: 'auto',
                          }}
                        >
                          {typeof step.result === 'string' ? step.result : JSON.stringify(step.result, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

