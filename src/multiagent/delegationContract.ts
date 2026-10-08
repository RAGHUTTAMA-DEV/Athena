import { DelegationContract, SpecializedRole } from './types.js';
import { getSpecializedProfile } from './specializedProfiles.js';

export const MAX_DELEGATION_DEPTH = 3;
export const MAX_SUBAGENTS_PER_GOAL = 5;

export interface DelegationValidationResult {
  valid: boolean;
  errors: string[];
}

export class DelegationContractEngine {
  private activeSubagentCount: Map<string, number> = new Map();

  /**
   * Validate a proposed delegation contract against safety, depth, and budget limits.
   */
  public validateContract(
    contract: DelegationContract,
    currentDepth: number,
    activeSubagentsForGoal: number = 0
  ): DelegationValidationResult {
    const errors: string[] = [];

    // 1. Depth check (Exit Criterion 3)
    if (currentDepth >= MAX_DELEGATION_DEPTH) {
      errors.push(`Delegation depth limit exceeded (current depth: ${currentDepth}, max allowed: ${MAX_DELEGATION_DEPTH}).`);
    }

    // 2. Active subagent count check (Exit Criterion 3)
    if (activeSubagentsForGoal >= MAX_SUBAGENTS_PER_GOAL) {
      errors.push(`Subagent concurrency cap exceeded for goal (active: ${activeSubagentsForGoal}, max allowed: ${MAX_SUBAGENTS_PER_GOAL}).`);
    }

    // 3. Task description check
    if (!contract.taskDescription || contract.taskDescription.trim().length === 0) {
      errors.push('Delegation contract requires a non-empty taskDescription.');
    }

    // 4. Bounded lifetime check
    if (!contract.boundedLifetime) {
      errors.push('Delegation contract must specify boundedLifetime.');
    } else {
      if (contract.boundedLifetime.maxTurns <= 0 || contract.boundedLifetime.maxTurns > 30) {
        errors.push(`Invalid maxTurns: ${contract.boundedLifetime.maxTurns}. Must be between 1 and 30.`);
      }
      if (contract.boundedLifetime.timeoutMs <= 0 || contract.boundedLifetime.timeoutMs > 600000) {
        errors.push(`Invalid timeoutMs: ${contract.boundedLifetime.timeoutMs}. Must be between 1ms and 600000ms (10 minutes).`);
      }
    }

    // 5. Tool scoping check (Spec 33)
    if (!Array.isArray(contract.allowedTools) || contract.allowedTools.length === 0) {
      errors.push('Delegation contract must specify a non-empty allowedTools array.');
    } else {
      const profile = getSpecializedProfile(contract.targetRole);
      // Reviewer role cannot have execution/write tools
      if (contract.targetRole.toLowerCase() === 'reviewer') {
        const forbiddenTools = ['writeFile', 'editFile', 'executeCommand', 'deleteFile'];
        const violating = contract.allowedTools.filter(t => forbiddenTools.includes(t));
        if (violating.length > 0) {
          errors.push(`Reviewer role cannot be assigned destructive or write tools: ${violating.join(', ')}.`);
        }
      }
    }

    // 6. Output contract
    if (!contract.outputContract || !contract.outputContract.format) {
      errors.push('Delegation contract must specify an outputContract format.');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Enforces tool scope execution guard (Exit Criterion 2).
   * Returns true if tool execution is permitted; throws Error if tool is out of scope.
   */
  public verifyToolExecution(toolName: string, allowedTools: string[]): boolean {
    if (!allowedTools.includes(toolName)) {
      throw new Error(`Tool scoping violation: Tool "${toolName}" is not authorized in this sub-agent delegation contract. Authorized tools: [${allowedTools.join(', ')}].`);
    }
    return true;
  }

  /**
   * Creates a normalized DelegationContract with sensible defaults.
   */
  public createContract(params: {
    parentAgentId: string;
    targetRole: SpecializedRole | string;
    taskDescription: string;
    scopedContext: string;
    allowedTools?: string[];
    goalId?: string;
    taskId?: string;
    maxTurns?: number;
    timeoutMs?: number;
    outputFormat?: 'summary' | 'artifact' | 'json' | 'structured';
    expectedFields?: string[];
    handoffMetadata?: Record<string, any>;
  }): DelegationContract {
    const roleProfile = getSpecializedProfile(params.targetRole);
    const resolvedTools = params.allowedTools && params.allowedTools.length > 0
      ? params.allowedTools
      : roleProfile.skills;

    return {
      contractId: `contract_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      parentAgentId: params.parentAgentId,
      targetRole: params.targetRole,
      targetAgentId: roleProfile.id,
      goalId: params.goalId,
      taskId: params.taskId,
      taskDescription: params.taskDescription,
      scopedContext: params.scopedContext,
      allowedTools: resolvedTools,
      permissionScope: roleProfile.permissions,
      boundedLifetime: {
        maxTurns: Math.min(params.maxTurns || 10, 20),
        timeoutMs: Math.min(params.timeoutMs || 120000, 300000)
      },
      outputContract: {
        format: params.outputFormat || 'summary',
        expectedFields: params.expectedFields
      },
      handoffMetadata: params.handoffMetadata
    };
  }

  public registerActiveSubagent(goalId: string): void {
    const current = this.activeSubagentCount.get(goalId) || 0;
    this.activeSubagentCount.set(goalId, current + 1);
  }

  public unregisterActiveSubagent(goalId: string): void {
    const current = this.activeSubagentCount.get(goalId) || 0;
    if (current > 0) {
      this.activeSubagentCount.set(goalId, current - 1);
    }
  }

  public getActiveCount(goalId: string): number {
    return this.activeSubagentCount.get(goalId) || 0;
  }
}
