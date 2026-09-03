import * as fs from 'fs/promises';
import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

import { Agent } from '../../core/agent.js';
import { Message } from '../../core/types.js';
import { DEFAULT_AGENT_PROMPT } from '../../prompts/index.js';
import { getCheck } from './checks.js';

interface TestCase {
  id: string;
  category: 'coding' | 'delegation' | 'memory' | 'search';
  prompt: string;
  requiredTools?: string[];
  forbiddenTools?: string[];
  maxTurns: number;
  maxToolCalls?: Record<string, number>;
  check?: string;
  expectedContains?: string;
}

interface RunResult {
  runIndex: number;
  passed: boolean;
  turns: number;
  toolCalls: { name: string; args: any; result?: any }[];
  errors: string[];
  finalResponse: string;
}

interface CaseEvaluation {
  id: string;
  category: string;
  runs: RunResult[];
  passRate: number; // 0.0 to 1.0
  passedCount: number;
  totalRuns: number;
}

interface CategoryResult {
  category: string;
  totalCases: number;
  avgPassRate: number; // 0.0 to 1.0
  baselinePassRate?: number;
  delta?: number;
}

interface BaselineReport {
  timestamp: string;
  categories: Record<string, number>; // category -> avgPassRate
  cases: Record<string, number>; // caseId -> passRate
}

// ANSI formatting for terminal outputs
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
  fgWhite: '\x1b[37m',
};

async function parseArgs() {
  const args = process.argv.slice(2);
  let runs = 3;
  for (const arg of args) {
    if (arg.startsWith('--runs=')) {
      const parsed = parseInt(arg.split('=')[1], 10);
      if (!isNaN(parsed) && parsed > 0) runs = parsed;
    }
  }
  return { runs };
}

async function runTestCase(testCase: TestCase, runIndex: number, cwd: string): Promise<RunResult> {
  const errors: string[] = [];
  const toolCallsExecuted: { name: string; args: any; result?: any }[] = [];
  let turnsTaken = 0;
  let finalResponse = '';

  const dbPath = path.join(cwd, `scratch_eval_${testCase.id}_${runIndex}.db`);

  try {
    const agent = new Agent({
      modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxTurns: testCase.maxTurns || 10,
      systemPrompt: DEFAULT_AGENT_PROMPT,
      soulPath: path.join(cwd, 'SOUL.md'),
      dbPath,
      skillsPath: path.join(cwd, 'skills'),
    });
    await agent.init();

    const sessionId = `eval_session_${testCase.id}_${runIndex}`;
    const history: Message[] = [];

    finalResponse = await agent.run(
      testCase.prompt,
      history,
      (status) => {
        if (status.type === 'tool_call') {
          turnsTaken++;
          const match = status.message.match(/Executing tool:\s*(\w+)/i) || status.message.match(/(\w+)/);
          const toolName = match ? match[1] : status.message;
          toolCallsExecuted.push({ name: toolName, args: {} });
        }
      },
      async () => true, // Mock auto confirmation
      sessionId
    );

    // If turnsTaken was 0 (no tool call was made), count as 1 turn
    if (turnsTaken === 0) turnsTaken = 1;
  } catch (err: any) {
    errors.push(`Execution exception: ${err.message}`);
  } finally {
    try {
      await fs.unlink(dbPath);
    } catch {}
  }

  // Assertion 1: Trajectory Efficiency (maxTurns)
  if (turnsTaken > testCase.maxTurns && testCase.maxTurns > 0) {
    errors.push(`Turn limit exceeded: took ${turnsTaken} turns, max allowed is ${testCase.maxTurns}`);
  }

  // Assertion 2: Required Tools
  if (testCase.requiredTools && testCase.requiredTools.length > 0) {
    for (const reqTool of testCase.requiredTools) {
      const called = toolCallsExecuted.some((c) => c.name.toLowerCase() === reqTool.toLowerCase());
      if (!called) {
        errors.push(`Required tool not invoked: '${reqTool}'`);
      }
    }
  }

  // Assertion 3: Forbidden Tools
  if (testCase.forbiddenTools && testCase.forbiddenTools.length > 0) {
    for (const forbTool of testCase.forbiddenTools) {
      const called = toolCallsExecuted.some((c) => c.name.toLowerCase() === forbTool.toLowerCase());
      if (called) {
        errors.push(`Forbidden tool was invoked: '${forbTool}'`);
      }
    }
  }

  // Assertion 4: Max Tool Calls Cap
  if (testCase.maxToolCalls) {
    for (const [toolName, maxCap] of Object.entries(testCase.maxToolCalls)) {
      const callCount = toolCallsExecuted.filter((c) => c.name.toLowerCase() === toolName.toLowerCase()).length;
      if (callCount > maxCap) {
        errors.push(`Tool '${toolName}' call limit exceeded: called ${callCount} times, max allowed is ${maxCap}`);
      }
    }
  }

  // Assertion 5: Check Function vs ExpectedContains
  if (testCase.check) {
    const checkFn = getCheck(testCase.check);
    if (checkFn) {
      const checkPassed = await checkFn({
        prompt: testCase.prompt,
        finalResponse,
        toolCalls: toolCallsExecuted,
        cwd,
      });
      if (!checkPassed) {
        errors.push(`Side-effect check '${testCase.check}' failed`);
      }
    } else {
      errors.push(`Check function '${testCase.check}' not registered in checkRegistry`);
    }
  } else if (testCase.expectedContains) {
    const regex = new RegExp(testCase.expectedContains, 'i');
    if (!regex.test(finalResponse)) {
      errors.push(`Output assertion failed: expected to contain pattern '${testCase.expectedContains}'`);
    }
  }

  const passed = errors.length === 0;
  return {
    runIndex,
    passed,
    turns: turnsTaken,
    toolCalls: toolCallsExecuted,
    errors,
    finalResponse,
  };
}

async function main() {
  const { runs } = await parseArgs();
  const cwd = process.cwd();

  console.log('\n' + '='.repeat(70));
  console.log(`${COLORS.bright}${COLORS.fgMagenta} ATHENA BENCHMARK EVALUATION SUITE ${COLORS.reset}`);
  console.log(`${COLORS.dim} Running N=${runs} evaluation runs per test case ${COLORS.reset}`);
  console.log('='.repeat(70) + '\n');

  const datasetPath = path.join(cwd, 'src', 'tests', 'evals', 'datasets', 'benchmark.json');
  const resultsDir = path.join(cwd, 'src', 'tests', 'evals', 'results');
  const latestPath = path.join(resultsDir, 'latest.json');

  await fs.mkdir(resultsDir, { recursive: true });

  let dataset: TestCase[] = [];
  try {
    const content = await fs.readFile(datasetPath, 'utf-8');
    dataset = JSON.parse(content);
  } catch (err: any) {
    console.error(`${COLORS.fgRed}Failed to load benchmark dataset: ${err.message}${COLORS.reset}`);
    process.exit(1);
  }

  // Load previous baseline if present
  let baseline: BaselineReport | null = null;
  try {
    const baselineContent = await fs.readFile(latestPath, 'utf-8');
    baseline = JSON.parse(baselineContent);
    console.log(`${COLORS.fgBlue}[Baseline] Loaded previous baseline from latest.json (${baseline?.timestamp})${COLORS.reset}\n`);
  } catch {
    console.log(`${COLORS.fgYellow}[Baseline] No previous latest.json baseline found. Initializing new baseline.${COLORS.reset}\n`);
  }

  const caseEvaluations: CaseEvaluation[] = [];

  for (const testCase of dataset) {
    process.stdout.write(`Evaluating [${testCase.category.toUpperCase()}] ${testCase.id}... `);
    const runResults: RunResult[] = [];

    for (let r = 1; r <= runs; r++) {
      const res = await runTestCase(testCase, r, cwd);
      runResults.push(res);
    }

    const passedCount = runResults.filter((r) => r.passed).length;
    const passRate = passedCount / runs;

    caseEvaluations.push({
      id: testCase.id,
      category: testCase.category,
      runs: runResults,
      passRate,
      passedCount,
      totalRuns: runs,
    });

    const statusColor = passRate === 1 ? COLORS.fgGreen : passRate > 0 ? COLORS.fgYellow : COLORS.fgRed;
    console.log(`${statusColor}${passedCount}/${runs} Passed (${(passRate * 100).toFixed(0)}%)${COLORS.reset}`);
  }

  // Aggregate results per category
  const categories = Array.from(new Set(dataset.map((c) => c.category)));
  const categoryResults: CategoryResult[] = [];
  const currentCategoryMap: Record<string, number> = {};
  const currentCaseMap: Record<string, number> = {};

  const flippedCases: string[] = [];

  for (const cat of categories) {
    const catCases = caseEvaluations.filter((c) => c.category === cat);
    const totalCases = catCases.length;
    const avgPassRate = catCases.reduce((sum, c) => sum + c.passRate, 0) / totalCases;

    currentCategoryMap[cat] = avgPassRate;

    for (const c of catCases) {
      currentCaseMap[c.id] = c.passRate;
      if (baseline && baseline.cases && baseline.cases[c.id] !== undefined) {
        const prevPass = baseline.cases[c.id];
        if (prevPass > 0.5 && c.passRate <= 0.5) {
          flippedCases.push(`${c.id} (${(prevPass * 100).toFixed(0)}% -> ${(c.passRate * 100).toFixed(0)}%)`);
        }
      }
    }

    let baselinePassRate: number | undefined = undefined;
    let delta: number | undefined = undefined;

    if (baseline && baseline.categories && baseline.categories[cat] !== undefined) {
      baselinePassRate = baseline.categories[cat];
      delta = avgPassRate - baselinePassRate;
    }

    categoryResults.push({
      category: cat,
      totalCases,
      avgPassRate,
      baselinePassRate,
      delta,
    });
  }

  // Print Summary Table
  console.log('\n' + '='.repeat(70));
  console.log(`${COLORS.bright} EVALUATION SUMMARY REPORT ${COLORS.reset}`);
  console.log('='.repeat(70));
  console.log(
    `${'Category'.padEnd(15)} | ${'Cases'.padEnd(6)} | ${'Current'.padEnd(9)} | ${'Baseline'.padEnd(9)} | ${'Delta'.padEnd(8)}`
  );
  console.log('-'.repeat(70));

  let regressionDetected = false;

  for (const catRes of categoryResults) {
    const curStr = `${(catRes.avgPassRate * 100).toFixed(1)}%`;
    const baseStr = catRes.baselinePassRate !== undefined ? `${(catRes.baselinePassRate * 100).toFixed(1)}%` : 'N/A';
    let deltaStr = 'N/A';

    if (catRes.delta !== undefined) {
      const deltaVal = (catRes.delta * 100).toFixed(1);
      if (catRes.delta < -0.001) {
        deltaStr = `${COLORS.fgRed}${deltaVal}%${COLORS.reset}`;
        regressionDetected = true;
      } else if (catRes.delta > 0.001) {
        deltaStr = `${COLORS.fgGreen}+${deltaVal}%${COLORS.reset}`;
      } else {
        deltaStr = `0.0%`;
      }
    }

    console.log(
      `${catRes.category.padEnd(15)} | ${String(catRes.totalCases).padEnd(6)} | ${curStr.padEnd(9)} | ${baseStr.padEnd(
        9
      )} | ${deltaStr}`
    );
  }

  console.log('='.repeat(70));

  if (flippedCases.length > 0) {
    console.log(`\n${COLORS.bright}${COLORS.fgRed}FLIPPED TEST CASES (Pass -> Fail):${COLORS.reset}`);
    for (const fc of flippedCases) {
      console.log(` - ${fc}`);
    }
  }

  // Save new baseline to latest.json
  const newBaseline: BaselineReport = {
    timestamp: new Date().toISOString(),
    categories: currentCategoryMap,
    cases: currentCaseMap,
  };

  await fs.writeFile(latestPath, JSON.stringify(newBaseline, null, 2), 'utf-8');
  console.log(`\n${COLORS.fgGreen}✓ Results successfully saved to ${latestPath}${COLORS.reset}`);

  if (regressionDetected) {
    console.error(`\n${COLORS.bright}${COLORS.fgRed}❌ REGRESSION DETECTED: One or more categories dropped vs baseline!${COLORS.reset}\n`);
    process.exit(1);
  } else {
    console.log(`\n${COLORS.bright}${COLORS.fgGreen}🎉 All benchmark evaluations completed cleanly!${COLORS.reset}\n`);
    process.exit(0);
  }
}

main().catch((err) => {
  console.error(`${COLORS.fgRed}Fatal Benchmark Error: ${err.message}${COLORS.reset}`);
  process.exit(1);
});
