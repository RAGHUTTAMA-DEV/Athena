import { Tool } from '../runtime/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execPromise = promisify(exec);

export const terminalTool: Tool = {
  definition: {
    name: 'executeCommand',
    description: 'Execute a shell command in the system terminal on the host OS. Use this to run shell commands (e.g., "dir", "npm test", "git status") or launch desktop applications/open system folders (e.g., "explorer.exe ." or "start \"\" <path>" on Windows, "open <path>" on macOS, "xdg-open <path>" on Linux).',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: {
          type: 'STRING',
          description: 'The shell command to execute, e.g., "git status", "dir", or "npm test".'
        },
        timeoutMs: {
          type: 'INTEGER',
          description: 'Optional execution timeout in milliseconds (defaults to 60000ms / 1 minute).'
        },
        cwd: {
          type: 'STRING',
          description: 'Optional working directory in which to execute the command (defaults to current working directory).'
        }
      },
      required: ['command']
    }
  },
  requiresConfirmation: true,
  execute: async (args: { command: string; timeoutMs?: number; cwd?: string }) => {
    const timeout = args.timeoutMs || parseInt(process.env.TERMINAL_TIMEOUT_MS || '60000', 10);
    const workDir = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();

    try {
      const { stdout, stderr } = await execPromise(args.command, {
        cwd: workDir,
        timeout,
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer limit
      });
      return {
        success: true,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      };
    } catch (err: any) {
      const isTimeout = err.killed || err.signal === 'SIGTERM' || err.message?.toLowerCase().includes('timed out');
      return {
        success: false,
        error: isTimeout ? `Command timed out after ${timeout}ms: ${err.message}` : err.message,
        stdout: err.stdout?.trim(),
        stderr: err.stderr?.trim()
      };
    }
  }
};

