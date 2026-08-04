import { Tool, ToolContext } from '../core/types.js';
import { Agent } from '../core/agent.js';
import { DEFAULT_AGENT_PROMPT } from '../prompts/index.js';

export const delegateTaskTool: Tool = {
  definition: {
    name: 'delegate_task',
    description: 'Delegate a specific sub-task to an isolated sub-agent with a limited set of tools.',
    parameters: {
      type: 'OBJECT',
      properties: {
        goal: {
          type: 'STRING',
          description: 'The specific goal or problem the sub-agent must solve.'
        },
        context: {
          type: 'STRING',
          description: 'The required slice of context, data, or files the sub-agent needs.'
        },
        allowedTools: {
          type: 'ARRAY',
          items: {
            type: 'STRING'
          },
          description: 'A list of tool names that the sub-agent is authorized to use.'
        },
        maxTurns: {
          type: 'INTEGER',
          description: 'Optional maximum loop turns for the sub-agent (defaults to 10).'
        }
      },
      required: ['goal', 'context', 'allowedTools']
    }
  },
  execute: async (args: any, context?: ToolContext) => {
    const parentDepth = context?.depth || 0;
    const childDepth = parentDepth + 1;
    const taskId = `sub-agent-${Math.random().toString(36).substring(2, 7)}`;

    // Implement depth limiting by stripping delegate_task from allowedTools if child depth >= 3
    let allowedTools: string[] = Array.isArray(args.allowedTools) ? [...args.allowedTools] : [];
    if (childDepth >= 3) {
      allowedTools = allowedTools.filter(t => t !== 'delegate_task');
    }

    const parentPrompt = process.env.GEMINI_SYSTEM_PROMPT || DEFAULT_AGENT_PROMPT;
    const systemPrompt = `You are a specialized sub-agent (Task ID: ${taskId}) spawned to accomplish a specific goal.
Goal: ${args.goal}

Here is the relevant context for your task:
${args.context}

Operational Instructions:
${parentPrompt}

Crucial Sub-Agent Rules:
1. Be extremely concise, direct, and fast.
2. Do NOT perform excessive web browsing or crawl multiple pages one-by-one unless it is absolutely critical for the goal. Use search snippets directly if they answer the question.
3. Complete your task in as few turns as possible (aim for 2-4 turns maximum).
4. When you are done, output your final findings clearly and concisely. Do NOT ask for additional user confirmation. Focus on the sub-task.`;

    const childAgent = new Agent({
      modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxTurns: args.maxTurns || 10,
      systemPrompt,
      allowedTools,
      depth: childDepth,
      taskId
    });

    await childAgent.init();

    const parentConfirm = context?.confirm;
    const parentRunId = context?.parentRunId || 'parent';
    const childSessionId = `${parentRunId}_${taskId}`;

    // Forward updates to parent onUpdate callback if present
    const childOnUpdate = (status: any) => {
      if (context?.onUpdate) {
        context.onUpdate(status);
      }
    };

    try {
      // Execute the sub-agent. Empty history since we want context isolation.
      const summaryResult = await childAgent.run(
        `Please accomplish your goal and summarize the result.`,
        [],
        childOnUpdate,
        undefined, // Sub-agent runs autonomously without prompting for tool confirmation
        childSessionId
      );

      // Explicitly close database handle of sub-agent if initialized
      const childMemory = (childAgent as any).memory;
      if (childMemory) {
        await childMemory.close();
      }

      return {
        taskId,
        status: 'success',
        output: summaryResult
      };
    } catch (err: any) {
      // Make sure database handle is closed on failure too
      const childMemory = (childAgent as any).memory;
      if (childMemory) {
        try {
          await childMemory.close();
        } catch (e) {}
      }

      return {
        taskId,
        status: 'failed',
        output: `Sub-agent execution encountered an error: ${err.message}`,
        error: err.message
      };
    }
  }
};
