import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '../components/shell/AppShell';
import { WorkspacePage } from '../pages/workspace/WorkspacePage';
import { ActivityPage } from '../pages/activity/ActivityPage';
import { ArtifactsPage } from '../pages/artifacts/ArtifactsPage';
import { GoalsPage } from '../pages/goals/GoalsPage';
import { ApprovalsPage } from '../pages/approvals/ApprovalsPage';
import { InspectionPage } from '../pages/inspection/InspectionPage';
import { ToolsPage } from '../pages/tools/ToolsPage';
import { AutomationsPage } from '../pages/automations/AutomationsPage';
import { WorkflowsPage } from '../pages/workflows/WorkflowsPage';
import { KnowledgePage } from '../pages/knowledge/KnowledgePage';
import { AgentStudioPage } from '../pages/agents/AgentStudioPage';
import { ConnectionStatus } from '../types/events';
import { AthenaSSEClient } from '../lib/events/sseClient';
import { apiClient } from '../lib/api/client';
import { RunRecord } from '../types/api';

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [currentRun, setCurrentRun] = useState<RunRecord | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    return localStorage.getItem('athena_active_session') || 'default_session';
  });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [pendingApprovalCount, setPendingApprovalCount] = useState(0);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  const toggleTheme = () => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.classList.add(next);
      return next;
    });
  };

  const refreshGlobalCounts = useCallback(() => {
    setRefreshTrigger((n) => n + 1);
    apiClient.getPendingApprovals().then((list) => {
      setPendingApprovalCount(list.length);
    }).catch(() => {});
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    localStorage.setItem('athena_active_session', sessionId);
  }, []);

  const handleNewChat = useCallback(() => {
    const newId = `chat_${Date.now()}`;
    setActiveSessionId(newId);
    localStorage.setItem('athena_active_session', newId);
    setCurrentRun(null);
  }, []);

  useEffect(() => {
    document.documentElement.classList.add(theme);

    apiClient.checkHealthReady().then(() => {
      setConnectionStatus('connected');
    }).catch(() => {
      setConnectionStatus('disconnected');
    });

    refreshGlobalCounts();
  }, []);

  useEffect(() => {
    const sse = new AthenaSSEClient(`/api/v1/sessions/${activeSessionId}/events`);
    sse.onStatusChange((status) => {
      setConnectionStatus(status);
    });

    sse.subscribe((envelope) => {
      if (envelope.type.startsWith('run.') && envelope.runId) {
        apiClient.getRun(envelope.runId).then((r) => {
          setCurrentRun(r);
        }).catch(() => {});
      }
      if (envelope.type === 'approval.required' || envelope.type === 'approval.resolved') {
        refreshGlobalCounts();
      }
    });

    sse.connect();

    return () => {
      sse.close();
    };
  }, [activeSessionId, refreshGlobalCounts]);

  const handleAbortRun = async (runId: string) => {
    try {
      await apiClient.abortRun(runId);
      const updated = await apiClient.getRun(runId);
      setCurrentRun(updated);
      refreshGlobalCounts();
    } catch (err: any) {
      alert(`Failed to abort run: ${err.message}`);
    }
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            <AppShell
              theme={theme}
              onToggleTheme={toggleTheme}
              currentRun={currentRun}
              activeSessionId={activeSessionId}
              onSelectSession={handleSelectSession}
              onNewChat={handleNewChat}
              connectionStatus={connectionStatus}
              onAbortRun={handleAbortRun}
              refreshTrigger={refreshTrigger}
              pendingApprovalCount={pendingApprovalCount}
              isInspectorOpen={isInspectorOpen}
              onToggleInspector={() => setIsInspectorOpen((prev) => !prev)}
            />
          }
        >
          <Route
            index
            element={
              <WorkspacePage
                sessionId={activeSessionId}
                onOpenInspector={() => setIsInspectorOpen(true)}
                onSelectRun={setCurrentRun}
                onSessionActivity={refreshGlobalCounts}
              />
            }
          />
          <Route
            path="activity"
            element={<ActivityPage onSelectSession={handleSelectSession} />}
          />
          <Route path="artifacts" element={<ArtifactsPage />} />
          <Route path="goals" element={<GoalsPage onSelectSession={handleSelectSession} />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="workflows" element={<WorkflowsPage />} />
          <Route path="automations" element={<AutomationsPage />} />
          <Route path="knowledge" element={<KnowledgePage />} />
          <Route path="agents" element={<AgentStudioPage />} />
          <Route path="tools" element={<ToolsPage />} />
          <Route path="inspection" element={<InspectionPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};
