import {
  SessionSummary,
  SessionStateView,
  RunRecord,
  ApprovalRecord,
  GoalRecord,
  ArtifactRecord,
} from '../../types/api';

export interface ApiClientConfig {
  baseUrl?: string;
  apiKey?: string;
  workspaceId?: string;
}

const DEFAULT_API_BASE = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:3000';

export class AthenaApiClient {
  private baseUrl: string;
  private apiKey?: string;
  private workspaceId?: string;

  constructor(config: ApiClientConfig = {}) {
    this.baseUrl = (config.baseUrl !== undefined ? config.baseUrl : DEFAULT_API_BASE).replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.workspaceId = config.workspaceId;
  }

  setApiKey(key?: string) {
    this.apiKey = key;
  }

  setWorkspaceId(id?: string) {
    this.workspaceId = id;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string> || {}),
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
      headers['x-api-key'] = this.apiKey;
    }
    if (this.workspaceId) {
      headers['x-workspace-id'] = this.workspaceId;
    }

    const res = await fetch(url, { ...options, headers });
    if (!res.ok) {
      let errData: any = null;
      try {
        errData = await res.json();
      } catch {
        errData = { error: { message: res.statusText } };
      }
      const error = new Error(errData?.error?.message || `HTTP ${res.status}: ${res.statusText}`) as any;
      error.status = res.status;
      error.code = errData?.error?.code;
      error.details = errData?.error?.details;
      throw error;
    }
    return (await res.json()) as T;
  }

  // Health
  async checkHealthLive(): Promise<{ status: string }> {
    return this.request('/health/live');
  }

  async checkHealthReady(): Promise<any> {
    return this.request('/health/ready');
  }

  // Sessions
  async listSessions(): Promise<SessionSummary[]> {
    const res = await this.request<{ sessions: SessionSummary[] }>('/api/v1/sessions');
    return res.sessions || [];
  }

  async getSessionState(sessionId: string): Promise<SessionStateView> {
    return this.request(`/api/v1/sessions/${sessionId}/state`);
  }

  async getSessionMessages(sessionId: string): Promise<{ sessionId: string; messages: any[] }> {
    return this.request(`/api/v1/sessions/${sessionId}/messages`);
  }

  async submitMessage(
    sessionId: string,
    content: string,
    attachments?: any[]
  ): Promise<{ messageId: string; runId: string; status: string; isDuplicate?: boolean }> {
    const idempotencyKey = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    return this.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers: {
        'x-idempotency-key': idempotencyKey,
      },
      body: JSON.stringify({ content, attachments }),
    });
  }

  // Runs
  async listRuns(sessionId?: string, limit?: number): Promise<RunRecord[]> {
    const params = new URLSearchParams();
    if (sessionId) params.set('sessionId', sessionId);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<{ runs: RunRecord[] }>(`/api/v1/runs${qs}`);
    return res.runs || [];
  }

  async getRun(runId: string): Promise<RunRecord> {
    return this.request(`/api/v1/runs/${runId}`);
  }

  async abortRun(runId: string): Promise<{ runId: string; status: string }> {
    return this.request(`/api/v1/runs/${runId}/abort`, {
      method: 'POST',
    });
  }

  async getRunReplay(runId: string): Promise<any> {
    return this.request(`/api/v1/runs/${runId}/replay`);
  }

  async getRunTrace(runId: string): Promise<any> {
    return this.request(`/api/v1/runs/${runId}/trace`);
  }

  // Approvals
  async getPendingApprovals(runId?: string, goalId?: string): Promise<ApprovalRecord[]> {
    const params = new URLSearchParams();
    if (runId) params.set('runId', runId);
    if (goalId) params.set('goalId', goalId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    const res = await this.request<{ pending: ApprovalRecord[] }>(`/api/v1/approvals/pending${qs}`);
    return res.pending || [];
  }

  async decideApproval(
    approvalId: string,
    status: 'approved' | 'rejected',
    reason?: string
  ): Promise<{ approvalId: string; status: string }> {
    return this.request(`/api/v1/approvals/${approvalId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ status, reason }),
    });
  }

  // Goals
  async listGoals(): Promise<GoalRecord[]> {
    const res = await this.request<{ goals: GoalRecord[] }>('/api/v1/goals');
    return res.goals || [];
  }

  async createGoal(title: string, description?: string, priority?: string): Promise<GoalRecord> {
    return this.request('/api/v1/goals', {
      method: 'POST',
      body: JSON.stringify({ title, description, priority }),
    });
  }

  async getGoalTasks(goalId: string): Promise<any[]> {
    const res = await this.request<{ goalId: string; tasks: any[] }>(`/api/v1/goals/${goalId}/tasks`);
    return res.tasks || [];
  }

  async planGoal(goalId: string): Promise<{ goal: GoalRecord; tasks: any[] }> {
    return this.request(`/api/v1/goals/${goalId}/plan`, { method: 'POST' });
  }

  async executeGoal(goalId: string, sessionId?: string): Promise<any> {
    return this.request(`/api/v1/goals/${goalId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
  }

  // Artifacts
  async listArtifacts(): Promise<ArtifactRecord[]> {
    const res = await this.request<{ artifacts: ArtifactRecord[] }>('/api/v1/artifacts');
    return res.artifacts || [];
  }

  async getArtifact(artifactId: string): Promise<ArtifactRecord> {
    return this.request(`/api/v1/artifacts/${artifactId}`);
  }

  async getArtifactVersions(artifactId: string): Promise<any[]> {
    const res = await this.request<{ versions: any[] }>(`/api/v1/artifacts/${artifactId}/versions`);
    return res.versions || [];
  }

  // System
  async getSystemCapabilities(): Promise<any> {
    return this.request('/api/v1/system/capabilities');
  }

  async getSystemPolicy(): Promise<any> {
    return this.request('/api/v1/system/policy');
  }

  async listWorkspaceFiles(query?: string): Promise<Array<{ name: string; path: string; type: 'file' | 'folder' }>> {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    const res = await this.request<{ files: Array<{ name: string; path: string; type: 'file' | 'folder' }> }>(`/api/v1/system/files${qs}`);
    return res.files || [];
  }
}

export const apiClient = new AthenaApiClient();
