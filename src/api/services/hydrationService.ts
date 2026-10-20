import { RunStore, ApprovalStore, GoalStore, TaskStore } from '../../storage/stores/types.js';

export interface SessionStateView {
  sessionId: string;
  activeRun: any | null;
  recentRuns: any[];
  pendingApprovals: any[];
  activeGoal: any | null;
  tasks: any[];
  hydratedAt: number;
}

export class HydrationService {
  constructor(
    private runStore: RunStore,
    private approvalStore: ApprovalStore,
    private goalStore?: GoalStore,
    private taskStore?: TaskStore
  ) {}

  async getSessionState(sessionId: string): Promise<SessionStateView> {
    // 1. Get recent runs for this session
    const runs = await this.runStore.list(sessionId, 10);
    const activeRun = runs.find(r => r.status === 'running' || r.status === 'queued' || r.status === 'waiting') || runs[0] || null;

    // 2. Get pending approvals
    let pendingApprovals: any[] = [];
    try {
      pendingApprovals = await this.approvalStore.listPending(activeRun ? { runId: activeRun.runId } : undefined);
    } catch {
      pendingApprovals = [];
    }

    // 3. Get active goal & tasks if bound
    let activeGoal: any = null;
    let tasks: any[] = [];
    if (activeRun?.goalId && this.goalStore && this.taskStore) {
      activeGoal = await this.goalStore.get(activeRun.goalId);
      tasks = await this.taskStore.listByGoal(activeRun.goalId);
    }

    return {
      sessionId,
      activeRun,
      recentRuns: runs.slice(0, 5),
      pendingApprovals,
      activeGoal,
      tasks,
      hydratedAt: Date.now()
    };
  }
}
