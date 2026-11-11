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

  // Tools & MCP
  async listTools(q?: string, category?: string): Promise<{ tools: any[]; count: number; totalRegistered: number }> {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/api/v1/tools${qs}`);
  }

  async listMcpServers(): Promise<{ servers: Record<string, any>; count: number }> {
    return this.request('/api/v1/mcp/servers');
  }

  async registerMcpServer(data: { name: string; type: string; command?: string; args?: string[]; url?: string; env?: Record<string, string> }): Promise<any> {
    return this.request('/api/v1/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteMcpServer(name: string): Promise<any> {
    return this.request(`/api/v1/mcp/servers/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  // Communication & Calendar
  async listChannels(): Promise<any[]> {
    const res = await this.request<{ channels: any[] }>('/api/v1/communication/channels');
    return res.channels || [];
  }

  async listCalendarEvents(): Promise<any[]> {
    const res = await this.request<{ events: any[] }>('/api/v1/calendar/events');
    return res.events || [];
  }

  async createCalendarEvent(data: { title: string; description?: string; startTime: number; endTime: number; location?: string }): Promise<any> {
    return this.request('/api/v1/calendar/events', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Automations / Proactive / Routines
  async listRoutines(): Promise<any[]> {
    const res = await this.request<{ routines: any[] }>('/api/v1/learning/routines');
    return res.routines || [];
  }

  async createRoutine(data: { name: string; triggerType: string; triggerConfig: any; workflow: any }): Promise<any> {
    return this.request('/api/v1/learning/routines', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getHeartbeats(): Promise<{ summary: any; recentLogs: any[] }> {
    return this.request('/api/v1/proactive/heartbeats');
  }

  async listProactiveEvents(status?: string): Promise<any[]> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const res = await this.request<{ events: any[] }>(`/api/v1/proactive/events${qs}`);
    return res.events || [];
  }

  async retryProactiveEvent(id: string): Promise<any> {
    return this.request(`/api/v1/proactive/events/${id}/retry`, { method: 'POST' });
  }

  async listWebhooks(): Promise<any[]> {
    const res = await this.request<{ endpoints: any[] }>('/api/v1/proactive/webhooks');
    return res.endpoints || [];
  }

  // Knowledge & RAG
  async listResearchDocuments(sessionId?: string): Promise<any[]> {
    const qs = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    const res = await this.request<{ documents: any[] }>(`/api/v1/research/documents${qs}`);
    return res.documents || [];
  }

  async uploadAttachment(
    file: File,
    sessionId?: string
  ): Promise<{
    attachmentId: string;
    documentId: string;
    name: string;
    mimeType: string;
    size: number;
    filePath: string;
    sidecarPath: string;
    format: string;
    pageCount?: number;
    charCount: number;
    chunkCount: number;
    ocrUsed: boolean;
    hasIndexPage: boolean;
    indexPages: number[];
    indexEntryCount: number;
    mediaCount: number;
    scannedPages: number[];
    mixedPages: number[];
    outlineSummary?: string;
    preview: string;
    ragIndexed: boolean;
    deduplicated?: boolean;
    warning?: string;
  }> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
    return this.request('/api/v1/attachments/upload', {
      method: 'POST',
      body: JSON.stringify({
        name: file.name,
        mimeType: file.type || 'application/octet-stream',
        contentBase64: dataUrl,
        sessionId,
      }),
    });
  }

  async uploadResearchDocument(data: {
    title: string;
    sourceUri: string;
    sourceType?: string;
    textContent?: string;
    contentBase64?: string;
    mimeType?: string;
  }): Promise<any> {
    return this.request('/api/v1/research/documents/upload', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async searchResearch(query: string, limit = 8): Promise<any> {
    return this.request('/api/v1/research/search', {
      method: 'POST',
      body: JSON.stringify({ query, limit }),
    });
  }

  async getVectorStats(): Promise<any> {
    return this.request('/api/v1/research/vectors/stats');
  }

  // Agent Studio (Skills, Workflows, Multi-agent)
  async listSkills(): Promise<any[]> {
    const res = await this.request<{ skills: any[] }>('/api/v1/learning/skills');
    return res.skills || [];
  }

  async listWorkflows(): Promise<any[]> {
    const res = await this.request<{ workflows: any[] }>('/api/v1/learning/workflows');
    return res.workflows || [];
  }

  async reviewWorkflow(id: string, status: 'active' | 'rejected' | 'approved', notes?: string): Promise<any> {
    return this.request(`/api/v1/learning/workflows/${id}/review`, {
      method: 'POST',
      body: JSON.stringify({ status, notes }),
    });
  }

  async listTeams(): Promise<any[]> {
    const res = await this.request<{ teams: any[] }>('/api/v1/teams');
    return res.teams || [];
  }

  async createTeam(data: { name: string; justification: string; leadAgentId: string; memberAgentIds: string[] }): Promise<any> {
    return this.request('/api/v1/teams', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async listAgentMessages(recipientId: string): Promise<any[]> {
    const res = await this.request<{ messages: any[] }>(`/api/v1/agents/messages?recipientId=${encodeURIComponent(recipientId)}`);
    return res.messages || [];
  }

  // Intelligence, Telemetry, Harness, Browser, Computer
  async listModels(): Promise<{ models: any[]; policies: any[] }> {
    return this.request('/api/v1/intelligence/models');
  }

  async getCacheStats(): Promise<any> {
    return this.request('/api/v1/intelligence/cache/stats');
  }

  async getTelemetryMetrics(): Promise<any> {
    return this.request('/api/v1/telemetry/metrics');
  }

  async getHarnessStatus(): Promise<any> {
    return this.request('/api/v1/harness/status');
  }

  async getHarnessDiff(): Promise<any> {
    return this.request('/api/v1/harness/diff');
  }

  async listBrowserProfiles(): Promise<any[]> {
    const res = await this.request<{ profiles: any[] }>('/api/v1/browser/profiles');
    return res.profiles || [];
  }

  async getComputerScreen(): Promise<any> {
    return this.request('/api/v1/computer/screen');
  }

  async listComputerWindows(): Promise<any[]> {
    const res = await this.request<{ windows: any[] }>('/api/v1/computer/windows');
    return res.windows || [];
  }
}

export const apiClient = new AthenaApiClient();
