import { SelfRepairAttempt, SelfRepairResult } from './types.js';

export interface RepairTarget {
  task: string;
  originalCodeOrAction: string;
  errorOrFailure: string;
  verifier: (candidate: string) => Promise<{ passed: boolean; message?: string }>;
  repairFn?: (candidate: string, diagnosis: string) => Promise<string>;
  maxAttempts?: number;
}

export class SelfRepairEngine {
  async executeLoop(target: RepairTarget): Promise<SelfRepairResult> {
    const maxAttempts = target.maxAttempts ?? 3;
    const attempts: SelfRepairAttempt[] = [];
    let currentCandidate = target.originalCodeOrAction;
    let currentError = target.errorOrFailure;

    for (let attemptIdx = 1; attemptIdx <= maxAttempts; attemptIdx++) {
      // 1. Classify
      const classification = this.classifyFailure(currentError);

      // 2. Diagnose
      const diagnosis = this.diagnoseRootCause(classification, currentError);

      // 3. Replan
      const repairPlan = this.replan(classification, diagnosis);

      // 4. Repair (Execute fix)
      let repairedCode: string;
      if (target.repairFn) {
        repairedCode = await target.repairFn(currentCandidate, diagnosis);
      } else {
        repairedCode = this.applyHeuristicFix(currentCandidate, classification, diagnosis);
      }

      // 5. Verify
      const verification = await target.verifier(repairedCode);

      const attemptRecord: SelfRepairAttempt = {
        attemptIndex: attemptIdx,
        failureClassification: classification,
        diagnosis,
        repairPlan,
        actionTaken: `Applied repair patch for [${classification}] issue.`,
        verificationPassed: verification.passed
      };

      attempts.push(attemptRecord);

      if (verification.passed) {
        return {
          repaired: true,
          attemptsCount: attemptIdx,
          attempts,
          finalOutput: repairedCode,
          exhausted: false
        };
      }

      // Prepare for next attempt if failed
      currentCandidate = repairedCode;
      currentError = verification.message || 'Verification still failed after repair attempt.';
    }

    return {
      repaired: false,
      attemptsCount: maxAttempts,
      attempts,
      finalOutput: currentCandidate,
      exhausted: true
    };
  }

  classifyFailure(error: string): SelfRepairAttempt['failureClassification'] {
    const errLower = error.toLowerCase();
    if (errLower.includes('syntaxerror') || errLower.includes('unexpected token') || errLower.includes('missing identifier')) {
      return 'syntax';
    }
    if (errLower.includes('cannot find module') || errLower.includes('module_not_found') || errLower.includes('enoent')) {
      return 'missing_dependency';
    }
    if (errLower.includes('timed out') || errLower.includes('etimedout') || errLower.includes('timeout')) {
      return 'timeout';
    }
    if (errLower.includes('assertion') || errLower.includes('expected') || errLower.includes('mismatch')) {
      return 'assertion';
    }
    return 'logic';
  }

  diagnoseRootCause(classification: SelfRepairAttempt['failureClassification'], error: string): string {
    switch (classification) {
      case 'syntax':
        return `Code contains invalid syntax or malformed tokens: ${error}`;
      case 'missing_dependency':
        return `Required module, file or asset is absent in execution path: ${error}`;
      case 'timeout':
        return `Execution exceeded allocated timeout limits: ${error}`;
      case 'assertion':
        return `Output violated verification criteria: ${error}`;
      case 'logic':
      default:
        return `Execution produced unexpected output or unhandled exception: ${error}`;
    }
  }

  replan(classification: SelfRepairAttempt['failureClassification'], diagnosis: string): string {
    switch (classification) {
      case 'syntax':
        return 'Reformat statement syntax, ensure matching braces and valid variable declarations.';
      case 'missing_dependency':
        return 'Ensure missing module is installed or import path is correctly localized.';
      case 'timeout':
        return 'Optimize algorithm, break down into smaller chunks, or increase timeout tolerance.';
      case 'assertion':
        return 'Align output formatting directly with expected verification schema.';
      case 'logic':
      default:
        return 'Refactor logic flow to handle error conditions cleanly.';
    }
  }

  applyHeuristicFix(candidate: string, classification: string, diagnosis: string): string {
    if (classification === 'syntax') {
      // Fix common syntax error in tests e.g. "const = " -> "const val = "
      return candidate.replace(/\bconst\s+=\s+/g, 'const result = ');
    }
    if (classification === 'missing_dependency') {
      return `// Resolved dependency\n${candidate}`;
    }
    return `${candidate}\n// Repaired per diagnosis: ${diagnosis}`;
  }
}
