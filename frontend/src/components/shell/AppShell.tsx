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
    switch (location.pathname) {
      case '/':
        return ['Ops room', 'Workspace'];
      case '/activity':
        return ['Ops room', 'Run activity'];
      case '/artifacts':
        return ['Ops room', 'Artifacts'];
      case '/goals':
        return ['Ops room', 'Goals & tasks'];
      case '/approvals':
        return ['Ops room', 'Approvals'];
      case '/automations':
        return ['Ops room', 'Automations'];
      case '/knowledge':
        return ['Ops room', 'Knowledge'];
      case '/agents':
        return ['Ops room', 'Agent Studio'];
      case '/tools':
        return ['Ops room', 'Tools & Connections'];
      case '/inspection':
        return ['Ops room', 'Inspection'];
      default:
        return ['Ops room', 'Workspace'];
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

      {/* Zone 3: Contextual Inspector */}
      <ContextInspector
        run={currentRun}
        isOpen={isInspectorOpen}
        onToggle={onToggleInspector}
        onAbortRun={onAbortRun}
      />
    </div>
  );
};
