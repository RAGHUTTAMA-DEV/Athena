import { ApprovalStore, ApprovalRequest, RunWaitStore } from '../storage/stores/types.js';
import { HITLEvaluation, HITLTriggerType } from './types.js';

export interface ActionPayload {
  action: string;
  target?: string;
  params?: Record<string, any>;
  runId?: string;
  goalId?: string;
  taskId?: string;
  channelId?: string;
}

export class ApprovalEngine {
  constructor(
    private approvalStore: ApprovalStore,
    private runWaitStore?: RunWaitStore
  ) {}

  /**
   * Evaluates if a given action requires Human-In-The-Loop (HITL) approval.
   */
  evaluate(action: ActionPayload): HITLEvaluation {
    const act = action.action.toLowerCase();
    const strPayload = JSON.stringify(action.params || {}).toLowerCase();

    // 1. Destructive actions
    if (
      act.includes('delete') ||
      act.includes('remove') ||
      act.includes('rm_rf') ||
      act.includes('drop') ||
      strPayload.includes('rm -rf') ||
      strPayload.includes('drop table')
    ) {
      return {
        requiresApproval: true,
        triggerType: 'destructive',
        riskLevel: 'high',
        explanation: `Destructive operation detected on action "${action.action}". Requires human confirmation.`
      };
    }

    // 2. Financial actions
    if (
      act.includes('pay') ||
      act.includes('transfer') ||
      act.includes('purchase') ||
      act.includes('subscribe') ||
      strPayload.includes('amount') ||
      strPayload.includes('credit_card')
    ) {
      return {
        requiresApproval: true,
        triggerType: 'financial',
        riskLevel: 'critical',
        explanation: 'Financial transaction detected. Explicit user approval is mandatory.'
      };
    }

    // 3. External publication
    if (
      act.includes('publish') ||
      act.includes('broadcast') ||
      act.includes('tweet') ||
      (act.includes('email') && !strPayload.includes('self@'))
    ) {
      return {
        requiresApproval: true,
        triggerType: 'external_publication',
        riskLevel: 'medium',
        explanation: 'External publication to third parties requires approval.'
      };
    }

    // 4. Credential modification
    if (
      act.includes('credential') ||
      act.includes('token') ||
      act.includes('secret') ||
      strPayload.includes('api_key')
    ) {
      return {
        requiresApproval: true,
        triggerType: 'credential_modification',
        riskLevel: 'critical',
        explanation: 'Modification of system credentials requires explicit authorization.'
      };
    }

    // 5. Permission escalation
    if (
      act.includes('chmod') ||
      act.includes('sudo') ||
      act.includes('grant') ||
      strPayload.includes('admin')
    ) {
      return {
        requiresApproval: true,
        triggerType: 'permission_escalation',
        riskLevel: 'high',
        explanation: 'Privilege escalation or permission modification detected.'
      };
    }

    // 6. Critical ambiguity
    if (act.includes('run_script') && (!action.params || Object.keys(action.params).length === 0)) {
      return {
        requiresApproval: true,
        triggerType: 'critical_ambiguity',
        riskLevel: 'medium',
        explanation: 'Critical ambiguity: action lacks specified parameters.'
      };
    }

    return {
      requiresApproval: false,
      riskLevel: 'low',
      explanation: 'Action is safe and within normal autonomous boundaries.'
    };
  }

  /**
   * Creates and persists a formal ApprovalRequest, registering a persistent run_wait if runId is present.
   */
  async requestApproval(action: ActionPayload, evaluation: HITLEvaluation): Promise<ApprovalRequest> {
    const id = `appr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const now = Date.now();

    const request: ApprovalRequest = {
      id,
      action: action.action,
      riskLevel: evaluation.riskLevel,
      explanation: evaluation.explanation,
      proposedAction: action.params || {},
      status: 'pending',
      channelId: action.channelId,
      runId: action.runId,
      goalId: action.goalId,
      taskId: action.taskId,
      expiresAt: now + 24 * 60 * 60 * 1000, // 24 hours
      createdAt: now
    };

    await this.approvalStore.createRequest(request);

    // If linked to a run, register in RunWaitStore so the run transitions into approval_required / waiting state
    if (this.runWaitStore && action.runId) {
      await this.runWaitStore.create({
        id: `wait_${id}`,
        runId: action.runId,
        waitType: 'APPROVAL',
        status: 'waiting',
        deadline: request.expiresAt,
        eventPattern: id,
        matcherCriteria: { approvalId: id },
        createdAt: now,
        updatedAt: now
      });
    }

    return request;
  }

  /**
   * Resolves a pending approval request. Survives process restarts by updating SQLite.
   */
  async resolveApproval(
    id: string,
    decision: 'approved' | 'rejected',
    reason?: string
  ): Promise<ApprovalRequest | null> {
    const resolved = await this.approvalStore.resolveRequest(id, decision, reason);

    if (resolved && this.runWaitStore && resolved.runId) {
      // Find matching run wait and mark resolved
      const activeWaits = await this.runWaitStore.listActive();
      const wait = activeWaits.find(w => w.eventPattern === id || (w.matcherCriteria as any)?.approvalId === id);
      if (wait) {
        await this.runWaitStore.update(wait.id, {
          status: 'satisfied',
          waitResult: { status: decision, reason },
          updatedAt: Date.now()
        });
      }
    }

    return resolved;
  }

  async getRequest(id: string): Promise<ApprovalRequest | null> {
    return this.approvalStore.getRequest(id);
  }

  async listPending(runId?: string): Promise<ApprovalRequest[]> {
    return this.approvalStore.listPending(runId ? { runId } : undefined);
  }
}
