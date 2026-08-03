import { Tool } from '../core/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export const terminalTool: Tool = {
  definition: {
    name: 'executeCommand',
    description: 'Execute a shell command in the system terminal within the workspace directory.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: {
          type: 'STRING',
          description: 'The shell command to execute, e.g., "npm run test" or "dir".'
        }
      },
      required: ['command']
    }
  },
  requiresConfirmation: true,
  execute: async (args: { command: string }) => {
    try {
      const { stdout, stderr } = await execPromise(args.command, { cwd: process.cwd() });
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message,
        stdout: err.stdout?.trim(),
        stderr: err.stderr?.trim()
      };
    }
  }
};
