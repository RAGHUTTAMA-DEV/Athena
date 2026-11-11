import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import {
  Activity,
  FileText,
  Target,
  ShieldCheck,
  Eye,
  Plus,
  MessageSquare,
  Lock,
} from 'lucide-react';
import { RunRecord, SessionSummary } from '../../types/api';
import { apiClient } from '../../lib/api/client';
import { StatusBadge } from '../primitives/StatusBadge';

interface SidebarProps {
  currentRun?: RunRecord | null;
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  isToolsConnected?: boolean;
  refreshTrigger?: number;
  pendingApprovalCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentRun,
  activeSessionId,
  onSelectSession,
  onNewChat,
  isToolsConnected = true,
  refreshTrigger = 0,
  pendingApprovalCount = 0,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  useEffect(() => {
    apiClient.listSessions().then(setSessions).catch(() => {});
  }, [refreshTrigger, activeSessionId]);

  const navItems = [
    { name: 'Workspace', path: '/', icon: MessageSquare, shortcut: '~1' },
    { name: 'Run activity', path: '/activity', icon: Activity, shortcut: '~2' },
    { name: 'Artifacts', path: '/artifacts', icon: FileText, shortcut: '~3' },
    { name: 'Goals & tasks', path: '/goals', icon: Target, shortcut: '~4' },
    { name: 'Approvals', path: '/approvals', icon: ShieldCheck, shortcut: '~5', badge: pendingApprovalCount },
    { name: 'Inspection', path: '/inspection', icon: Eye, shortcut: '~6' },
  ];

  return (
    <aside
      style={{
        width: '236px',
        height: '100%',
        backgroundColor: 'var(--athena-surface)',
        borderRight: '1px solid var(--athena-border)',
        display: 'flex',
        flexDirection: 'column',
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {/* Brand Header */}
      <div
        style={{
          height: 'var(--header-height)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 16px',
          borderBottom: '1px solid var(--athena-border-subtle)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="var(--athena-text)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 3 L3 20 L21 20 Z" />
            <path d="M12 9 L7.5 17 L16.5 17 Z" stroke="var(--athena-accent)" strokeWidth="1.6" />
          </svg>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: 'var(--athena-text)',
            }}
          >
            athena
          </span>
        </div>

        <span
          style={{
            fontSize: '9px',
            fontFamily: 'var(--font-mono)',
            color: 'var(--athena-text-muted)',
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
          }}
        >
          COMMAND / 02
        </span>
      </div>

      {/* New Chat Button */}
      <div style={{ padding: '12px 12px 6px 12px', flexShrink: 0 }}>
        <button
          onClick={() => {
            onNewChat();
            if (location.pathname !== '/') {
              navigate('/');
            }
          }}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            padding: '8px 12px',
            backgroundColor: 'var(--athena-surface-raised)',
            border: '1px solid var(--athena-border)',
            borderRadius: 'var(--radius-sm)',
            fontSize: '12px',
            fontWeight: 600,
            color: 'var(--athena-text)',
            cursor: 'pointer',
            transition: 'background 0.15s ease, border-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--athena-surface-hover)';
            e.currentTarget.style.borderColor = 'var(--athena-border-focus)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--athena-surface-raised)';
            e.currentTarget.style.borderColor = 'var(--athena-border)';
          }}
        >
          <Plus size={14} color="var(--athena-accent)" />
          <span>New session</span>
        </button>
      </div>

      {/* Primary Navigation */}
      <div style={{ padding: '8px 10px 4px 10px', flexShrink: 0 }}>
        <div
          style={{
            fontSize: '9px',
            fontWeight: 700,
            color: 'var(--athena-text-muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '4px 8px 6px 8px',
          }}
        >
          COMMAND
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                style={({ isActive }) => ({
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-xs)',
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 500,
                  color: isActive ? 'var(--athena-text)' : 'var(--athena-text-secondary)',
                  backgroundColor: isActive ? 'var(--athena-surface-raised)' : 'transparent',
                  border: isActive ? '1px solid var(--athena-border)' : '1px solid transparent',
                  textDecoration: 'none',
                  transition: 'all 0.15s ease',
                })}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Icon size={14} />
                  <span>{item.name}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {item.badge && item.badge > 0 ? (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        padding: '0 5px',
                        borderRadius: '10px',
                        backgroundColor: 'var(--athena-warning-dim)',
                        color: 'var(--athena-warning)',
                        border: '1px solid rgba(197, 166, 106, 0.4)',
                      }}
                    >
                      {item.badge}
                    </span>
                  ) : null}
                  <span
                    style={{
                      fontSize: '10px',
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--athena-text-muted)',
                    }}
                  >
                    {item.shortcut}
                  </span>
                </div>
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* ChatGPT-style Session History */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 10px',
          borderTop: '1px solid var(--athena-border-subtle)',
          marginTop: '6px',
        }}
      >
        <div
          style={{
            fontSize: '9px',
            fontWeight: 700,
            color: 'var(--athena-text-muted)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            padding: '4px 8px 6px 8px',
          }}
        >
          RECENT SESSIONS
        </div>

        {sessions.length === 0 ? (
          <div style={{ fontSize: '11px', color: 'var(--athena-text-muted)', padding: '6px 8px' }}>
            No saved sessions yet
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {sessions.map((s) => {
              const isSelected = s.sessionId === activeSessionId && location.pathname === '/';
              return (
                <button
                  key={s.sessionId}
                  onClick={() => {
                    onSelectSession(s.sessionId);
                    if (location.pathname !== '/') {
                      navigate('/');
                    }
                  }}
                  title={s.title || s.sessionId}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '8px',
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-xs)',
                    fontSize: '12px',
                    fontWeight: isSelected ? 600 : 400,
                    color: isSelected ? 'var(--athena-text)' : 'var(--athena-text-secondary)',
                    backgroundColor: isSelected ? 'var(--athena-surface-raised)' : 'transparent',
                    border: isSelected ? '1px solid var(--athena-border)' : '1px solid transparent',
                    textAlign: 'left',
                    cursor: 'pointer',
                    width: '100%',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--athena-surface-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      flex: 1,
                    }}
                  >
                    {s.title || s.sessionId}
                  </span>
                  {s.latestStatus === 'running' || s.latestStatus === 'approval_required' ? (
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        flexShrink: 0,
                        backgroundColor:
                          s.latestStatus === 'approval_required'
                            ? 'var(--athena-warning)'
                            : 'var(--athena-success)',
                      }}
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Bottom Current Run Card */}
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--athena-border-subtle)', flexShrink: 0 }}>
        <div
          style={{
            padding: '10px 12px',
            backgroundColor: 'var(--athena-surface-deep)',
            border: '1px solid var(--athena-border)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '4px',
            }}
          >
            <span
              style={{
                fontSize: '9px',
                fontWeight: 700,
                color: 'var(--athena-text-muted)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              CURRENT RUN
            </span>
            {currentRun ? (
              <StatusBadge status={currentRun.status} size="sm" />
            ) : (
              <span style={{ fontSize: '10px', color: 'var(--athena-text-muted)' }}>Idle</span>
            )}
          </div>

          <div
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: 'var(--athena-text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginBottom: '3px',
            }}
          >
            {currentRun ? (currentRun.task || currentRun.runId) : 'No active run'}
          </div>

          <div
            style={{
              fontSize: '10px',
              color: 'var(--athena-text-muted)',
            }}
          >
            {currentRun
              ? `Turn ${currentRun.currentTurn || 0} · ${currentRun.usage?.toolCallsCount || 0} tools`
              : 'Ready for assignment'}
          </div>
        </div>
      </div>

      {/* Footer Connection Status */}
      <div
        style={{
          padding: '10px 14px',
          borderTop: '1px solid var(--athena-border-subtle)',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          fontFamily: 'var(--font-mono)',
          color: 'var(--athena-text-muted)',
          letterSpacing: '0.04em',
          flexShrink: 0,
        }}
      >
        <Lock size={11} />
        <span>
          {isToolsConnected ? 'LOCAL RUNTIME · CONNECTED' : 'BACKEND DISCONNECTED'}
        </span>
      </div>
    </aside>
  );
};
