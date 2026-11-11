import { ApprovalStore, RunWaitStore } from '../../storage/stores/types.js';
import { SSEManager } from '../events/sseManager.js';
import { createEventEnvelope } from '../events/eventEnvelope.js';

export interface ApprovalDecisionInput {
  approvalId: string;
  status: 'approved' | 'rejected';
  reason?: string;
  modifiedParams?: Record<string, any>;
  actor?: string;
}

export class ApprovalService {
  private pendingResolvers = new Map<string, (approved: boolean) => void>();

  constructor(
    private approvalStore: ApprovalStore,
    private runWaitStore?: RunWaitStore,
    private sseManager?: SSEManager
  ) {}

  async requestApproval(params: {
    runId: string;
    sessionId?: string;
    action: string;
    description?: string;
    params?: Record<string, any>;
    riskLevel?: 'safe' | 'confirm' | 'dangerous';
    timeoutMs?: number;
  }): Promise<boolean> {
    const approvalId = `appr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timeoutMs = params.timeoutMs || 120000;
    const expiresAt = Date.now() + timeoutMs;

    const mappedRisk: 'low' | 'medium' | 'high' | 'critical' =
      params.riskLevel === 'dangerous' ? 'critical' : params.riskLevel === 'safe' ? 'low' : 'medium';

    await this.approvalStore.createRequest({
      id: approvalId,
      runId: params.runId,
      action: params.action,
      explanation: params.description || `Approval required to execute tool: ${params.action}`,
      riskLevel: mappedRisk,
      proposedAction: params.params || {},
      status: 'pending',
      expiresAt,
      createdAt: Date.now()
    });

    if (this.sseManager) {
      this.sseManager.broadcast(
        createEventEnvelope(
          'approval.required',
          {
            approvalId,
            runId: params.runId,
            action: params.action,
            params: params.params,
            riskLevel: mappedRisk,
            explanation: params.description || `Approval required to execute tool: ${params.action}`,
            expiresAt
          },
          { runId: params.runId, sessionId: params.sessionId }
        )
      );
    }

    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingResolvers.delete(approvalId);
        resolve(false);
      }, timeoutMs);

      this.pendingResolvers.set(approvalId, (approved) => {
        clearTimeout(timer);
        this.pendingResolvers.delete(approvalId);
        resolve(approved);
      });
    });
  }

  async decide(input: ApprovalDecisionInput): Promise<any> {
    const existing = await this.approvalStore.getRequest(input.approvalId);
    if (!existing) {
      throw new Error(`Approval request not found: ${input.approvalId}`);
    }

    if (existing.status !== 'pending') {
      const err: any = new Error('This approval has already been resolved.');
      err.code = 'APPROVAL_ALREADY_RESOLVED';
      err.statusCode = 409;
      throw err;
    }

    // Server-side expiry check
    if (existing.expiresAt && Date.now() > existing.expiresAt) {
      await this.approvalStore.resolveRequest(input.approvalId, 'rejected', 'Approval expired');
      const resolver = this.pendingResolvers.get(input.approvalId);
      if (resolver) {
        resolver(false);
        this.pendingResolvers.delete(input.approvalId);
      }
      const err: any = new Error('This approval request has expired.');
      err.code = 'APPROVAL_EXPIRED';
      err.statusCode = 410;
      throw err;
    }

    // Atomic resolve
    const resolved = await this.approvalStore.resolveRequest(input.approvalId, input.status, input.reason);
    if (!resolved) {
      const err: any = new Error('Conflict resolving approval (already resolved by competing actor).');
      err.code = 'APPROVAL_ALREADY_RESOLVED';
      err.statusCode = 409;
      throw err;
    }

    // Unblock in-memory agent resolver
    const resolver = this.pendingResolvers.get(input.approvalId);
    if (resolver) {
      resolver(input.status === 'approved');
      this.pendingResolvers.delete(input.approvalId);
    }

    // Unblock run wait if waiting
    if (existing.runId && this.runWaitStore) {
      const wait = await this.runWaitStore.getByRunId(existing.runId);
      if (wait && wait.status === 'waiting') {
        await this.runWaitStore.update(wait.id, {
          status: input.status === 'approved' ? 'satisfied' : 'cancelled',
          waitResult: {
            approvalId: input.approvalId,
            status: input.status,
            reason: input.reason
          }
        });
      }
    }

    // Broadcast SSE event
    if (this.sseManager) {
      this.sseManager.broadcast(
        createEventEnvelope(
          'approval.resolved',
          {
            approvalId: input.approvalId,
            decision: input.status,
            reason: input.reason,
            actor: input.actor || 'user'
          },
          { runId: existing.runId, sessionId: undefined }
        )
      );
    }

    return resolved;
  }
}
