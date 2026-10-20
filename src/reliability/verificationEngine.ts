import * as fs from 'fs/promises';
import { TaskVerificationCategory, TaskVerificationRequest, TaskVerificationOutcome } from './types.js';

export class TaskVerificationEngine {
  async verify(request: TaskVerificationRequest): Promise<TaskVerificationOutcome> {
    switch (request.taskType) {
      case 'file_verified':
        return this.verifyFile(request);
      case 'page_inspected':
        return this.verifyPage(request);
      case 'test_build':
        return this.verifyTestBuild(request);
      case 'sources_checked':
        return this.verifySources(request);
      case 'delivery_result':
        return this.verifyDelivery(request);
      case 'resulting_state':
        return this.verifyResultingState(request);
      default:
        return {
          passed: false,
          taskType: request.taskType,
          score: 0.0,
          evidenceSummary: 'Unknown verification category',
          failureReasons: [`Category "${request.taskType}" is not supported.`]
        };
    }
  }

  private async verifyFile(req: TaskVerificationRequest): Promise<TaskVerificationOutcome> {
    const filePath = req.options?.filePath;
    const failures: string[] = [];

    if (!filePath) {
      return {
        passed: false,
        taskType: 'file_verified',
        score: 0.0,
        evidenceSummary: 'No file path provided in options',
        failureReasons: ['Missing required option: filePath'],
        repairPlan: 'Provide valid filePath in verification options.'
      };
    }

    try {
      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        failures.push(`File at ${filePath} is empty (0 bytes).`);
      }

      const content = await fs.readFile(filePath, 'utf-8');
      if (filePath.endsWith('.json')) {
        try {
          JSON.parse(content);
        } catch (e: any) {
          failures.push(`JSON syntax invalid: ${e.message}`);
        }
      }

      // If expected content keyword
      if (req.expectedOutcome && !content.includes(req.expectedOutcome) && failures.length === 0) {
        // Soft match check
        const kw = req.expectedOutcome.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const hasMatch = kw.some(k => content.toLowerCase().includes(k));
        if (!hasMatch) {
          failures.push(`File does not appear to reflect expected outcome: "${req.expectedOutcome}"`);
        }
      }

      const passed = failures.length === 0;
      return {
        passed,
        taskType: 'file_verified',
        score: passed ? 1.0 : (failures.length === 1 ? 0.5 : 0.0),
        evidenceSummary: `File verified: ${filePath} (${stats.size} bytes).`,
        failureReasons: failures,
        repairPlan: failures.length > 0 ? `Re-write or fix contents of ${filePath}: ${failures.join('; ')}` : undefined
      };
    } catch (err: any) {
      return {
        passed: false,
        taskType: 'file_verified',
        score: 0.0,
        evidenceSummary: `File verification failed: ${err.message}`,
        failureReasons: [`File does not exist or cannot be read: ${filePath}`],
        repairPlan: `Ensure file ${filePath} is properly created and written to disk.`
      };
    }
  }

  private verifyPage(req: TaskVerificationRequest): Promise<TaskVerificationOutcome> {
    const failures: string[] = [];
    const elements = req.options?.domElements || [];
    const evidenceText = typeof req.evidence === 'string' ? req.evidence : JSON.stringify(req.evidence || '');

    if (!req.options?.url && !req.evidence) {
      failures.push('Missing URL or DOM evidence for page inspection.');
    }

    for (const el of elements) {
      const cleanEl = el.replace(/^[#.]/, '');
      const hasMatch = evidenceText.includes(el) || evidenceText.includes(cleanEl);
      if (!hasMatch) {
        failures.push(`Expected DOM element or selector "${el}" not found on inspected page.`);
      }
    }

    const passed = failures.length === 0;
    return Promise.resolve({
      passed,
      taskType: 'page_inspected',
      score: passed ? 1.0 : Math.max(0, 1.0 - failures.length * 0.3),
      evidenceSummary: `Page inspection on ${req.options?.url || 'target page'}: ${passed ? 'All required elements present' : `${failures.length} issues detected`}`,
      failureReasons: failures,
      repairPlan: failures.length > 0 ? `Wait for elements or navigate to proper view: ${failures.join(', ')}` : undefined
    });
  }

  private verifyTestBuild(req: TaskVerificationRequest): Promise<TaskVerificationOutcome> {
    const failures: string[] = [];
    const exitCode = req.options?.exitCode ?? (req.evidence?.exitCode ?? 0);
    const testResults = req.options?.testResults || req.evidence?.testResults;

    if (exitCode !== 0) {
      failures.push(`Test / Build process exited with non-zero exit code: ${exitCode}.`);
    }

    if (testResults && testResults.failed > 0) {
      failures.push(`${testResults.failed} automated tests failed.`);
    }

    const passed = failures.length === 0;
    return Promise.resolve({
      passed,
      taskType: 'test_build',
      score: passed ? 1.0 : 0.0,
      evidenceSummary: `Build test gate: exitCode=${exitCode}, tests=${testResults ? `${testResults.passed} passed, ${testResults.failed} failed` : 'ok'}`,
      failureReasons: failures,
      repairPlan: failures.length > 0 ? 'Fix failing test assertions and compilation errors before proceeding.' : undefined
    });
  }

  private verifySources(req: TaskVerificationRequest): Promise<TaskVerificationOutcome> {
    const failures: string[] = [];
    const minSources = req.options?.minSources || 1;
    const sources: any[] = Array.isArray(req.evidence) ? req.evidence : (req.evidence?.sources || []);

    if (sources.length < minSources) {
      failures.push(`Insufficient citation sources: found ${sources.length}, required at least ${minSources}.`);
    }

    // Verify citation structure
    for (const src of sources) {
      if (!src.url && !src.title) {
        failures.push('Citation found with missing title or URL.');
      }
    }

    const passed = failures.length === 0;
    return Promise.resolve({
      passed,
      taskType: 'sources_checked',
      score: passed ? 1.0 : Math.max(0, sources.length / minSources),
      evidenceSummary: `Source verification checked ${sources.length} citations.`,
      failureReasons: failures,
      repairPlan: failures.length > 0 ? 'Conduct additional search queries to gather required citations.' : undefined
    });
  }

  private verifyDelivery(req: TaskVerificationRequest): Promise<TaskVerificationOutcome> {
    const failures: string[] = [];
    const status = req.options?.channelStatus || req.evidence?.status || 'sent';

    if (status !== 'sent' && status !== 'delivered' && status !== 'ok') {
      failures.push(`Outbound message delivery reported status "${status}".`);
    }

    const passed = failures.length === 0;
    return Promise.resolve({
      passed,
      taskType: 'delivery_result',
      score: passed ? 1.0 : 0.0,
      evidenceSummary: `Channel delivery verification: status=${status}`,
      failureReasons: failures,
      repairPlan: failures.length > 0 ? 'Retry channel transmission or verify channel gateway connectivity.' : undefined
    });
  }

  private verifyResultingState(req: TaskVerificationRequest): Promise<TaskVerificationOutcome> {
    const failures: string[] = [];
    const expected = req.options?.expectedState || {};
    const current = req.options?.currentState || req.evidence || {};

    let totalKeys = 0;
    let matchedKeys = 0;

    for (const [key, expectedVal] of Object.entries(expected)) {
      totalKeys++;
      const currentVal = (current as any)[key];
      if (JSON.stringify(currentVal) !== JSON.stringify(expectedVal)) {
        failures.push(`State mismatch for key "${key}": expected ${JSON.stringify(expectedVal)}, got ${JSON.stringify(currentVal)}`);
      } else {
        matchedKeys++;
      }
    }

    const score = totalKeys === 0 ? 1.0 : matchedKeys / totalKeys;
    const passed = failures.length === 0;

    return Promise.resolve({
      passed,
      taskType: 'resulting_state',
      score,
      evidenceSummary: `State verification: ${matchedKeys}/${totalKeys} expected state properties confirmed.`,
      failureReasons: failures,
      repairPlan: failures.length > 0 ? `Apply state updates to match expected schema: ${failures.join('; ')}` : undefined
    });
  }
}
