import { Tool, ToolContext } from '../runtime/types.js';
import { DEFAULT_AGENT_PROMPT } from '../prompts/index.js';
import { DelegationContractEngine } from '../multiagent/delegationContract.js';
import { getSpecializedProfile } from '../multiagent/specializedProfiles.js';
import { SpecializedRole } from '../multiagent/types.js';

const delegationEngine = new DelegationContractEngine();

export const agentDelegateTool: Tool = {
  definition: {
    name: 'agentDelegate',
    description: 'Delegate a specialized task to a targeted sub-agent profile (Researcher, Coder, Reviewer, Planner, Browser, Data) with strict tool scoping, depth limit, and bounded lifetime.',
    parameters: {
      type: 'OBJECT',
      properties: {
        role: {
          type: 'STRING',
          description: 'Specialized profile role: "researcher", "coder", "reviewer", "planner", "browser", or "data".'
        },
        task: {
          type: 'STRING',
          description: 'Clear, explicit task description for the specialized sub-agent.'
        },
        context: {
          type: 'STRING',
          description: 'Bounded slice of context, findings, or file references needed for the task.'
        },
        allowedTools: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional explicit list of tool names authorized for this sub-agent run.'
        },
        maxTurns: {
          type: 'INTEGER',
          description: 'Maximum turns for the sub-agent loop (defaults to 10, capped at 20).'
        },
        goalId: {
          type: 'STRING',
          description: 'Optional parent goal ID.'
        },
        taskId: {
          type: 'STRING',
          description: 'Optional parent task ID.'
        },
        outputFormat: {
          type: 'STRING',
          description: 'Expected output format: "summary", "artifact", "json", or "structured".'
        }
      },
      required: ['role', 'task', 'context']
    }
  },
  execute: async (args: any, context?: ToolContext) => {
    const parentDepth = context?.depth || 0;
    const childDepth = parentDepth + 1;
    const goalId = args.goalId || context?.parentRunId || 'default_goal';

    const contract = delegationEngine.createContract({
      parentAgentId: context?.runId || 'primary_agent',
      targetRole: args.role,
      taskDescription: args.task,
      scopedContext: args.context,
      allowedTools: args.allowedTools,
      goalId,
      taskId: args.taskId,
      maxTurns: args.maxTurns,
      outputFormat: args.outputFormat
    });

    const activeCount = delegationEngine.getActiveCount(goalId);
    const validation = delegationEngine.validateContract(contract, parentDepth, activeCount);

    if (!validation.valid) {
      return {
        success: false,
        contractId: contract.contractId,
        errors: validation.errors,
        error: `Delegation rejected: ${validation.errors.join('; ')}`
      };
    }

    delegationEngine.registerActiveSubagent(goalId);

    const subagentTaskId = `sub_${contract.targetRole}_${Math.random().toString(36).substring(2, 7)}`;
    const profile = getSpecializedProfile(contract.targetRole as SpecializedRole);

    const systemPrompt = `You are a specialized sub-agent with role: ${profile.role} (Profile: ${profile.name}).
Identity: ${profile.identity}

Specialized Guidelines:
${profile.personality}

Task Description:
${contract.taskDescription}

Provided Context:
${contract.scopedContext}

Output Contract:
Deliver your final result in "${contract.outputContract.format}" format.
Crucial Rules:
1. Stay strictly within your assigned role and allowed tools.
2. Complete the task in as few turns as possible (max ${contract.boundedLifetime.maxTurns} turns).
3. Do not ask for user confirmation; summarize your findings directly.`;

    const childProvider = context?.provider || (process.env.LLM_PROVIDER as any) || 'gemini';
    const defaultModel = childProvider === 'nvidia'
      ? (process.env.NVIDIA_MODEL || 'z-ai/glm-5.2')
      : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');
    const childModelName = context?.modelName || defaultModel;

    const { Agent } = await import('../runtime/agent.js');
    const parentMemory = context?.memory;
    const childAgent = new Agent({
      provider: childProvider,
      modelName: childModelName,
      maxTurns: contract.boundedLifetime.maxTurns,
      systemPrompt,
      allowedTools: contract.allowedTools,
      depth: childDepth,
      taskId: subagentTaskId,
      memory: parentMemory,
      dbPath: !parentMemory ? (process.env.DATABASE_PATH || './state.db') : undefined,
      nvidiaApiKey: context?.nvidiaApiKey,
      nvidiaBaseUrl: context?.nvidiaBaseUrl
    });

    await childAgent.init();

    try {
      const result = await childAgent.run(
        `Execute your specialized task: "${contract.taskDescription}" and return the structured result.`,
        [],
        {
          runId: subagentTaskId,
          parentRunId: context?.runId,
          sessionId: `${context?.runId || 'parent'}_${subagentTaskId}`,
          cancellationToken: context?.cancellationToken,
          events: context?.events
        }
      );

      if (!parentMemory) {
        const childMemory = (childAgent as any).getMemory ? childAgent.getMemory() : (childAgent as any).memory;
        if (childMemory) {
          await childMemory.close();
        }
      }

      delegationEngine.unregisterActiveSubagent(goalId);

      return {
        success: true,
        contractId: contract.contractId,
        subagentTaskId,
        role: profile.role,
        output: result
      };
    } catch (err: any) {
      delegationEngine.unregisterActiveSubagent(goalId);
      if (!parentMemory) {
        const childMemory = (childAgent as any).getMemory ? childAgent.getMemory() : (childAgent as any).memory;
        if (childMemory) {
          try { await childMemory.close(); } catch {}
        }
      }
      return {
        success: false,
        contractId: contract.contractId,
        subagentTaskId,
        role: profile.role,
        error: err.message
      };
    }
  }
};
