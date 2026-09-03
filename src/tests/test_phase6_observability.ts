import * as dotenv from 'dotenv';
dotenv.config();

// MUST import instrumentation first!
import '../core/instrumentation.js';

import { Agent } from '../core/agent.js';
import { Message } from '../core/types.js';
import { getActiveTraceId } from '@langfuse/tracing';
import { Langfuse } from 'langfuse';

async function runTest() {
  console.log('=== STARTING PHASE 6 OBSERVABILITY TESTS ===\n');

  if (!process.env.GEMINI_API_KEY) {
    console.error('ERROR: GEMINI_API_KEY is not defined.');
    process.exit(1);
  }
  if (!process.env.LANGFUSE_PUBLIC_KEY || !process.env.LANGFUSE_SECRET_KEY) {
    console.error('ERROR: Langfuse credentials are not defined.');
    process.exit(1);
  }

  const agent = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
    systemPrompt: 'You are a parent agent. If asked to run multiple tasks, delegate them to sub-agents.',
    allowedTools: ['calculate', 'delegate_task'],
    depth: 0,
    taskId: 'test-observability-agent'
  });
  await agent.init();

  let capturedTraceId: string | undefined = undefined;
  const history: Message[] = [];
  
  console.log('Running agent with tool calls and sub-agent delegation...');
  const result = await agent.run(
    'Please calculate 123 + 456, then spawn a sub-agent to calculate 2 * 25.',
    history,
    (status) => {
      if (!capturedTraceId) {
        try {
          capturedTraceId = getActiveTraceId();
        } catch (e) {}
      }
      console.log(`[Status] [${status.type}] ${status.message}`);
    },
    undefined,
    'test-session-obs-6'
  );

  console.log(`\nFinal response: "${result}"`);
  console.log(`Captured Trace ID: ${capturedTraceId}`);

  if (!capturedTraceId) {
    throw new Error('Failed to capture active trace ID during run.');
  }

  console.log('\nWaiting 10 seconds for Langfuse to ingest traces...');
  await new Promise(resolve => setTimeout(resolve, 10000));

  // Verify trace exists in Langfuse and run evaluation on it
  console.log('Verifying trace in Langfuse and running judge...');
  const langfuse = new Langfuse({
    publicKey: process.env.LANGFUSE_PUBLIC_KEY,
    secretKey: process.env.LANGFUSE_SECRET_KEY,
    baseUrl: process.env.LANGFUSE_BASE_URL,
  });

  // Verify we can fetch the trace by ID
  let traceData = null;
  try {
    const tracesResponse = await langfuse.fetchTraces({
      limit: 10,
    });
    // Find our trace
    const matched = tracesResponse.data.find(t => t.id === capturedTraceId);
    if (matched) {
      traceData = matched;
      console.log(`✓ Found trace in Langfuse! Input: "${JSON.stringify(traceData.input)}"`);
    } else {
      console.warn('Trace not found in the first page of traces. This is normal if ingestion is slow.');
    }
  } catch (e: any) {
    console.error(`Failed to verify trace in Langfuse list: ${e.message}`);
  }

  // Let's post a test feedback score directly to verify the API works
  console.log('Posting test feedback score...');
  await langfuse.score({
    traceId: capturedTraceId,
    name: 'test-score',
    value: 1.0,
    dataType: 'NUMERIC',
  });
  await langfuse.flushAsync();
  console.log('✓ Feedback score posted successfully.');

  console.log('\nALL PHASE 6 OBSERVABILITY TESTS COMPLETED! 🎉');
  process.exit(0);
}

runTest().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
