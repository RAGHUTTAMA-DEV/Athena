export interface AthenaClientOptions {
  baseUrl: string;
  apiKey?: string;
  workspaceId?: number;
}

export class AthenaClient {
  private baseUrl: string;
  private apiKey?: string;
  private workspaceId?: number;

  constructor(options: AthenaClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.workspaceId = options.workspaceId;
  }

  private async request<T = any>(endpoint: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> || {})
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }
    if (this.workspaceId) {
      headers['x-workspace-id'] = String(this.workspaceId);
    }

    const res = await fetch(url, { ...init, headers });
    if (!res.ok) {
      let errBody: any;
      try {
        errBody = await res.json();
      } catch {
        errBody = { message: res.statusText };
      }
      const err: any = new Error(errBody.error?.message || `HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      err.code = errBody.error?.code;
      err.details = errBody.error?.details;
      throw err;
    }
    return res.json() as Promise<T>;
  }

  // Health
  async getHealthLive() {
    return this.request('/health/live');
  }

  async getHealthReady() {
    return this.request('/health/ready');
  }

  // Sessions & Messages
  async submitMessage(sessionId: string, content: string, idempotencyKey?: string) {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
    return this.request(`/api/v1/sessions/${sessionId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content })
    });
  }

  async getSessionState(sessionId: string) {
    return this.request(`/api/v1/sessions/${sessionId}/state`);
  }

  // Runs
  async getRun(runId: string) {
    return this.request(`/api/v1/runs/${runId}`);
  }

  async abortRun(runId: string) {
    return this.request(`/api/v1/runs/${runId}/abort`, { method: 'POST' });
  }

  async getRunReplay(runId: string) {
    return this.request(`/api/v1/runs/${runId}/replay`);
  }

  // Approvals
  async getPendingApprovals() {
    return this.request('/api/v1/approvals/pending');
  }

  async decideApproval(approvalId: string, status: 'approved' | 'rejected', reason?: string) {
    return this.request(`/api/v1/approvals/${approvalId}/decision`, {
      method: 'POST',
      body: JSON.stringify({ status, reason })
    });
  }

  // Artifacts
  async listArtifacts() {
    return this.request('/api/v1/artifacts');
  }

  async getArtifact(artifactId: string) {
    return this.request(`/api/v1/artifacts/${artifactId}`);
  }

  async getArtifactDiff(artifactId: string, fromVersion: number, toVersion: number) {
    return this.request(`/api/v1/artifacts/${artifactId}/diff?fromVersion=${fromVersion}&toVersion=${toVersion}`);
  }

  // Goals
  async listGoals() {
    return this.request('/api/v1/goals');
  }

  async createGoal(title: string, description?: string) {
    return this.request('/api/v1/goals', {
      method: 'POST',
      body: JSON.stringify({ title, description })
    });
  }
}
