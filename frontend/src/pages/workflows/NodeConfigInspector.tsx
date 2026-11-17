import React, { useState, useMemo } from 'react';
import { X, Trash2, Sliders, Zap, CheckCircle, Search, Wrench, Plug, Copy, Check, FileText } from 'lucide-react';
import { MarkdownRenderer } from '../../components/primitives/MarkdownRenderer';

export interface ToolItem {
  name: string;
  description?: string;
  category?: string;
  isMcp?: boolean;
  mcpServer?: string;
  source?: 'mcp' | 'builtin';
}

const WORKFLOW_DOMAIN_TOOLS: ToolItem[] = [
  {
    name: 'fetch_pr_diff',
    description: 'Fetch GitHub Pull Request diff, title, changed files, and patch metadata',
    category: 'Workflow Domain',
    isMcp: false,
    source: 'builtin'
  },
  {
    name: 'post_pr_review',
    description: 'Publish review comment and approval/changes verdict back to GitHub PR',
    category: 'Workflow Domain',
    isMcp: false,
    source: 'builtin'
  },
  {
    name: 'run_tests',
    description: 'Execute automated regression test suite or unit tests',
    category: 'Workflow Domain',
    isMcp: false,
    source: 'builtin'
  },
  {
    name: 'create_pr',
    description: 'Create a new GitHub pull request with title, branch, and description',
    category: 'Workflow Domain',
    isMcp: false,
    source: 'builtin'
  },
  {
    name: 'send_telegram',
    description: 'Send an executive dossier or briefing alert directly to Telegram channel/chat',
    category: 'Workflow Domain',
    isMcp: false,
    source: 'builtin'
  },
  {
    name: 'noop',
    description: 'Pass-through step with no side effects',
    category: 'Workflow Domain',
    isMcp: false,
    source: 'builtin'
  }
];

interface NodeConfigInspectorProps {
  node: any;
  allNodes: any[];
  availableTools?: (string | ToolItem)[];
  onChange: (updatedNode: any) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

export const NodeConfigInspector: React.FC<NodeConfigInspectorProps> = ({
  node,
  allNodes,
  availableTools = [],
  onChange,
  onDelete,
  onClose
}) => {
  if (!node) return null;

  const nodeType = node.type;
  const config = node.config || {};
  const currentToolValue = config.tool || (node as any).tool || 'noop';
  const [toolFilter, setToolFilter] = useState('');

  const normalizedTools: ToolItem[] = useMemo(() => {
    const rawList = availableTools && availableTools.length > 0 ? availableTools : [];
    const knownMcp = ['calendar', 'gmail', 'github', 'notion', 'excalidraw', 'filesystem'];

    const mapped: ToolItem[] = rawList.map(item => {
      if (typeof item === 'string') {
        const mcpPrefix = knownMcp.find(p => item.startsWith(p + '_'));
        return {
          name: item,
          isMcp: Boolean(mcpPrefix),
          mcpServer: mcpPrefix,
          source: (mcpPrefix ? 'mcp' : 'builtin') as 'mcp' | 'builtin',
          category: mcpPrefix ? `MCP: ${mcpPrefix.toUpperCase()}` : 'Built-in Athena'
        };
      }
      const isMcp = Boolean(
        item.isMcp ||
        (item as any).tags?.includes('mcp') ||
        item.description?.startsWith('[MCP:') ||
        knownMcp.some(p => item.name?.startsWith(p + '_'))
      );
      let mcpServer = item.mcpServer;
      if (isMcp && !mcpServer) {
        const match = item.description?.match(/\[MCP:\s*([^\]]+)\]/);
        mcpServer = match ? match[1].trim() : knownMcp.find(p => item.name?.startsWith(p + '_'));
      }
      return {
        name: item.name,
        description: item.description,
        isMcp,
        mcpServer,
        source: (isMcp ? 'mcp' : 'builtin') as 'mcp' | 'builtin',
        category: isMcp ? `MCP: ${(mcpServer || 'Server').toUpperCase()}` : 'Built-in Athena'
      };
    });

    // Start with WORKFLOW_DOMAIN_TOOLS first
    const combined: ToolItem[] = [...WORKFLOW_DOMAIN_TOOLS];
    const seen = new Set(WORKFLOW_DOMAIN_TOOLS.map(t => t.name));

    for (const item of mapped) {
      if (!seen.has(item.name)) {
        seen.add(item.name);
        combined.push(item);
      }
    }

    // Always ensure currentToolValue is present in the list so it is never missing from <select>
    if (currentToolValue && !seen.has(currentToolValue)) {
      const mcpPrefix = knownMcp.find(p => currentToolValue.startsWith(p + '_'));
      combined.unshift({
        name: currentToolValue,
        description: 'Configured tool function for this node',
        isMcp: Boolean(mcpPrefix),
        mcpServer: mcpPrefix,
        source: (mcpPrefix ? 'mcp' : 'builtin') as 'mcp' | 'builtin',
        category: mcpPrefix ? `MCP: ${mcpPrefix.toUpperCase()}` : 'Configured Tool'
      });
    }

    return combined;
  }, [availableTools, currentToolValue]);

  const toolGroups = useMemo(() => {
    const groups: Record<string, ToolItem[]> = {};

    // 1. Workflow domain tools first
    const domainTools = normalizedTools.filter(t => WORKFLOW_DOMAIN_TOOLS.some(d => d.name === t.name));
    if (domainTools.length > 0) {
      groups['🎯 Workflow Actions & Domain Tools'] = domainTools;
    }

    // 2. MCP Tools grouped by server
    const mcpServers = ['calendar', 'gmail', 'github', 'notion', 'excalidraw', 'filesystem'];
    for (const server of mcpServers) {
      const serverTools = normalizedTools.filter(t => t.isMcp && t.mcpServer?.toLowerCase() === server);
      if (serverTools.length > 0) {
        groups[`🔌 MCP: ${server.toUpperCase()} (${serverTools.length})`] = serverTools;
      }
    }

    // Other MCP tools
    const otherMcp = normalizedTools.filter(t => t.isMcp && (!t.mcpServer || !mcpServers.includes(t.mcpServer.toLowerCase())));
    if (otherMcp.length > 0) {
      groups[`🔌 MCP: OTHER SERVERS (${otherMcp.length})`] = otherMcp;
    }

    // 3. Built-in Athena Tools
    const builtinTools = normalizedTools.filter(t => !t.isMcp && !WORKFLOW_DOMAIN_TOOLS.some(d => d.name === t.name));
    if (builtinTools.length > 0) {
      groups[`⚡ Built-in Athena Tools (${builtinTools.length})`] = builtinTools;
    }

    return groups;
  }, [normalizedTools]);

  const updateConfig = (field: string, val: any) => {
    const updated = {
      ...node,
      [field]: val,
      config: {
        ...config,
        [field]: val
      }
    };
    onChange(updated);
  };

  const updateRootField = (field: string, val: any) => {
    onChange({ ...node, [field]: val });
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '6px 8px',
    marginTop: '4px',
    backgroundColor: 'var(--athena-surface-deep, #191A1C)',
    border: '1px solid var(--athena-border, #303234)',
    borderRadius: 'var(--radius-xs, 2px)',
    color: 'var(--athena-text, #EDEEEF)',
    fontSize: '11px',
    fontFamily: 'var(--font-sans)',
    outline: 'none'
  };

  const selectStyle: React.CSSProperties = {
    ...inputStyle,
    cursor: 'pointer'
  };

  const labelStyle: React.CSSProperties = {
    fontSize: '11px',
    color: 'var(--athena-text-muted, #777D80)',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.04em'
  };

  return (
    <div style={{
      width: '360px',
      flexShrink: 0,
      backgroundColor: 'var(--athena-surface, #1D1E20)',
      borderLeft: '1px solid var(--athena-border, #303234)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      overflowY: 'auto',
      padding: '16px',
      color: 'var(--athena-text, #EDEEEF)',
      fontFamily: 'var(--font-sans)',
      boxShadow: '-4px 0 12px rgba(0, 0, 0, 0.25)',
      zIndex: 15
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sliders size={14} color="var(--athena-accent, #A8B6AE)" />
          <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--athena-text)' }}>Node Inspector</span>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => onDelete(node.id)}
            title="Delete this node"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--athena-danger, #C77D7D)',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <Trash2 size={13} />
          </button>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--athena-text-muted)',
              cursor: 'pointer',
              padding: '4px'
            }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* ── Node Execution Output Section ───────────────────────────── */}
      {node.output !== undefined && (
        <div style={{
          marginBottom: '16px',
          padding: '12px',
          backgroundColor: 'var(--athena-surface-deep, #191A1C)',
          border: '1px solid var(--athena-border-subtle, #252729)',
          borderRadius: 'var(--radius-xs, 2px)',
          display: 'flex',
          flexDirection: 'column',
          gap: '8px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--athena-success)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Zap size={11} fill="var(--athena-success)" /> Execution Output
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                onClick={() => {
                  const text = typeof node.output === 'string'
                    ? node.output
                    : JSON.stringify(node.output, null, 2);
                  navigator.clipboard.writeText(text);
                }}
                title="Copy output"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: '2px 6px',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--athena-border-subtle)',
                  borderRadius: '2px',
                  color: 'var(--athena-text-muted)',
                  fontSize: '10px',
                  cursor: 'pointer'
                }}
              >
                <Copy size={10} />
                <span>Copy</span>
              </button>
              <span style={{
                fontSize: '9px',
                fontWeight: 600,
                padding: '1px 5px',
                borderRadius: '2px',
                backgroundColor: 'var(--athena-success-dim, rgba(142, 173, 154, 0.15))',
                color: 'var(--athena-success)',
                textTransform: 'uppercase'
              }}>
                {node.status || 'completed'}
              </span>
            </div>
          </div>

          {/* Render String / Markdown Output */}
          {typeof node.output === 'string' && (
            <div style={{
              maxHeight: '380px',
              overflowY: 'auto',
              padding: '10px 12px',
              backgroundColor: 'var(--athena-canvas, #171819)',
              borderRadius: 'var(--radius-xs)',
              border: '1px solid var(--athena-border-subtle)',
              fontSize: '12px',
              color: 'var(--athena-text)',
              lineHeight: '1.5'
            }}>
              <MarkdownRenderer content={node.output} />
            </div>
          )}

          {/* Structured Output Cards */}
          {typeof node.output === 'object' && node.output !== null && (() => {
            const out = node.output;

            // Check if object contains embedded markdown text
            const embeddedText = typeof out.content === 'string' ? out.content :
              typeof out.text === 'string' ? out.text :
              typeof out.result === 'string' ? out.result :
              typeof out.report === 'string' ? out.report :
              typeof out.markdown === 'string' ? out.markdown :
              typeof out.briefing === 'string' ? out.briefing : null;

            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Agent Verdict output */}
                {out.verdict !== undefined && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '2px',
                        backgroundColor: String(out.verdict).toLowerCase() === 'approve' ? 'rgba(142, 173, 154, 0.2)' : 'rgba(199, 125, 125, 0.2)',
                        color: String(out.verdict).toLowerCase() === 'approve' ? 'var(--athena-success)' : 'var(--athena-danger)',
                        textTransform: 'uppercase'
                      }}>
                        Verdict: {out.verdict}
                      </span>
                      {out.score !== undefined && (
                        <span style={{ fontSize: '11px', fontWeight: 600, color: 'var(--athena-text)' }}>
                          Score: {out.score}/100
                        </span>
                      )}
                    </div>
                    {out.notes && (
                      <div style={{ fontSize: '11px', color: 'var(--athena-text-secondary)', lineHeight: '1.4' }}>
                        {out.notes}
                      </div>
                    )}
                  </div>
                )}

                {/* Collector consensus output */}
                {out.strategy === 'consensus_voting' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: 'var(--athena-success)' }}>
                        Consensus: {out.consensus ? 'REACHED' : 'FAILED'}
                      </span>
                      {out.decision && (
                        <span style={{ fontSize: '11px', padding: '1px 6px', borderRadius: '2px', backgroundColor: 'var(--athena-surface-elevated)', color: 'var(--athena-accent)', fontWeight: 600 }}>
                          Decision: {out.decision.toUpperCase()}
                        </span>
                      )}
                    </div>
                    {out.votes && (
                      <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>
                        Votes: {Object.entries(out.votes).map(([k, v]) => `${k}: ${v}`).join(', ')} (Total: {out.totalVotes})
                      </div>
                    )}
                  </div>
                )}

                {/* PR Diff output */}
                {out.diff && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--athena-text)' }}>
                      {out.title || `PR #${out.pr}`}
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>
                      Files: {out.changed_files || 0} | +{out.additions || 0} / -{out.deletions || 0}
                    </div>
                    <pre style={{
                      margin: 0,
                      maxHeight: '120px',
                      overflowY: 'auto',
                      fontSize: '9px',
                      fontFamily: 'var(--font-mono)',
                      backgroundColor: 'var(--athena-canvas)',
                      padding: '4px 6px',
                      borderRadius: '2px',
                      color: 'var(--athena-text-secondary)'
                    }}>
                      {out.diff}
                    </pre>
                  </div>
                )}

                {/* Render embedded markdown content if present */}
                {embeddedText && (
                  <div style={{
                    maxHeight: '340px',
                    overflowY: 'auto',
                    padding: '8px 10px',
                    backgroundColor: 'var(--athena-canvas, #171819)',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--athena-border-subtle)',
                    fontSize: '12px',
                    color: 'var(--athena-text)',
                    lineHeight: '1.5'
                  }}>
                    <MarkdownRenderer content={embeddedText} />
                  </div>
                )}
              </div>
            );
          })()}

          {/* Raw JSON collapse */}
          <details style={{ marginTop: '4px', fontSize: '10px' }}>
            <summary style={{ cursor: 'pointer', color: 'var(--athena-text-muted)', userSelect: 'none' }}>
              View raw payload
            </summary>
            <pre style={{
              margin: '4px 0 0 0',
              padding: '6px',
              backgroundColor: 'var(--athena-canvas, #171819)',
              borderRadius: '2px',
              fontSize: '10px',
              fontFamily: 'var(--font-mono)',
              color: 'var(--athena-text-secondary)',
              maxHeight: '140px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all'
            }}>
              {JSON.stringify(node.output, null, 2)}
            </pre>
          </details>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Node ID */}
        <div>
          <label style={labelStyle}>Node Identifier</label>
          <input
            type="text"
            value={node.id}
            onChange={(e) => updateRootField('id', e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Node Type Pill */}
        <div>
          <label style={labelStyle}>Node Type</label>
          <div style={{
            padding: '5px 8px',
            marginTop: '4px',
            backgroundColor: 'var(--athena-surface-deep)',
            border: '1px solid var(--athena-border-subtle)',
            borderRadius: 'var(--radius-xs)',
            color: 'var(--athena-accent)',
            fontSize: '11px',
            textTransform: 'uppercase',
            fontWeight: 600,
            letterSpacing: '0.04em'
          }}>
            {nodeType}
          </div>
        </div>

        {/* 1. Trigger Node */}
        {nodeType === 'trigger' && (
          <>
            <div>
              <label style={labelStyle}>Trigger Mode</label>
              <select
                value={config.triggerType || 'manual'}
                onChange={(e) => updateConfig('triggerType', e.target.value)}
                style={selectStyle}
              >
                <option value="manual">Manual / API Trigger</option>
                <option value="webhook">Incoming Webhook</option>
                <option value="cron">Scheduled Cron Routine</option>
                <option value="chat">Chat Tool / Command</option>
              </select>
            </div>

            {config.triggerType === 'cron' && (
              <div>
                <label style={labelStyle}>Cron Expression</label>
                <input
                  type="text"
                  placeholder="e.g. 0 9 * * *"
                  value={config.schedule || '0 9 * * *'}
                  onChange={(e) => updateConfig('schedule', e.target.value)}
                  style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                />
              </div>
            )}

            {config.triggerType === 'webhook' && (
              <div>
                <label style={labelStyle}>Webhook Path</label>
                <input
                  type="text"
                  placeholder="e.g. github/pr"
                  value={config.webhookPath || 'github/pr'}
                  onChange={(e) => updateConfig('webhookPath', e.target.value)}
                  style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
                />
                <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)', marginTop: '4px', display: 'block' }}>
                  POST /api/v1/webhooks/{config.webhookPath || 'path'}
                </span>
              </div>
            )}
          </>
        )}

        {/* 2. Agent Node */}
        {nodeType === 'agent' && (
          <>
            <div>
              <label style={labelStyle}>Agent Prompt Instructions</label>
              <textarea
                rows={4}
                placeholder="Instructions for this agent. Supports {{inputs.var}} and {{nodes.id.output}}"
                value={config.prompt || ''}
                onChange={(e) => updateConfig('prompt', e.target.value)}
                style={{
                  ...inputStyle,
                  lineHeight: '1.4',
                  resize: 'vertical'
                }}
              />
            </div>

            <div>
              <label style={labelStyle}>Output Contract</label>
              <select
                value={config.output || 'text'}
                onChange={(e) => updateConfig('output', e.target.value)}
                style={selectStyle}
              >
                <option value="text">Plain Text Output</option>
                <option value="json">Structured JSON</option>
              </select>
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                <label style={labelStyle}>Scoped Tool Allowlist</label>
                <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>
                  {(config.tools || []).length} selected
                </span>
              </div>
              <input
                type="text"
                placeholder="Filter tools by name..."
                value={toolFilter}
                onChange={(e) => setToolFilter(e.target.value)}
                style={{
                  ...inputStyle,
                  marginBottom: '6px',
                  fontSize: '11px',
                  padding: '3px 6px'
                }}
              />
              <div style={{
                maxHeight: '140px',
                overflowY: 'auto',
                padding: '6px',
                backgroundColor: 'var(--athena-surface-deep)',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--athena-border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                {normalizedTools
                  .filter(tool => !toolFilter || tool.name.toLowerCase().includes(toolFilter.toLowerCase()) || tool.mcpServer?.toLowerCase().includes(toolFilter.toLowerCase()))
                  .map(tool => {
                    const isChecked = (config.tools || []).includes(tool.name);
                    return (
                      <label key={tool.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '11px', color: 'var(--athena-text-secondary)', cursor: 'pointer', padding: '2px 0' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', overflow: 'hidden' }}>
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              const current = config.tools || [];
                              const updated = e.target.checked
                                ? [...current, tool.name]
                                : current.filter((t: string) => t !== tool.name);
                              updateConfig('tools', updated);
                            }}
                          />
                          <span style={{ textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }} title={tool.name}>
                            {tool.name}
                          </span>
                        </div>
                        {tool.isMcp ? (
                          <span style={{
                            fontSize: '9px',
                            padding: '1px 5px',
                            borderRadius: '2px',
                            backgroundColor: 'rgba(245, 158, 11, 0.2)',
                            color: '#F59E0B',
                            fontWeight: 600,
                            flexShrink: 0
                          }}>
                            MCP: {tool.mcpServer}
                          </span>
                        ) : (
                          <span style={{
                            fontSize: '9px',
                            padding: '1px 5px',
                            borderRadius: '2px',
                            backgroundColor: 'rgba(145, 167, 183, 0.15)',
                            color: '#91A7B7',
                            fontWeight: 500,
                            flexShrink: 0
                          }}>
                            built-in
                          </span>
                        )}
                      </label>
                    );
                  })}
              </div>
            </div>
          </>
        )}

        {/* 3. Collector Node */}
        {nodeType === 'collector' && (
          <>
            <div>
              <label style={labelStyle}>Fan-In Merge Strategy</label>
              <select
                value={config.strategy || 'structured_merge'}
                onChange={(e) => updateConfig('strategy', e.target.value)}
                style={selectStyle}
              >
                <option value="structured_merge">Structured Merge (Keyed by Node)</option>
                <option value="consensus_voting">Consensus Voting (Majority / Supermajority)</option>
                <option value="debate_refine">Iterative Debate & Refine</option>
                <option value="synthesis_agent">Synthesis Agent (LLM Summarization)</option>
              </select>
            </div>

            {config.strategy === 'consensus_voting' && (
              <>
                <div>
                  <label style={labelStyle}>Voting Field</label>
                  <input
                    type="text"
                    placeholder="e.g. verdict"
                    value={config.votingField || 'verdict'}
                    onChange={(e) => updateConfig('votingField', e.target.value)}
                    style={inputStyle}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Voting Policy</label>
                  <select
                    value={config.votingPolicy || 'majority'}
                    onChange={(e) => updateConfig('votingPolicy', e.target.value)}
                    style={selectStyle}
                  >
                    <option value="majority">Majority (&gt; 50%)</option>
                    <option value="supermajority">Supermajority (&ge; 66%)</option>
                    <option value="unanimous">Unanimous (100%)</option>
                  </select>
                </div>
              </>
            )}

            <div>
              <label style={labelStyle}>Source Nodes to Collect</label>
              <div style={{
                maxHeight: '100px',
                overflowY: 'auto',
                marginTop: '4px',
                padding: '6px',
                backgroundColor: 'var(--athena-surface-deep)',
                borderRadius: 'var(--radius-xs)',
                border: '1px solid var(--athena-border-subtle)',
                display: 'flex',
                flexDirection: 'column',
                gap: '4px'
              }}>
                {allNodes.filter(n => n.id !== node.id).map(n => {
                  const isChecked = (config.sources || []).includes(n.id);
                  return (
                    <label key={n.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: 'var(--athena-text-secondary)', cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          const current = config.sources || [];
                          const updated = e.target.checked
                            ? [...current, n.id]
                            : current.filter((s: string) => s !== n.id);
                          updateConfig('sources', updated);
                        }}
                      />
                      {n.id} ({n.type})
                    </label>
                  );
                })}
              </div>
            </div>
          </>
        )}

        {/* 4. Condition Node */}
        {nodeType === 'condition' && (
          <>
            <div>
              <label style={labelStyle}>Evaluation Expression</label>
              <input
                type="text"
                placeholder="e.g. inputs.score >= 80"
                value={config.expr || ''}
                onChange={(e) => updateConfig('expr', e.target.value)}
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <div>
              <label style={labelStyle}>True Branch Destination</label>
              <select
                value={config.trueBranch || ''}
                onChange={(e) => updateConfig('trueBranch', e.target.value)}
                style={selectStyle}
              >
                <option value="">Select target node...</option>
                {allNodes.filter(n => n.id !== node.id).map(n => (
                  <option key={n.id} value={n.id}>{n.id} ({n.type})</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>False Branch Destination</label>
              <select
                value={config.falseBranch || ''}
                onChange={(e) => updateConfig('falseBranch', e.target.value)}
                style={selectStyle}
              >
                <option value="">Select target node...</option>
                {allNodes.filter(n => n.id !== node.id).map(n => (
                  <option key={n.id} value={n.id}>{n.id} ({n.type})</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* 5. Tool Node */}
        {nodeType === 'tool' && (() => {
          const selectedTool = normalizedTools.find(t => t.name === currentToolValue);
          const isMcp = selectedTool?.isMcp;
          const mcpServer = selectedTool?.mcpServer;
          const isDomainTool = WORKFLOW_DOMAIN_TOOLS.some(d => d.name === currentToolValue);

          return (
            <>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                  <label style={labelStyle}>Tool Function</label>
                  {isMcp ? (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(245, 158, 11, 0.2)',
                      color: '#F59E0B',
                      border: '1px solid rgba(245, 158, 11, 0.3)'
                    }}>
                      🔌 MCP Tool ({mcpServer})
                    </span>
                  ) : isDomainTool ? (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(142, 173, 154, 0.2)',
                      color: '#8EAD9A',
                      border: '1px solid rgba(142, 173, 154, 0.3)'
                    }}>
                      🎯 Workflow Action
                    </span>
                  ) : (
                    <span style={{
                      fontSize: '10px',
                      fontWeight: 500,
                      padding: '2px 6px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(145, 167, 183, 0.15)',
                      color: '#91A7B7',
                      border: '1px solid rgba(145, 167, 183, 0.25)'
                    }}>
                      ⚡ Built-in Athena Tool
                    </span>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Search tool (e.g. pr, calendar, search)..."
                  value={toolFilter}
                  onChange={(e) => setToolFilter(e.target.value)}
                  style={{
                    ...inputStyle,
                    marginBottom: '6px',
                    fontSize: '11px',
                    padding: '3px 6px'
                  }}
                />

                <select
                  value={currentToolValue}
                  onChange={(e) => updateConfig('tool', e.target.value)}
                  style={selectStyle}
                >
                  {Object.entries(toolGroups).map(([groupName, groupTools]) => {
                    const filtered = toolFilter
                      ? groupTools.filter(t => t.name.toLowerCase().includes(toolFilter.toLowerCase()) || t.description?.toLowerCase().includes(toolFilter.toLowerCase()) || t.mcpServer?.toLowerCase().includes(toolFilter.toLowerCase()))
                      : groupTools;
                    if (filtered.length === 0) return null;

                    return (
                      <optgroup key={groupName} label={groupName}>
                        {filtered.map(tool => (
                          <option key={tool.name} value={tool.name}>
                            {tool.isMcp ? `[MCP: ${tool.mcpServer}] ${tool.name}` : tool.name}
                          </option>
                        ))}
                      </optgroup>
                    );
                  })}
                </select>

                {/* Selected Tool Details Card */}
                {selectedTool && (
                  <div style={{
                    marginTop: '8px',
                    padding: '8px',
                    backgroundColor: 'var(--athena-surface-deep)',
                    borderRadius: 'var(--radius-xs)',
                    border: '1px solid var(--athena-border-subtle)',
                    fontSize: '11px',
                    lineHeight: '1.4'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ fontWeight: 600, color: 'var(--athena-text)' }}>{selectedTool.name}</span>
                      <span style={{
                        fontSize: '9px',
                        padding: '1px 5px',
                        borderRadius: '2px',
                        backgroundColor: isMcp
                          ? 'rgba(245, 158, 11, 0.2)'
                          : isDomainTool
                          ? 'rgba(142, 173, 154, 0.2)'
                          : 'rgba(145, 167, 183, 0.15)',
                        color: isMcp ? '#F59E0B' : isDomainTool ? '#8EAD9A' : '#91A7B7',
                        fontWeight: 600
                      }}>
                        {isMcp ? `MCP: ${mcpServer}` : isDomainTool ? 'Workflow Action' : 'Built-in Athena'}
                      </span>
                    </div>
                    {selectedTool.description && (
                      <div style={{ color: 'var(--athena-text-secondary)', fontSize: '10px' }}>
                        {selectedTool.description}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label style={labelStyle}>Arguments Payload (JSON)</label>
                <textarea
                  rows={4}
                  placeholder={'JSON arguments e.g. {"timeMin": "2026-11-18T00:00:00Z"}'}
                  value={typeof config.args === 'string' ? config.args : JSON.stringify(config.args || {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      updateConfig('args', parsed);
                    } catch {
                      updateConfig('args', e.target.value);
                    }
                  }}
                  style={{
                    ...inputStyle,
                    fontFamily: 'var(--font-mono)',
                    color: 'var(--athena-info)'
                  }}
                />
              </div>
            </>
          );
        })()}

        {/* 6. Approval Node */}
        {nodeType === 'approval' && (
          <div>
            <label style={labelStyle}>Confirmation Prompt</label>
            <textarea
              rows={3}
              placeholder="Message shown to operator before proceeding"
              value={config.message || ''}
              onChange={(e) => updateConfig('message', e.target.value)}
              style={inputStyle}
            />
          </div>
        )}

        {/* 7. Map Node */}
        {nodeType === 'map' && (
          <>
            <div>
              <label style={labelStyle}>Iterate Over Collection Path</label>
              <input
                type="text"
                placeholder="e.g. nodes.plan.output"
                value={config.over || 'nodes.plan.output'}
                onChange={(e) => updateConfig('over', e.target.value)}
                style={{ ...inputStyle, fontFamily: 'var(--font-mono)' }}
              />
            </div>

            <div>
              <label style={labelStyle}>Max Concurrency</label>
              <input
                type="number"
                min={1}
                max={10}
                value={config.maxConcurrency || 3}
                onChange={(e) => updateConfig('maxConcurrency', parseInt(e.target.value, 10))}
                style={inputStyle}
              />
            </div>
          </>
        )}

        {/* 8. SubWorkflow Node */}
        {nodeType === 'subWorkflow' && (
          <div>
            <label style={labelStyle}>Sub-Workflow ID</label>
            <input
              type="text"
              placeholder="e.g. research-agent"
              value={config.workflowId || ''}
              onChange={(e) => updateConfig('workflowId', e.target.value)}
              style={inputStyle}
            />
          </div>
        )}
      </div>
    </div>
  );
};
