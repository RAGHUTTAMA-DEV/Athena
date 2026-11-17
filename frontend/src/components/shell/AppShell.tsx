import React, { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopHeader } from './TopHeader';
import { ContextInspector } from './ContextInspector';
import { RunRecord } from '../../types/api';
import { ConnectionStatus } from '../../types/events';

interface AppShellProps {
  currentRun?: RunRecord | null;
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  connectionStatus?: ConnectionStatus;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onAbortRun?: (runId: string) => void;
  refreshTrigger?: number;
  pendingApprovalCount?: number;
  isInspectorOpen: boolean;
  onToggleInspector: () => void;
}

export const AppShell: React.FC<AppShellProps> = ({
  currentRun,
  activeSessionId,
  onSelectSession,
  onNewChat,
  connectionStatus = 'connected',
  theme,
  onToggleTheme,
  onAbortRun,
  refreshTrigger = 0,
  pendingApprovalCount = 0,
  isInspectorOpen,
  onToggleInspector,
}) => {
  const location = useLocation();

  const getBreadcrumbs = () => {
    const base = [{ label: 'Athena', path: '/' }];
    switch (location.pathname) {
      case '/':
        return [{ label: 'Athena', path: '/' }, { label: 'Workspace' }];
      case '/workflows':
        return [...base, { label: 'Workflows' }];
      case '/activity':
        return [...base, { label: 'Run activity' }];
      case '/artifacts':
        return [...base, { label: 'Artifacts' }];
      case '/goals':
        return [...base, { label: 'Goals & tasks' }];
      case '/approvals':
        return [...base, { label: 'Approvals' }];
      case '/automations':
        return [...base, { label: 'Automations' }];
      case '/knowledge':
        return [...base, { label: 'Knowledge' }];
      case '/agents':
        return [...base, { label: 'Agent Studio' }];
      case '/tools':
        return [...base, { label: 'Tools & MCP' }];
      case '/inspection':
        return [...base, { label: 'Inspection' }];
      default:
        return [...base, { label: location.pathname.replace('/', '') }];
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        backgroundColor: 'var(--athena-canvas)',
      }}
    >
      {/* Zone 1: Persistent Left Navigation + Session History */}
      <Sidebar
        currentRun={currentRun}
        activeSessionId={activeSessionId}
        onSelectSession={onSelectSession}
        onNewChat={onNewChat}
        isToolsConnected={connectionStatus === 'connected'}
        refreshTrigger={refreshTrigger}
        pendingApprovalCount={pendingApprovalCount}
      />

      {/* Main Column */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
          height: '100%',
        }}
      >
        <TopHeader
          breadcrumbs={getBreadcrumbs()}
          theme={theme}
          onToggleTheme={onToggleTheme}
          isRunning={currentRun?.status === 'running' || currentRun?.status === 'approval_required'}
          connectionStatus={connectionStatus}
          isSimulatedPreview={false}
        />

        <main
          style={{
            flex: 1,
            overflowY: 'auto',
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: 'var(--athena-canvas)',
          }}
        >
          <Outlet />
        </main>
      </div>

      {/* Zone 3: Contextual Inspector (hidden on full-screen studio pages like workflows) */}
      {location.pathname !== '/workflows' && (
        <ContextInspector
          run={currentRun}
          isOpen={isInspectorOpen}
          onToggle={onToggleInspector}
          onAbortRun={onAbortRun}
        />
      )}
    </div>
  );
};
