import { GoogleGenAI } from '@google/genai';
import { Langfuse } from 'langfuse';
import * as dotenv from 'dotenv';

dotenv.config();

// ANSI coloring codes for premium terminal styling
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

async function runEvaluator() {
  console.log('\n' + '='.repeat(65));
  console.log(`${COLORS.bright}${COLORS.fgMagenta} Langfuse LLM-as-a-Judge Multi-Metric Evaluator Runner ${COLORS.reset}`);
  console.log('='.repeat(65) + '\n');

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error(`${COLORS.fgRed}ERROR: GEMINI_API_KEY is not defined in environment variables.${COLORS.reset}`);
    process.exit(1);
  }

  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.error(`${COLORS.fgRed}ERROR: Langfuse API keys are not defined in environment variables.${COLORS.reset}`);
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });

  console.log(`${COLORS.fgBlue}[System] Fetching recent production traces from Langfuse...${COLORS.reset}`);

  let tracesResponse;
  try {
    tracesResponse = await langfuse.fetchTraces({
      limit: 10,
    });
  } catch (err: any) {
    console.error(`${COLORS.fgRed}Failed to fetch traces from Langfuse: ${err.message}${COLORS.reset}`);
    process.exit(1);
  }

  const traces = tracesResponse.data;
  console.log(`${COLORS.fgGreen}[System] Retrieved ${traces.length} traces.${COLORS.reset}\n`);

  for (const trace of traces) {
    console.log(`${COLORS.bright}Evaluating Trace ID:${COLORS.reset} ${COLORS.fgCyan}${trace.id}${COLORS.reset}`);
    console.log(`${COLORS.bright}Trace Name:${COLORS.reset} ${trace.name}`);

    const rawInput = trace.input;
    const rawOutput = trace.output;

    const inputStr = typeof rawInput === 'object' ? JSON.stringify(rawInput) : String(rawInput || '');
    const outputStr = typeof rawOutput === 'object' ? JSON.stringify(rawOutput) : String(rawOutput || '');

    if (!inputStr || !outputStr) {
      console.log(`${COLORS.fgYellow}Skipping trace: Input or output is empty.${COLORS.reset}\n`);
      continue;
    }

    console.log(`${COLORS.dim}User Prompt: "${inputStr.substring(0, 100)}${inputStr.length > 100 ? '...' : ''}"${COLORS.reset}`);
    console.log(`${COLORS.dim}Response:    "${outputStr.substring(0, 100)}${outputStr.length > 100 ? '...' : ''}"${COLORS.reset}`);

    // Call Gemini as the LLM Judge scoring 4 binary metrics
    console.log(`${COLORS.fgBlue}Running Gemini LLM-as-a-Judge multi-metric scoring...${COLORS.reset}`);

    const judgePrompt = `You are an expert AI agent evaluator judging the quality and safety of an agent execution trace.
Analyze the user prompt and agent response below.

User Prompt:
${inputStr}

Agent Response / Execution:
${outputStr}

Score the execution on FOUR binary (0 or 1) metrics:
1. "goalCompletion": 1 if the agent fully achieved or resolved the user's actual goal, 0 if it failed, gave up, or ignored key requirements.
2. "clarity": 1 if the final response is clear, helpful, well-structured, and appropriately scoped, 0 if confusing, repetitive, or poorly formatted.
3. "groundedness": 1 if every claim or data point in the final answer is backed by factual tool execution results or general truths without hallucination, 0 if it contains fabricated data.
4. "trajectoryEfficiency": 1 if the agent solved the task efficiently without redundant tool loops, duplicate queries, or unnecessary turns, 0 if it suffered from repeating loops or over-tooling.

Return your evaluation strictly in JSON format:
{
  "goalCompletion": 0 or 1,
  "clarity": 0 or 1,
  "groundedness": 0 or 1,
  "trajectoryEfficiency": 0 or 1,
  "reasoning": "Provide a concise 1-2 sentence explanation of your scores."
}
`;

    try {
      const judgeResponse = await ai.models.generateContent({
        model: process.env.GEMINI_EVAL_MODEL || 'gemini-2.5-flash',
        contents: judgePrompt,
        config: {
          responseMimeType: 'application/json',
        },
      });

      const responseText = judgeResponse.text || '';
      const result = JSON.parse(responseText.trim());

      console.log(`${COLORS.bright}Judge Score Summary:${COLORS.reset}`);
      console.log(`  - Goal Completion:       ${result.goalCompletion === 1 ? COLORS.fgGreen + '1 (Pass)' : COLORS.fgRed + '0 (Fail)'}${COLORS.reset}`);
      console.log(`  - Clarity:               ${result.clarity === 1 ? COLORS.fgGreen + '1 (Pass)' : COLORS.fgRed + '0 (Fail)'}${COLORS.reset}`);
      console.log(`  - Groundedness:          ${result.groundedness === 1 ? COLORS.fgGreen + '1 (Pass)' : COLORS.fgRed + '0 (Fail)'}${COLORS.reset}`);
      console.log(`  - Trajectory Efficiency: ${result.trajectoryEfficiency === 1 ? COLORS.fgGreen + '1 (Pass)' : COLORS.fgRed + '0 (Fail)'}${COLORS.reset}`);
      console.log(`  - Reasoning:             ${COLORS.fgWhite}${result.reasoning}${COLORS.reset}`);

      // Push 4 binary scores to Langfuse
      console.log(`${COLORS.fgBlue}Uploading 4 scores to Langfuse...${COLORS.reset}`);

      await langfuse.score({
        traceId: trace.id,
        name: 'goalCompletion',
        value: result.goalCompletion,
        dataType: 'NUMERIC',
      });

      await langfuse.score({
        traceId: trace.id,
        name: 'clarity',
        value: result.clarity,
        dataType: 'NUMERIC',
        comment: result.reasoning,
      });

      await langfuse.score({
        traceId: trace.id,
        name: 'groundedness',
        value: result.groundedness,
        dataType: 'NUMERIC',
      });

      await langfuse.score({
        traceId: trace.id,
        name: 'trajectoryEfficiency',
        value: result.trajectoryEfficiency,
        dataType: 'NUMERIC',
      });

      console.log(`${COLORS.fgGreen}✓ All 4 scores successfully uploaded to Langfuse.${COLORS.reset}\n`);
    } catch (judgeErr: any) {
      console.error(`${COLORS.fgRed}Error evaluating trace ${trace.id}: ${judgeErr.message}${COLORS.reset}\n`);
    }
  }

  await langfuse.flushAsync();
  console.log(`${COLORS.bright}${COLORS.fgGreen}Multi-Metric LLM-as-a-Judge Evaluation completed! 🎉${COLORS.reset}\n`);
}

runEvaluator().catch((err) => {
  console.error(`${COLORS.fgRed}Fatal Error in Evaluator: ${err.message}${COLORS.reset}`);
  process.exit(1);
});
