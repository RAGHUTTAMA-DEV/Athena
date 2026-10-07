import { Tool, ToolContext } from '../runtime/types.js';
import { CodingHarnessBridge } from '../harness/codingHarness.js';

export const delegateCodingTaskTool: Tool = {
  definition: {
    name: 'delegateCodingTask',
    description: 'Delegate coding tasks (write/fix/refactor code, run tests) to the dedicated coding sub-agent. Use this instead of terminal/filesystem tools for any non-trivial code change.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task: {
          type: 'STRING',
          description: 'Clear description of the coding task to perform.'
        },
        cwd: {
          type: 'STRING',
          description: 'Absolute path to the repo/project directory to work in.'
        },
        autoSnapshot: {
          type: 'BOOLEAN',
          description: 'Whether to create an automatic checkpoint/snapshot before applying modifications (default: true).'
        },
        maxIterations: {
          type: 'INTEGER',
          description: 'Optional maximum iterations for the coding sub-agent.'
        }
      },
      required: ['task', 'cwd']
    }
  },
  manifest: {
    name: 'delegateCodingTask',
    version: '1.2.0',
    description: 'Delegates coding execution to the external Coding Harness with checkpointing, tests, and diff tracking.',
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 300000,
    permissions: ['cmd:exec', 'system'],
    tags: ['coding_harness', 'code', 'delegation']
  },
  requiresConfirmation: true,
  execute: async (args: { task: string; cwd: string; autoSnapshot?: boolean; maxIterations?: number }, context?: ToolContext) => {
    const bridge = CodingHarnessBridge.getInstance();
    const result = await bridge.executeTask(
      {
        runId: context?.runId || `task_${Date.now()}`,
        task: args.task,
        cwd: args.cwd,
        traceId: context?.parentRunId || context?.runId,
        autoSnapshot: args.autoSnapshot ?? true,
        maxIterations: args.maxIterations
      },
      {
        cancellationToken: context?.cancellationToken,
        events: context?.events,
        onUpdate: context?.onUpdate
      }
    );

    return result;
  }
};
