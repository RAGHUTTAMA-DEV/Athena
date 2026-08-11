import { Tool } from '../core/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export const terminalTool: Tool = {
  definition: {
    name: 'executeCommand',
    description: 'Execute a shell command in the system terminal on the host OS. Use this to run shell commands (e.g., "dir", "npm test", "git status") as well as launching desktop applications or opening system folders/File Explorer (e.g., "explorer.exe C:\\Users\\raghu\\Desktop" or "start \"\" \"C:\\Users\\raghu\\Desktop\"" on Windows, "open <path>" on macOS, "xdg-open <path>" on Linux).',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: {
          type: 'STRING',
          description: 'The shell command to execute, e.g., "explorer.exe C:\\Users\\raghu\\Desktop" or "dir".'
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
