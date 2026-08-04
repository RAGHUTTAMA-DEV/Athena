import { GoogleGenAI } from '@google/genai';
import { Langfuse } from 'langfuse';
import * as dotenv from 'dotenv';

dotenv.config();

// ANSI coloring codes for premium styling
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
  console.log('\n' + '='.repeat(60));
  console.log(`${COLORS.bright}${COLORS.fgMagenta} Langfuse LLM-as-a-Judge Evaluation Runner ${COLORS.reset}`);
  console.log('='.repeat(60) + '\n');

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

  console.log(`${COLORS.fgBlue}[System] Fetching recent traces from Langfuse...${COLORS.reset}`);
  
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

    // Convert inputs/outputs to readable strings if they are objects
    const inputStr = typeof rawInput === 'object' ? JSON.stringify(rawInput) : String(rawInput || '');
    const outputStr = typeof rawOutput === 'object' ? JSON.stringify(rawOutput) : String(rawOutput || '');

    if (!inputStr || !outputStr) {
      console.log(`${COLORS.fgYellow}Skipping trace: Input or output is empty.${COLORS.reset}\n`);
      continue;
    }

    console.log(`${COLORS.dim}User Prompt: "${inputStr.substring(0, 100)}${inputStr.length > 100 ? '...' : ''}"${COLORS.reset}`);
    console.log(`${COLORS.dim}Response:    "${outputStr.substring(0, 100)}${outputStr.length > 100 ? '...' : ''}"${COLORS.reset}`);

    // Call Gemini as the judge
    console.log(`${COLORS.fgBlue}Running Gemini LLM-as-a-Judge...${COLORS.reset}`);
    
    const judgePrompt = `You are an expert AI evaluator judging the quality of an agent's response to a user prompt.
Please analyze the prompt and response below and score them.

User Prompt:
${inputStr}

Agent Response:
${outputStr}

Evaluate based on two metrics:
1. "goalCompletion": Score 1 if the agent fully answered or resolved the user's request, score 0 if it failed or ignored it.
2. "clarity": Score 1 if the response is clear, helpful, and logical, score 0 if it is confusing, repetitive, or poorly formatted.

Return your evaluation ONLY in the following JSON format:
{
  "goalCompletion": 0 or 1,
  "clarity": 0 or 1,
  "reasoning": "Provide a 1-2 sentence concise explanation of your scores."
}
`;

    try {
      const judgeResponse = await ai.models.generateContent({
        model: process.env.GEMINI_EVAL_MODEL || 'gemini-2.5-flash',
        contents: judgePrompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const responseText = judgeResponse.text || '';
      const result = JSON.parse(responseText.trim());

      console.log(`${COLORS.bright}Judge Results:${COLORS.reset}`);
      console.log(`  - Goal Completion: ${result.goalCompletion === 1 ? COLORS.fgGreen + '1 (Pass)' : COLORS.fgRed + '0 (Fail)'}${COLORS.reset}`);
      console.log(`  - Clarity:         ${result.clarity === 1 ? COLORS.fgGreen + '1 (Pass)' : COLORS.fgRed + '0 (Fail)'}${COLORS.reset}`);
      console.log(`  - Reasoning:       ${COLORS.fgWhite}${result.reasoning}${COLORS.reset}`);

      // Push scores back to Langfuse
      console.log(`${COLORS.fgBlue}Uploading scores to Langfuse...${COLORS.reset}`);
      
      await langfuse.score({
        traceId: trace.id,
        name: 'goal-completion',
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

      console.log(`${COLORS.fgGreen}✓ Scores successfully uploaded.${COLORS.reset}\n`);
    } catch (judgeErr: any) {
      console.error(`${COLORS.fgRed}Error evaluating trace: ${judgeErr.message}${COLORS.reset}\n`);
    }
  }

  // Flush to make sure all scores are sent before exiting
  await langfuse.flushAsync();
  console.log(`${COLORS.bright}${COLORS.fgGreen}Evaluation runner finished successfully! 🎉${COLORS.reset}\n`);
}

runEvaluator().catch((err) => {
  console.error(`${COLORS.fgRed}Fatal Error: ${err.message}${COLORS.reset}`);
  process.exit(1);
});
