import { Tool } from '../runtime/types.js';
import { ProcessManager, ManagedProcessInfo } from './processManager.js';

export const processManageTool: Tool = {
  definition: {
    name: 'processManage',
    description: 'Manage running background and foreground terminal processes. Use this to inspect process status, retrieve streaming stdout/stderr logs, wait for completion, or terminate/kill processes by PID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          description: 'Action to perform: "list" (show all tracked processes), "status" (check status of a specific PID), "logs" (fetch recent stdout/stderr output lines for a PID), "kill" (terminate a running process), or "wait" (wait for process to exit).',
          enum: ['list', 'status', 'logs', 'kill', 'wait']
        },
        pid: {
          type: 'INTEGER',
          description: 'The Process ID (PID) to inspect, stream logs from, or terminate.'
        },
        signal: {
          type: 'STRING',
          description: 'Termination signal to send ("SIGTERM", "SIGINT", "SIGKILL"). Defaults to "SIGTERM".',
          enum: ['SIGTERM', 'SIGINT', 'SIGKILL']
        },
        maxLines: {
          type: 'INTEGER',
          description: 'Maximum number of recent log lines to retrieve when reading logs (defaults to 50).'
        },
        timeoutMs: {
          type: 'INTEGER',
          description: 'Timeout in milliseconds when waiting for a process.'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: false,
  execute: async (args: {
    action: 'list' | 'status' | 'logs' | 'kill' | 'wait';
    pid?: number;
    signal?: 'SIGTERM' | 'SIGINT' | 'SIGKILL';
    maxLines?: number;
    timeoutMs?: number;
  }) => {
    const pm = ProcessManager.getInstance();

    switch (args.action) {
      case 'list': {
        const processes = pm.listProcesses();
        return {
          success: true,
          count: processes.length,
          processes: processes.map(p => ({
            pid: p.pid,
            command: p.command,
            status: p.status,
            isBackground: p.isBackground,
            startTime: p.startTime,
            endTime: p.endTime,
            exitCode: p.exitCode,
            logCount: p.logs.length
          }))
        };
      }

      case 'status': {
        if (!args.pid) {
          return { success: false, error: 'PID is required for status action.' };
        }
        const info = pm.getProcess(args.pid);
        if (!info) {
          return { success: false, error: `Process with PID ${args.pid} not found in process manager.` };
        }
        return {
          success: true,
          process: {
            pid: info.pid,
            command: info.command,
            status: info.status,
            isBackground: info.isBackground,
            startTime: info.startTime,
            endTime: info.endTime,
            exitCode: info.exitCode,
            recentLogs: info.logs.slice(-10)
          }
        };
      }

      case 'logs': {
        if (!args.pid) {
          return { success: false, error: 'PID is required for logs action.' };
        }
        const logs = pm.getLogs(args.pid, args.maxLines || 50);
        const info = pm.getProcess(args.pid);
        return {
          success: true,
          pid: args.pid,
          status: info?.status || 'unknown',
          lineCount: logs.length,
          logs
        };
      }

      case 'kill': {
        if (!args.pid) {
          return { success: false, error: 'PID is required for kill action.' };
        }
        const signal = args.signal || 'SIGTERM';
        const killed = pm.killProcess(args.pid, signal);
        return {
          success: killed,
          pid: args.pid,
          signal,
          message: killed ? `Process ${args.pid} terminated with ${signal}.` : `Failed to terminate process ${args.pid} (may already be finished).`
        };
      }

      case 'wait': {
        if (!args.pid) {
          return { success: false, error: 'PID is required for wait action.' };
        }
        try {
          const finished = await pm.waitForProcess(args.pid, args.timeoutMs);
          return {
            success: true,
            process: finished
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      default:
        return { success: false, error: `Unknown action: ${(args as any).action}` };
    }
  }
};
