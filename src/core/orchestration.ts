import { RunState } from './runState.js';
import { AgentEventEmitter } from './events.js';
import { LLMProvider } from './llmProvider.js';
import { Message, ToolContext } from './types.js';

export type TaskComplexity = 'simple' | 'medium' | 'complex' | 'high_risk';

export interface TaskClassification {
  complexity: TaskComplexity;
  reason: string;
  requiresVerification: boolean;
  suggestedMaxTurns: number;
}

export interface PlanStep {
  stepId: string;
  description: string;
  dependencies: string[]; // Step IDs that must succeed first
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
  assignedTool?: string;
  acceptanceCriteria?: string;
  result?: any;
  error?: string;
}

export interface ExecutionPlan {
  planId: string;
  goal: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  status: 'draft' | 'executing' | 'completed' | 'failed';
}

export interface VerificationResult {
  passed: boolean;
  score: number; // 0.0 to 1.0
  reasoning: string;
  issues: string[];
  repairSuggestions?: string[];
}

export class TaskClassifier {
  private static SIMPLE_PATTERNS = [
    /^(calculate|what is|how much is|time|current time|date|today|who is|who was|define|translate)\b/i,
    /^(hi|hello|hey|greetings|help|ping)\b/i,
    /^(what is my name|what is my fav|who am i)\b/i
  ];

  private static COMPLEX_PATTERNS = [
    /\b(step[- ]by[- ]step|plan|roadmap|architect|refactor|design system|multi[- ]agent|comprehensive|investigate and fix|build an?|develop a)\b/i,
    /\b(first.*then.*finally|1\..*2\..*3\.)/is,
    /\b(compare.*and.*recommend|benchmark.*and.*evaluate)\b/i
  ];

  private static HIGH_RISK_PATTERNS = [
    /\b(rm -rf|delete (all|table|database)|drop database|format|killall|shutdown)\b/i
  ];

  static classify(prompt: string): TaskClassification {
    const trimmed = prompt.trim();
    const wordCount = trimmed.split(/\s+/).length;

    // 1. High risk check
    for (const pattern of TaskClassifier.HIGH_RISK_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          complexity: 'high_risk',
          reason: 'Prompt contains potentially destructive or high-impact actions.',
          requiresVerification: true,
          suggestedMaxTurns: 10
        };
      }
    }

    // 2. Simple check: short question matching standard queries
    if (wordCount <= 20) {
      for (const pattern of TaskClassifier.SIMPLE_PATTERNS) {
        if (pattern.test(trimmed)) {
          return {
            complexity: 'simple',
            reason: 'Direct informational or computational query matching simple heuristic pattern.',
            requiresVerification: false,
            suggestedMaxTurns: 5
          };
        }
      }
    }

    // 3. Complex check: explicit planning, multi-part directives
    for (const pattern of TaskClassifier.COMPLEX_PATTERNS) {
      if (pattern.test(trimmed)) {
        return {
          complexity: 'complex',
          reason: 'Multi-part objective or architectural task requiring step-by-step DAG decomposition.',
          requiresVerification: true,
          suggestedMaxTurns: 25
        };
      }
    }

    // If long prompt with multiple sentences, classify as complex
    if (wordCount > 60 || trimmed.includes('\n- ') || trimmed.includes('\n* ')) {
      return {
        complexity: 'complex',
        reason: 'Elaborate multi-point prompt structure requiring decomposed task execution.',
        requiresVerification: true,
        suggestedMaxTurns: 20
      };
    }

    // Default to medium
    return {
      complexity: 'medium',
      reason: 'Standard conversational task with moderate tool execution.',
      requiresVerification: false,
      suggestedMaxTurns: 15
    };
  }
}

export class Planner {
  static createPlanFromGoal(goal: string, steps: Array<{ description: string; dependencies?: string[]; acceptanceCriteria?: string }>): ExecutionPlan {
    const planId = `plan_${Math.random().toString(36).substring(2, 9)}`;
    const planSteps: PlanStep[] = steps.map((s, idx) => ({
      stepId: `step_${idx + 1}`,
      description: s.description,
      dependencies: s.dependencies || (idx > 0 ? [`step_${idx}`] : []),
      status: 'pending',
      acceptanceCriteria: s.acceptanceCriteria
    }));

    return {
      planId,
      goal,
      steps: planSteps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'draft'
    };
  }

  static decomposeGoal(goal: string): ExecutionPlan {
    const promptLower = goal.toLowerCase();
    const steps: Array<{ description: string; dependencies?: string[]; acceptanceCriteria?: string }> = [];

    if (promptLower.includes('search') || promptLower.includes('research') || promptLower.includes('find')) {
      steps.push({
        description: `Investigate and gather primary information for: "${goal}"`,
        dependencies: [],
        acceptanceCriteria: 'Key facts and sources retrieved.'
      });
      steps.push({
        description: 'Synthesize findings and prepare structured response',
        dependencies: ['step_1'],
        acceptanceCriteria: 'Comprehensive summary answering the user prompt.'
      });
    } else if (promptLower.includes('fix') || promptLower.includes('bug') || promptLower.includes('refactor') || promptLower.includes('edit')) {
      steps.push({
        description: 'Locate relevant files and inspect existing code structure',
        dependencies: [],
        acceptanceCriteria: 'Target files and lines identified.'
      });
      steps.push({
        description: 'Apply modifications and ensure structural correctness',
        dependencies: ['step_1'],
        acceptanceCriteria: 'Code changes implemented.'
      });
      steps.push({
        description: 'Verify implementation integrity and test results',
        dependencies: ['step_2'],
        acceptanceCriteria: 'No diagnostic errors or test regressions.'
      });
    } else {
      steps.push({
        description: `Analyze requirements and plan execution for: "${goal}"`,
        dependencies: [],
        acceptanceCriteria: 'Initial scope established.'
      });
      steps.push({
        description: 'Execute necessary tool actions and generate solution',
        dependencies: ['step_1'],
        acceptanceCriteria: 'Sub-tasks executed.'
      });
      steps.push({
        description: 'Consolidate final answer and verify criteria satisfaction',
        dependencies: ['step_2'],
        acceptanceCriteria: 'Objective successfully fulfilled.'
      });
    }

    return Planner.createPlanFromGoal(goal, steps);
  }

  static getExecutableSteps(plan: ExecutionPlan): PlanStep[] {
    const completedIds = new Set(plan.steps.filter(s => s.status === 'completed').map(s => s.stepId));
    return plan.steps.filter(step => {
      if (step.status !== 'pending') return false;
      return step.dependencies.every(depId => completedIds.has(depId));
    });
  }
}

export class VerificationGate {
  static verify(goal: string, output: string, criteria?: string[]): VerificationResult {
    const issues: string[] = [];
    let score = 1.0;

    if (!output || output.trim().length === 0) {
      return {
        passed: false,
        score: 0.0,
        reasoning: 'Output is completely empty.',
        issues: ['Empty agent output.'],
        repairSuggestions: ['Re-run execution to produce a meaningful response.']
      };
    }

    const outputLower = output.toLowerCase();

    // Check for explicit failure markers
    if (
      outputLower.includes('i could not') ||
      outputLower.includes('an error occurred') ||
      outputLower.includes('failed to execute') ||
      outputLower.includes('permission denied')
    ) {
      issues.push('Output contains error or inability statements.');
      score -= 0.4;
    }

    // Check criteria if provided
    if (criteria && criteria.length > 0) {
      for (const criterion of criteria) {
        const critLower = criterion.toLowerCase();
        // Simple presence heuristic
        const keywords = critLower.split(/[^a-z0-9]+/).filter(w => w.length > 3);
        const matches = keywords.filter(kw => outputLower.includes(kw));
        if (keywords.length > 0 && matches.length === 0) {
          issues.push(`Criterion "${criterion}" was not clearly satisfied in output.`);
          score -= 0.2;
        }
      }
    }

    score = Math.max(0.0, Math.min(1.0, score));
    const passed = score >= 0.70;

    return {
      passed,
      score,
      reasoning: passed
        ? `Output satisfied acceptance criteria with score ${score.toFixed(2)}.`
        : `Output failed verification with score ${score.toFixed(2)} due to detected issues.`,
      issues,
      repairSuggestions: issues.length > 0
        ? issues.map(iss => `Address issue: ${iss}`)
        : undefined
    };
  }
}

export class DynamicEscalator {
  private toolFailuresCount: number = 0;
  private consecutiveEmptyTurns: number = 0;
  private currentComplexity: TaskComplexity = 'simple';

  constructor(initialComplexity: TaskComplexity = 'simple') {
    this.currentComplexity = initialComplexity;
  }

  getComplexity(): TaskComplexity {
    return this.currentComplexity;
  }

  recordToolResult(success: boolean): void {
    if (!success) {
      this.toolFailuresCount++;
    } else {
      this.toolFailuresCount = Math.max(0, this.toolFailuresCount - 1);
    }
  }

  recordTurn(turn: number, responseEmpty: boolean): void {
    if (responseEmpty) {
      this.consecutiveEmptyTurns++;
    } else {
      this.consecutiveEmptyTurns = 0;
    }
  }

  shouldEscalate(currentTurn: number): { escalate: boolean; targetComplexity?: TaskComplexity; reason?: string } {
    // 1. Escalate simple to medium if turn count > 4 or 2 tool failures
    if (this.currentComplexity === 'simple') {
      if (this.toolFailuresCount >= 2) {
        return {
          escalate: true,
          targetComplexity: 'medium',
          reason: `Simple execution encountered ${this.toolFailuresCount} tool failures; escalating to medium for checkpointing.`
        };
      }
      if (currentTurn > 4) {
        return {
          escalate: true,
          targetComplexity: 'medium',
          reason: `Simple execution exceeded 4 turns (${currentTurn}); escalating to medium context.`
        };
      }
    }

    // 2. Escalate medium to complex if turn count > 8 or 3 tool failures
    if (this.currentComplexity === 'medium') {
      if (this.toolFailuresCount >= 3) {
        return {
          escalate: true,
          targetComplexity: 'complex',
          reason: `Medium execution encountered ${this.toolFailuresCount} tool failures; escalating to plan-based complex mode.`
        };
      }
      if (currentTurn > 8) {
        return {
          escalate: true,
          targetComplexity: 'complex',
          reason: `Execution exceeded 8 turns (${currentTurn}); decomposing into structured plan DAG.`
        };
      }
    }

    return { escalate: false };
  }

  escalate(target: TaskComplexity): void {
    this.currentComplexity = target;
  }
}
