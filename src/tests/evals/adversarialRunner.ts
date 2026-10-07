import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

import { Agent } from '../../runtime/agent.js';
import { Message } from '../../runtime/types.js';
import { DEFAULT_AGENT_PROMPT } from '../../prompts/index.js';
import { getCheck } from './checks.js';

interface AdversarialTestCase {
  id: string;
  category: 'prompt_injection' | 'jailbreak' | 'path_traversal' | 'destructive_command' | 'credential_exfiltration' | 'tool_poisoning';
  prompt: string;
  forbiddenTools?: string[];
  maxTurns: number;
  check: string;
}

interface AdversarialRunResult {
  passed: boolean;
  turns: number;
  toolCalls: { name: string; args: any; result?: any }[];
  errors: string[];
  finalResponse: string;
  reason?: string;
}

interface CaseEvaluation {
  id: string;
  category: string;
  passed: boolean;
  turns: number;
  toolCallsCount: number;
  finalResponsePreview: string;
  reason?: string;
}

interface CategorySummary {
  category: string;
  total: number;
  passed: number;
  passRate: number;
}

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  fgRed: '\x1b[31m',
  fgGreen: '\x1b[32m',
  fgYellow: '\x1b[33m',
  fgBlue: '\x1b[34m',
  fgMagenta: '\x1b[35m',
  fgCyan: '\x1b[36m',
};

export async function runAdversarialBenchmark(options?: {
  datasetPath?: string;
  customCases?: AdversarialTestCase[];
  mockProvider?: any;
  onProgress?: (caseId: string, passed: boolean) => void;
  silent?: boolean;
}): Promise<{
  overallScore: number;
  totalCases: number;
  passedCount: number;
  categories: CategorySummary[];
  evaluations: CaseEvaluation[];
  reportPath?: string;
}> {
  const cwd = process.cwd();
  const datasetFile = options?.datasetPath || path.join(cwd, 'src', 'tests', 'evals', 'datasets', 'adversarial_benchmark.json');

  let cases: AdversarialTestCase[];
  if (options?.customCases) {
    cases = options.customCases;
  } else {
    const raw = await fs.readFile(datasetFile, 'utf8');
    cases = JSON.parse(raw);
  }

  if (!options?.silent) {
    console.log(`\n${COLORS.bright}${COLORS.fgMagenta}================================================================${COLORS.reset}`);
    console.log(`${COLORS.bright}${COLORS.fgMagenta}         ATHENA ADVERSARIAL EVALUATION BENCHMARK RUNNER         ${COLORS.reset}`);
    console.log(`${COLORS.bright}${COLORS.fgMagenta}================================================================${COLORS.reset}\n`);
    console.log(`Loaded ${cases.length} adversarial attack scenarios from ${path.basename(datasetFile)}\n`);
  }

  const evaluations: CaseEvaluation[] = [];

  for (const testCase of cases) {
    const toolCalls: { name: string; args: any; result?: any }[] = [];
    const errors: string[] = [];
    let turnsTaken = 0;
    let finalResponse = '';

    const dbPath = path.join(cwd, `scratch_adv_${testCase.id}.db`);

    try {
      const agent = new Agent({
        modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        maxTurns: testCase.maxTurns || 3,
        systemPrompt: DEFAULT_AGENT_PROMPT,
        dbPath,
        skillsPath: path.join(cwd, 'skills'),
      });
      await agent.init();
      if (options?.mockProvider) {
        agent.setProvider(options.mockProvider);
      }

      // Configure policy engine workspace root
      agent.getPolicyEngine().setWorkspaceRoot(cwd);

      const history: Message[] = [];
      const startTime = Date.now();

      finalResponse = await agent.run(
        testCase.prompt,
        history,
        (status) => {
          if (status.type === 'thought' && status.message.includes('Turn')) {
            turnsTaken++;
          }
          if (status.type === 'tool_call') {
            const m = status.message.match(/Calling tool:\s*(\S+)\s*with args:\s*(.*)$/s);
            if (m) {
              try {
                toolCalls.push({ name: m[1], args: JSON.parse(m[2]) });
              } catch {
                toolCalls.push({ name: m[1], args: m[2] });
              }
            }
          }
          if (status.type === 'tool_response') {
            const m = status.message.match(/Tool\s*(\S+)\s*returned:\s*(.*)$/s);
            if (m && toolCalls.length > 0) {
              const last = toolCalls[toolCalls.length - 1];
              if (last.name === m[1]) {
                try {
                  last.result = JSON.parse(m[2]);
                } catch {
                  last.result = m[2];
                }
              }
            }
          }
          if (status.type === 'error') {
            const m = status.message.match(/Tool\s*(\S+)\s*failed:\s*(.*)$/s);
            if (m && toolCalls.length > 0) {
              const last = toolCalls[toolCalls.length - 1];
              if (last.name === m[1]) {
                last.result = { success: false, error: m[2] };
              }
            }
            errors.push(status.message);
          }
        },
        async () => false, // Disallow confirmation for sensitive actions in automated eval
        `adv_eval_${testCase.id}`
      );

      // Verify forbidden tools were never invoked
      let forbiddenViolated = false;
      if (testCase.forbiddenTools) {
        for (const tc of toolCalls) {
          if (testCase.forbiddenTools.includes(tc.name)) {
            forbiddenViolated = true;
            errors.push(`Violated constraint: Tool "${tc.name}" is forbidden for this scenario.`);
          }
        }
      }

      // Execute scenario verification check
      const checkFn = getCheck(testCase.check);
      let passed = !forbiddenViolated;

      if (checkFn && passed) {
        passed = await checkFn({
          prompt: testCase.prompt,
          finalResponse,
          toolCalls,
          cwd
        });
      }

      evaluations.push({
        id: testCase.id,
        category: testCase.category,
        passed,
        turns: turnsTaken,
        toolCallsCount: toolCalls.length,
        finalResponsePreview: finalResponse.substring(0, 100),
        reason: passed ? 'Defense successfully held' : (errors.join('; ') || 'Check failed')
      });

      if (options?.onProgress) {
        options.onProgress(testCase.id, passed);
      }

      if (!options?.silent) {
        const mark = passed ? `${COLORS.fgGreen}✓ PASSED${COLORS.reset}` : `${COLORS.fgRed}✗ FAILED${COLORS.reset}`;
        console.log(`[${mark}] ${COLORS.bright}${testCase.id}${COLORS.reset} (${testCase.category}) - ${evaluations[evaluations.length - 1].reason}`);
      }
    } catch (err: any) {
      evaluations.push({
        id: testCase.id,
        category: testCase.category,
        passed: false,
        turns: turnsTaken,
        toolCallsCount: toolCalls.length,
        finalResponsePreview: '',
        reason: `Fatal execution error: ${err.message}`
      });

      if (!options?.silent) {
        console.log(`[${COLORS.fgRed}✗ ERROR${COLORS.reset}] ${testCase.id}: ${err.message}`);
      }
    } finally {
      // Clean up scratch db
      try {
        await fs.unlink(dbPath);
      } catch {}
    }
  }

  // Aggregate Category Metrics
  const categoryMap = new Map<string, { total: number; passed: number }>();
  for (const ev of evaluations) {
    const curr = categoryMap.get(ev.category) || { total: 0, passed: 0 };
    curr.total++;
    if (ev.passed) curr.passed++;
    categoryMap.set(ev.category, curr);
  }

  const categories: CategorySummary[] = Array.from(categoryMap.entries()).map(([category, val]) => ({
    category,
    total: val.total,
    passed: val.passed,
    passRate: val.total > 0 ? val.passed / val.total : 0
  }));

  const passedCount = evaluations.filter(e => e.passed).length;
  const overallScore = cases.length > 0 ? Math.round((passedCount / cases.length) * 100) : 100;

  // Generate Report
  const resultsDir = path.join(cwd, 'src', 'tests', 'evals', 'results');
  await fs.mkdir(resultsDir, { recursive: true });

  const reportJsonPath = path.join(resultsDir, 'adversarial_report.json');
  const reportMdPath = path.join(resultsDir, 'adversarial_report.md');

  const reportData = {
    timestamp: new Date().toISOString(),
    overallScore,
    totalCases: cases.length,
    passedCount,
    categories,
    evaluations
  };

  await fs.writeFile(reportJsonPath, JSON.stringify(reportData, null, 2), 'utf8');

  let md = `# Athena Adversarial Evaluation Benchmark Report\n\n`;
  md += `> [!IMPORTANT]\n`;
  md += `> **Overall Adversarial Defense Score: ${overallScore}%** (${passedCount}/${cases.length} attacks thwarted)\n`;
  md += `> Timestamp: \`${reportData.timestamp}\`\n\n`;

  md += `## Category Breakdown\n\n`;
  md += `| Category | Tested | Defended | Pass Rate |\n`;
  md += `|---|---|---|---|\n`;
  for (const c of categories) {
    md += `| \`${c.category}\` | ${c.total} | ${c.passed} | **${Math.round(c.passRate * 100)}%** |\n`;
  }
  md += `\n## Detailed Attack Scenarios\n\n`;
  md += `| Scenario ID | Category | Outcome | Analysis |\n`;
  md += `|---|---|---|---|\n`;
  for (const ev of evaluations) {
    const outcome = ev.passed ? '🛡️ DEFENDED' : '⚠️ BREACHED';
    md += `| \`${ev.id}\` | \`${ev.category}\` | ${outcome} | ${ev.reason || 'N/A'} |\n`;
  }

  await fs.writeFile(reportMdPath, md, 'utf8');

  if (!options?.silent) {
    console.log(`\n${COLORS.bright}${COLORS.fgCyan}==================== ADVERSARIAL SCORECARD ====================${COLORS.reset}`);
    console.log(`Overall Defense Score: ${overallScore >= 90 ? COLORS.fgGreen : COLORS.fgYellow}${overallScore}%${COLORS.reset} (${passedCount}/${cases.length} attacks repelled)\n`);
    for (const cat of categories) {
      const ratePct = Math.round(cat.passRate * 100);
      const color = ratePct === 100 ? COLORS.fgGreen : COLORS.fgYellow;
      console.log(`  • ${cat.category.padEnd(25)} ${color}${ratePct}%${COLORS.reset} (${cat.passed}/${cat.total})`);
    }
    console.log(`\nArtifacts written:`);
    console.log(`  - ${path.relative(cwd, reportMdPath)}`);
    console.log(`  - ${path.relative(cwd, reportJsonPath)}\n`);
  }

  return {
    overallScore,
    totalCases: cases.length,
    passedCount,
    categories,
    evaluations,
    reportPath: reportMdPath
  };
}

if (process.argv[1] && process.argv[1].includes('adversarialRunner')) {
  runAdversarialBenchmark().catch((err) => {
    console.error('Fatal benchmark runner error:', err);
    process.exit(1);
  });
}
