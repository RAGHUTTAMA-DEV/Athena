import { Tool } from '../runtime/types.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ProcessManager } from './processManager.js';

const execPromise = promisify(exec);

export const terminalTool: Tool = {
  definition: {
    name: 'executeCommand',
    description: 'Execute a shell command in the system terminal on the host OS. Supports foreground synchronous execution and background asynchronous execution with process tracking, log streaming, and termination via processManage.',
    parameters: {
      type: 'OBJECT',
      properties: {
        command: {
          type: 'STRING',
          description: 'The shell command to execute, e.g., "git status", "dir", "ping 127.0.0.1 -n 10", or "npm test".'
        },
        background: {
          type: 'BOOLEAN',
          description: 'Optional. Set to true to start the process asynchronously in the background. Returns the PID immediately so you can inspect logs or kill it using processManage.'
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
  execute: async (args: { command: string; background?: boolean; timeoutMs?: number; cwd?: string }) => {
    const timeout = args.timeoutMs || parseInt(process.env.TERMINAL_TIMEOUT_MS || '60000', 10);
    const workDir = args.cwd ? path.resolve(process.cwd(), args.cwd) : process.cwd();

    // If background execution is requested, use ProcessManager
    if (args.background) {
      try {
        const pm = ProcessManager.getInstance();
        const info = await pm.spawnProcess(args.command, {
          cwd: workDir,
          isBackground: true,
          timeoutMs: timeout
        });
        return {
          success: true,
          pid: info.pid,
          status: info.status,
          message: `Process started in background with PID ${info.pid}. Use the "processManage" tool with pid ${info.pid} to check logs, status, or terminate it.`
        };
      } catch (err: any) {
        return {
          success: false,
          error: `Failed to spawn background process: ${err.message}`
        };
      }
    }

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

