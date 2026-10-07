import { spawn, ChildProcess } from 'child_process';
import * as path from 'path';

export type ProcessStatus = 'running' | 'completed' | 'failed' | 'killed' | 'timed_out';

export interface ManagedProcessInfo {
  pid: number;
  command: string;
  cwd: string;
  startTime: number;
  endTime?: number;
  status: ProcessStatus;
  exitCode?: number | null;
  isBackground: boolean;
  logs: string[];
}

export interface SpawnProcessOptions {
  cwd?: string;
  env?: Record<string, string>;
  isBackground?: boolean;
  timeoutMs?: number;
  maxLogLines?: number;
}

export class ProcessManager {
  private static instance: ProcessManager;
  private processes: Map<number, { info: ManagedProcessInfo; child: ChildProcess }> = new Map();
  private maxStoredProcesses: number = 100;

  public static getInstance(): ProcessManager {
    if (!ProcessManager.instance) {
      ProcessManager.instance = new ProcessManager();
    }
    return ProcessManager.instance;
  }

  public async spawnProcess(
    command: string,
    options?: SpawnProcessOptions
  ): Promise<ManagedProcessInfo> {
    const isWin = process.platform === 'win32';
    const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
    const shellArgs = isWin ? ['/d', '/s', '/c', command] : ['-c', command];
    const cwd = options?.cwd || process.cwd();
    const maxLogLines = options?.maxLogLines || 1000;
    const isBackground = options?.isBackground ?? false;

    const child = spawn(shell, shellArgs, {
      cwd,
      env: { ...process.env, ...options?.env },
      windowsVerbatimArguments: isWin,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const pid = child.pid;
    if (!pid) {
      throw new Error(`Failed to spawn process for command: "${command}"`);
    }

    const info: ManagedProcessInfo = {
      pid,
      command,
      cwd,
      startTime: Date.now(),
      status: 'running',
      isBackground,
      logs: []
    };

    this.processes.set(pid, { info, child });

    const appendLog = (line: string) => {
      info.logs.push(line);
      if (info.logs.length > maxLogLines) {
        info.logs.shift();
      }
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) appendLog(`[stdout] ${line}`);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      for (const line of lines) appendLog(`[stderr] ${line}`);
    });

    if (options?.timeoutMs) {
      setTimeout(() => {
        if (info.status === 'running') {
          info.status = 'timed_out';
          this.killProcess(pid, 'SIGKILL');
        }
      }, options.timeoutMs);
    }

    child.on('close', (code) => {
      info.endTime = Date.now();
      info.exitCode = code;
      if (info.status === 'running') {
        info.status = code === 0 ? 'completed' : 'failed';
      }
    });

    // Prune finished processes if map grows too large
    if (this.processes.size > this.maxStoredProcesses) {
      for (const [pId, entry] of this.processes.entries()) {
        if (entry.info.status !== 'running') {
          this.processes.delete(pId);
          break;
        }
      }
    }

    return info;
  }

  public killProcess(pid: number, signal: 'SIGINT' | 'SIGTERM' | 'SIGKILL' = 'SIGTERM'): boolean {
    const entry = this.processes.get(pid);
    if (!entry) return false;

    const { child, info } = entry;
    if (info.status !== 'running') return false;

    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', pid.toString(), '/f', '/t']);
      } else {
        child.kill(signal);
      }
      info.status = 'killed';
      info.endTime = Date.now();
      return true;
    } catch {
      return false;
    }
  }

  public getProcess(pid: number): ManagedProcessInfo | null {
    return this.processes.get(pid)?.info || null;
  }

  public listProcesses(filter?: {
    status?: ProcessStatus;
    isBackground?: boolean;
  }): ManagedProcessInfo[] {
    const list = Array.from(this.processes.values()).map(e => e.info);
    return list.filter(p => {
      if (filter?.status && p.status !== filter.status) return false;
      if (filter?.isBackground !== undefined && p.isBackground !== filter.isBackground) return false;
      return true;
    });
  }

  public getLogs(pid: number, maxLines: number = 50): string[] {
    const p = this.getProcess(pid);
    if (!p) return [];
    return p.logs.slice(-maxLines);
  }

  public async waitForProcess(pid: number, timeoutMs?: number): Promise<ManagedProcessInfo> {
    const entry = this.processes.get(pid);
    if (!entry) throw new Error(`Process with PID ${pid} not found.`);

    if (entry.info.status !== 'running') {
      return entry.info;
    }

    return new Promise((resolve) => {
      const timer = timeoutMs ? setTimeout(() => {
        resolve(entry.info);
      }, timeoutMs) : null;

      entry.child.on('close', () => {
        if (timer) clearTimeout(timer);
        resolve(entry.info);
      });
    });
  }

  public shutdown(): void {
    for (const [pid, entry] of this.processes) {
      if (entry.info.status === 'running') {
        this.killProcess(pid, 'SIGKILL');
      }
    }
    this.processes.clear();
  }
}
