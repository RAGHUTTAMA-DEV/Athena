import React from 'react';
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AppShell } from '../components/shell/AppShell';
import { WorkspacePage } from '../pages/workspace/WorkspacePage';
import { ActivityPage } from '../pages/activity/ActivityPage';
import { ArtifactsPage } from '../pages/artifacts/ArtifactsPage';
import { GoalsPage } from '../pages/goals/GoalsPage';
import { ApprovalsPage } from '../pages/approvals/ApprovalsPage';
import { InspectionPage } from '../pages/inspection/InspectionPage';
import { RouteErrorBoundary } from '../components/shell/ErrorBoundary';
import { RunRecord } from '../types/api';
import { ConnectionStatus } from '../types/events';

interface CreateRouterOptions {
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  currentRun?: RunRecord | null;
  onSelectRun: (run: RunRecord | null) => void;
  activeSessionId: string;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  connectionStatus?: ConnectionStatus;
  onAbortRun?: (runId: string) => void;
  refreshTrigger: number;
  onSessionActivity: () => void;
  pendingApprovalCount: number;
  isInspectorOpen: boolean;
  onToggleInspector: () => void;
}

export function createAppRouter(options: CreateRouterOptions) {
  return createBrowserRouter([
    {
      path: '/',
      errorElement: <RouteErrorBoundary />,
      element: (
        <AppShell
          theme={options.theme}
          onToggleTheme={options.onToggleTheme}
          currentRun={options.currentRun}
          activeSessionId={options.activeSessionId}
          onSelectSession={options.onSelectSession}
          onNewChat={options.onNewChat}
          connectionStatus={options.connectionStatus}
          onAbortRun={options.onAbortRun}
          refreshTrigger={options.refreshTrigger}
          pendingApprovalCount={options.pendingApprovalCount}
          isInspectorOpen={options.isInspectorOpen}
          onToggleInspector={options.onToggleInspector}
        />
      ),
      children: [
        {
          index: true,
          element: (
            <WorkspacePage
              sessionId={options.activeSessionId}
              onOpenInspector={options.onToggleInspector}
              onSelectRun={options.onSelectRun}
              onSessionActivity={options.onSessionActivity}
            />
          ),
        },
        {
          path: 'activity',
          element: (
            <ActivityPage
              onSelectSession={options.onSelectSession}
            />
          ),
        },
        {
          path: 'artifacts',
          element: <ArtifactsPage />,
        },
        {
          path: 'goals',
          element: <GoalsPage />,
        },
        {
          path: 'approvals',
          element: <ApprovalsPage />,
        },
        {
          path: 'inspection',
          element: <InspectionPage />,
        },
        {
          path: '*',
          element: <Navigate to="/" replace />,
        },
      ],
    },
  ]);
}
