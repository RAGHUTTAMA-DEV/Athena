import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import {
  Zap,
  Bot,
  Users,
  Wrench,
  GitBranch,
  Split,
  ShieldCheck,
  Layers,
  Repeat,
  Trash2,
  Code
} from 'lucide-react';

export interface WorkflowNodeData {
  id: string;
  type: string;
  config: any;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  output?: any;
  onDeleteNode?: (id: string) => void;
  [key: string]: any;
}

export const WorkflowNodeComponent: React.FC<NodeProps> = memo(({ id, data, selected }) => {
  const nodeData = data as WorkflowNodeData;
  const nodeType = nodeData.type || 'tool';

  const getNodeTheme = (type: string) => {
    switch (type) {
      case 'trigger':
        return { accent: '#8EAD9A', badgeBg: 'rgba(142, 173, 154, 0.15)', badgeText: '#8EAD9A', label: 'Trigger' };
      case 'agent':
        return { accent: '#91A7B7', badgeBg: 'rgba(145, 167, 183, 0.15)', badgeText: '#91A7B7', label: 'Agent' };
      case 'orchestrator':
        return { accent: '#B89FD4', badgeBg: 'rgba(184, 159, 212, 0.15)', badgeText: '#B89FD4', label: 'Orchestrator' };
      case 'tool':
        return { accent: '#C5A66A', badgeBg: 'rgba(197, 166, 106, 0.15)', badgeText: '#C5A66A', label: 'Tool' };
      case 'collector':
        return { accent: '#86B3AC', badgeBg: 'rgba(134, 179, 172, 0.15)', badgeText: '#86B3AC', label: 'Collector' };
      case 'condition':
        return { accent: '#D69E7B', badgeBg: 'rgba(214, 158, 123, 0.15)', badgeText: '#D69E7B', label: 'Condition' };
      case 'approval':
        return { accent: '#C77D7D', badgeBg: 'rgba(199, 125, 125, 0.15)', badgeText: '#C77D7D', label: 'Approval Gate' };
      case 'map':
        return { accent: '#C494AA', badgeBg: 'rgba(196, 148, 170, 0.15)', badgeText: '#C494AA', label: 'Map Fan-Out' };
      case 'subWorkflow':
        return { accent: '#A8B6AE', badgeBg: 'rgba(168, 182, 174, 0.15)', badgeText: '#A8B6AE', label: 'Sub-Workflow' };
      default:
        return { accent: '#8C9298', badgeBg: 'rgba(140, 146, 152, 0.15)', badgeText: '#8C9298', label: type };
    }
  };

  const getIcon = (type: string) => {
    const color = getNodeTheme(type).accent;
    switch (type) {
      case 'trigger': return <Zap size={13} color={color} />;
      case 'agent': return <Bot size={13} color={color} />;
      case 'orchestrator': return <Users size={13} color={color} />;
      case 'tool': return <Wrench size={13} color={color} />;
      case 'collector': return <GitBranch size={13} color={color} />;
      case 'condition': return <Split size={13} color={color} />;
      case 'approval': return <ShieldCheck size={13} color={color} />;
      case 'map': return <Repeat size={13} color={color} />;
      case 'subWorkflow': return <Layers size={13} color={color} />;
      default: return <Code size={13} color={color} />;
    }
  };

  const theme = getNodeTheme(nodeType);
  const status = nodeData.status;

  const getMcpServer = (toolName?: string): string | null => {
    if (!toolName) return null;
    const prefixes = ['calendar', 'gmail', 'github', 'notion', 'excalidraw', 'filesystem'];
    for (const p of prefixes) {
      if (toolName === p || toolName.startsWith(p + '_')) return p;
    }
    return null;
  };

  const renderDescription = () => {
    const c = nodeData.config || {};
    switch (nodeType) {
      case 'trigger':
        return `Trigger: ${c.triggerType || 'manual'} ${c.schedule ? `(${c.schedule})` : ''} ${c.webhookPath ? `(${c.webhookPath})` : ''}`;
      case 'agent':
        return c.prompt ? c.prompt : 'Execute autonomous agent with scoped tools';
      case 'orchestrator':
        return `Dynamic orchestrator coordinating ${c.specialists?.length || 0} child specialist agents`;
      case 'collector':
        return `Fan-in barrier: ${c.strategy || 'structured_merge'} (${c.sources?.length || 0} sources)`;
      case 'condition':
        return `Branch evaluation: ${c.expr || 'true'}`;
      case 'tool': {
        const toolName = c.tool || nodeData.tool || (nodeData.id === 'fetch_diff' ? 'fetch_pr_diff' : nodeData.id === 'publish_review' ? 'post_pr_review' : 'noop');
        const mcpServer = getMcpServer(toolName);
        if (mcpServer) {
          const action = toolName.replace(new RegExp(`^${mcpServer}_`), '');
          return `🔌 MCP [${mcpServer}]: ${action}`;
        }
        if (toolName === 'fetch_pr_diff') return `🎯 Fetch GitHub PR diff & metadata`;
        if (toolName === 'post_pr_review') return `🎯 Publish review comment & verdict`;
        if (toolName === 'run_tests') return `🎯 Automated test suite runner`;
        if (toolName === 'create_pr') return `🎯 Create pull request`;
        if (toolName === 'send_telegram') return `🎯 Send Telegram briefing alert`;
        return `⚡ Built-in tool: ${toolName}`;
      }
      case 'approval':
        return c.message || 'Requires operator review & confirmation';
      case 'map':
        return `Map iteration over ${c.over || 'items'} (concurrency: ${c.maxConcurrency || 3})`;
      case 'subWorkflow':
        return `Invoke sub-workflow: ${c.workflowId || 'id'}`;
      default:
        return 'Configured step';
    }
  };

  return (
    <div
      style={{
        width: '280px',
        backgroundColor: 'var(--athena-surface, #1D1E20)',
        borderRadius: 'var(--radius-sm, 4px)',
        border: selected
          ? '1px solid var(--athena-accent, #A8B6AE)'
          : '1px solid var(--athena-border, #303234)',
        boxShadow: selected
          ? '0 0 0 1px var(--athena-accent), 0 8px 16px rgba(0, 0, 0, 0.4)'
          : '0 2px 4px rgba(0, 0, 0, 0.3)',
        padding: '12px',
        position: 'relative',
        color: 'var(--athena-text, #EDEEEF)',
        fontFamily: 'var(--font-sans)',
        transition: 'border 0.15s ease, box-shadow 0.15s ease'
      }}
    >
      {/* Target input handle (unless trigger node) */}
      {nodeType !== 'trigger' && (
        <Handle
          type="target"
          position={Position.Top}
          style={{
            background: theme.accent,
            width: '8px',
            height: '8px',
            border: '2px solid var(--athena-canvas, #171819)',
            top: '-5px'
          }}
        />
      )}

      {/* Header with icon, label, and actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <div style={{
            padding: '4px',
            borderRadius: 'var(--radius-xs, 2px)',
            backgroundColor: theme.badgeBg,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}>
            {getIcon(nodeType)}
          </div>
          <div style={{ overflow: 'hidden' }}>
            <div style={{
              fontSize: '12px',
              fontWeight: 600,
              color: 'var(--athena-text, #EDEEEF)',
              whiteSpace: 'nowrap',
              textOverflow: 'ellipsis',
              overflow: 'hidden'
            }}>
              {id}
            </div>
            <div style={{
              fontSize: '10px',
              color: theme.badgeText,
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <span>{theme.label}</span>
              {nodeType === 'tool' && (() => {
                const c = nodeData.config || {};
                const toolName = c.tool || nodeData.tool || (nodeData.id === 'fetch_diff' ? 'fetch_pr_diff' : nodeData.id === 'publish_review' ? 'post_pr_review' : 'noop');
                const mcpServer = getMcpServer(toolName);
                if (mcpServer) {
                  return (
                    <span style={{
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(245, 158, 11, 0.2)',
                      color: '#F59E0B',
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                      border: '1px solid rgba(245, 158, 11, 0.3)'
                    }}>
                      MCP: {mcpServer}
                    </span>
                  );
                }
                const isDomain = ['fetch_pr_diff', 'post_pr_review', 'run_tests', 'create_pr', 'send_telegram', 'noop'].includes(toolName);
                if (isDomain) {
                  return (
                    <span style={{
                      fontSize: '9px',
                      padding: '1px 5px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(142, 173, 154, 0.2)',
                      color: '#8EAD9A',
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                      border: '1px solid rgba(142, 173, 154, 0.3)'
                    }}>
                      Workflow Action
                    </span>
                  );
                }
                return (
                  <span style={{
                    fontSize: '9px',
                    padding: '1px 5px',
                    borderRadius: '3px',
                    backgroundColor: 'rgba(145, 167, 183, 0.15)',
                    color: '#91A7B7',
                    fontWeight: 600,
                    letterSpacing: '0.02em',
                    border: '1px solid rgba(145, 167, 183, 0.25)'
                  }}>
                    Built-in
                  </span>
                );
              })()}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
          {status && (
            <span style={{
              fontSize: '9px',
              fontWeight: 600,
              padding: '2px 5px',
              borderRadius: 'var(--radius-xs, 2px)',
              textTransform: 'uppercase',
              backgroundColor:
                status === 'completed' ? 'var(--athena-success-dim, rgba(142, 173, 154, 0.15))' :
                status === 'running' ? 'var(--athena-info-dim, rgba(145, 167, 183, 0.15))' :
                status === 'failed' ? 'var(--athena-danger-dim, rgba(199, 125, 125, 0.15))' :
                'var(--athena-warning-dim, rgba(197, 166, 106, 0.15))',
              color:
                status === 'completed' ? 'var(--athena-success, #8EAD9A)' :
                status === 'running' ? 'var(--athena-info, #91A7B7)' :
                status === 'failed' ? 'var(--athena-danger, #C77D7D)' :
                'var(--athena-warning, #C5A66A)'
            }}>
              {status}
            </span>
          )}

          {nodeData.onDeleteNode && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                nodeData.onDeleteNode?.(id);
              }}
              title="Delete node"
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--athena-text-muted, #777D80)',
                cursor: 'pointer',
                padding: '3px',
                display: 'flex',
                alignItems: 'center'
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--athena-danger, #C77D7D)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--athena-text-muted, #777D80)')}
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Description / Summary preview */}
      <div style={{
        fontSize: '11px',
        color: 'var(--athena-text-secondary, #BFC2C3)',
        backgroundColor: 'var(--athena-surface-deep, #191A1C)',
        border: '1px solid var(--athena-border-subtle, #252729)',
        borderRadius: 'var(--radius-xs, 2px)',
        padding: '6px 8px',
        lineHeight: '1.4',
        maxHeight: '48px',
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        wordBreak: 'break-word'
      }}>
        {renderDescription()}
      </div>

      {/* Output preview if run was executed */}
      {nodeData.output && (
        <div style={{
          marginTop: '6px',
          padding: '4px 6px',
          backgroundColor: 'var(--athena-surface-deep, #191A1C)',
          border: '1px solid var(--athena-border-subtle, #252729)',
          borderRadius: 'var(--radius-xs, 2px)',
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--athena-info, #91A7B7)',
          maxHeight: '40px',
          overflowY: 'auto'
        }}>
          {typeof nodeData.output === 'string' ? nodeData.output : JSON.stringify(nodeData.output)}
        </div>
      )}

      {/* Source output handles */}
      {nodeType === 'condition' ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="true"
            style={{
              left: '30%',
              background: 'var(--athena-success, #8EAD9A)',
              width: '8px',
              height: '8px',
              border: '2px solid var(--athena-canvas, #171819)',
              bottom: '-5px'
            }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            id="false"
            style={{
              left: '70%',
              background: 'var(--athena-danger, #C77D7D)',
              width: '8px',
              height: '8px',
              border: '2px solid var(--athena-canvas, #171819)',
              bottom: '-5px'
            }}
          />
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          style={{
            background: theme.accent,
            width: '8px',
            height: '8px',
            border: '2px solid var(--athena-canvas, #171819)',
            bottom: '-5px'
          }}
        />
      )}
    </div>
  );
});
