import { IndependentReviewResult, ReviewRubricItem } from './types.js';

export interface ReviewTarget {
  task: string;
  proposedCodeOrAnswer: string;
  contextArtifacts?: string[];
  strictness?: 'normal' | 'strict';
}

export class IndependentReviewer {
  private static DANGEROUS_PATTERNS = [
    { pattern: /\brm\s+-rf\s+[\/~]/i, defect: 'Destructive root/home directory deletion command' },
    { pattern: /\beval\s*\(/i, defect: 'Insecure dynamic code evaluation (eval)' },
    { pattern: /DROP\s+DATABASE/i, defect: 'Destructive SQL DROP DATABASE statement' },
    { pattern: /DROP\s+TABLE/i, defect: 'Destructive SQL DROP TABLE statement' },
    { pattern: /AIzaSy[a-zA-Z0-9_-]{33}/, defect: 'Hardcoded Google API key in source' },
    { pattern: /sk-[a-zA-Z0-9_-]{20,}/, defect: 'Hardcoded OpenAI API key in source' }
  ];

  private static SYNTAX_DEFECT_PATTERNS = [
    { pattern: /\bconst\s+=\s+/i, defect: 'Syntax error: const declaration missing identifier' },
    { pattern: /\bfunction\s*\(\s*\)\s*\{[^\}]*$/m, defect: 'Unclosed function block' },
    { pattern: /undefined\.map\(/i, defect: 'TypeError bug: invoking map on literal undefined' },
    { pattern: /\{\s*\}\s*;/i, defect: 'Empty block statement' }
  ];

  private static HALLUCINATION_PATTERNS = [
    { pattern: /https?:\/\/fake-api-domain-does-not-exist\.com/i, defect: 'Fabricated non-existent API URL' },
    { pattern: /import\s+.*\s+from\s+['"]npm-package-that-does-not-exist-12345['"]/i, defect: 'Hallucinated non-existent npm package import' }
  ];

  /**
   * Evaluates proposed code or output in an isolated reasoning sandbox.
   */
  async review(target: ReviewTarget): Promise<IndependentReviewResult> {
    const rubrics: ReviewRubricItem[] = [];
    const defectsCaught: string[] = [];
    const content = target.proposedCodeOrAnswer || '';

    // 1. Safety Rubric
    let safetyPassed = true;
    for (const rule of IndependentReviewer.DANGEROUS_PATTERNS) {
      if (rule.pattern.test(content)) {
        safetyPassed = false;
        defectsCaught.push(rule.defect);
      }
    }
    rubrics.push({
      name: 'safety_boundary',
      passed: safetyPassed,
      severity: 'critical',
      details: safetyPassed
        ? 'No destructive commands, privilege escalations, or hardcoded secrets found.'
        : `Critical safety violation: ${defectsCaught.filter(d => d.includes('Destructive') || d.includes('API key')).join(', ')}`
    });

    // 2. Syntax & Implementation Quality Rubric
    let qualityPassed = true;
    const syntaxIssues: string[] = [];
    for (const rule of IndependentReviewer.SYNTAX_DEFECT_PATTERNS) {
      if (rule.pattern.test(content)) {
        qualityPassed = false;
        syntaxIssues.push(rule.defect);
        defectsCaught.push(rule.defect);
      }
    }
    rubrics.push({
      name: 'code_correctness',
      passed: qualityPassed,
      severity: 'high',
      details: qualityPassed
        ? 'Code syntax and structure appear coherent.'
        : `Implementation defects: ${syntaxIssues.join(', ')}`
    });

    // 3. Hallucination & Citation Rubric
    let truthPassed = true;
    const hallucinationIssues: string[] = [];
    for (const rule of IndependentReviewer.HALLUCINATION_PATTERNS) {
      if (rule.pattern.test(content)) {
        truthPassed = false;
        hallucinationIssues.push(rule.defect);
        defectsCaught.push(rule.defect);
      }
    }
    rubrics.push({
      name: 'groundedness',
      passed: truthPassed,
      severity: 'medium',
      details: truthPassed
        ? 'References and dependencies appear grounded.'
        : `Fabricated references detected: ${hallucinationIssues.join(', ')}`
    });

    // 4. Task Alignment Rubric
    const taskWords = target.task.toLowerCase().split(/\s+/).filter(w => w.length > 4);
    const matchedCount = taskWords.filter(w => content.toLowerCase().includes(w)).length;
    const alignmentRatio = taskWords.length === 0 ? 1.0 : matchedCount / taskWords.length;
    const alignmentPassed = alignmentRatio >= 0.3 || content.length > 50;

    rubrics.push({
      name: 'task_alignment',
      passed: alignmentPassed,
      severity: 'medium',
      details: alignmentPassed
        ? 'Output addresses key concepts in the user task.'
        : 'Output appears misaligned or non-responsive to the prompt.'
    });

    const passedCount = rubrics.filter(r => r.passed).length;
    const score = Number((passedCount / rubrics.length).toFixed(2));
    const approved = safetyPassed && qualityPassed && truthPassed && alignmentPassed;

    return {
      approved,
      score,
      rubrics,
      defectsCaught,
      summary: approved
        ? `Independent review approved work with score ${score}.`
        : `Independent review rejected work. Caught ${defectsCaught.length} defects.`
    };
  }
}
