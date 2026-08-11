import { Tool, ToolContext } from '../core/types.js';
import { spawn } from 'child_process';

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
        }
      },
      required: ['task', 'cwd']
    }
  },
  requiresConfirmation: true,
  execute: async (args: { task: string; cwd: string }, context?: ToolContext) => {
    return new Promise((resolve) => {
      try {
        const traceId = context?.parentRunId || '';
        const execArgs = ['--task', args.task, '--cwd', args.cwd];
        if (traceId) {
          execArgs.push('--trace-id', traceId);
        }

        // Spawn harness command using cmd.exe on Windows or directly on other platforms to avoid quoting/path issues
        const child = process.platform === 'win32'
          ? spawn('cmd.exe', ['/c', 'harness', ...execArgs], { timeout: 5 * 60 * 1000, shell: false })
          : spawn('harness', execArgs, { timeout: 5 * 60 * 1000, shell: false });



        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (data) => {
          stdout += data.toString();
        });

        child.stderr.on('data', (data) => {
          const str = data.toString();
          stderr += str;
          // Clean up progress/thinking logs and forward to onUpdate
          if (context?.onUpdate && str.trim()) {
            context.onUpdate({ type: 'thought', message: `[Harness] ${str.trim()}` });
          }
        });

        child.on('close', (code) => {
          if (code === 0) {
            try {
              const parsed = JSON.parse(stdout.trim());
              resolve(parsed);
            } catch (err: any) {
              resolve({
                status: 'failed',
                error: `Failed to parse harness JSON output: ${err.message}`,
                stdout: stdout.trim(),
                stderr: stderr.trim()
              });
            }
          } else {
            // Check if stdout has JSON even with non-zero exit code
            try {
              const parsed = JSON.parse(stdout.trim());
              resolve(parsed);
            } catch (err) {
              resolve({
                status: 'failed',
                error: `Harness exited with code ${code}`,
                stdout: stdout.trim(),
                stderr: stderr.trim()
              });
            }
          }
        });

        child.on('error', (err) => {
          resolve({
            status: 'failed',
            error: err.message,
            stdout: stdout.trim(),
            stderr: stderr.trim()
          });
        });
      } catch (err: any) {
        resolve({
          status: 'failed',
          error: err.message
        });
      }
    });
  }
};
