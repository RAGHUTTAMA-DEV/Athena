import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import {
  ExecutionResult,
  ExecutionOptions,
  BackendStatus,
  ToolRiskLevel
} from './toolTypes.js';

export interface ExecutionBackend {
  readonly id: string;
  readonly type: 'local' | 'sandbox';
  start(): Promise<void>;
  stop(): Promise<void>;
  execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult>;
  inspect(): Promise<BackendStatus>;
  upload(localPath: string, remotePath: string): Promise<void>;
  download(remotePath: string, localPath: string): Promise<void>;
}

export class LocalExecutionBackend implements ExecutionBackend {
  public readonly id: string;
  public readonly type: 'local' = 'local';
  private workspaceRoot: string;
  private runningProcesses: Set<ChildProcess> = new Set();
  private isStarted: boolean = false;

  constructor(workspaceRoot?: string, id?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot || process.cwd());
    this.id = id || `local-${Date.now()}`;
  }

  public async start(): Promise<void> {
    this.isStarted = true;
  }

  public async stop(): Promise<void> {
    this.isStarted = false;
    for (const proc of this.runningProcesses) {
      try {
        if (proc.pid) {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', proc.pid.toString(), '/f', '/t']);
          } else {
            proc.kill('SIGKILL');
          }
        }
      } catch {
        // Process may have already exited
      }
    }
    this.runningProcesses.clear();
  }

  public async execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = options?.timeoutMs || 60000;
    const maxOutputBytes = options?.maxOutputBytes || 65536;
    const cwd = options?.cwd ? path.resolve(this.workspaceRoot, options.cwd) : this.workspaceRoot;

    return new Promise<ExecutionResult>((resolve) => {
      let isSettled = false;
      let timedOut = false;
      let killed = false;
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let stdout = '';
      let stderr = '';
      let truncated = false;

      const isWin = process.platform === 'win32';
      const shell = isWin ? (process.env.ComSpec || 'cmd.exe') : '/bin/sh';
      const shellArgs = isWin ? ['/d', '/s', '/c', command] : ['-c', command];

      const child = spawn(shell, shellArgs, {
        cwd,
        env: { ...process.env, ...options?.env },
        windowsVerbatimArguments: isWin,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      this.runningProcesses.add(child);

      const cleanup = () => {
        this.runningProcesses.delete(child);
        if (timer) clearTimeout(timer);
      };

      const timer = setTimeout(() => {
        if (!isSettled) {
          timedOut = true;
          killChild();
        }
      }, timeoutMs);

      const killChild = () => {
        try {
          if (child.pid) {
            killed = true;
            if (isWin) {
              spawn('taskkill', ['/pid', child.pid.toString(), '/f', '/t']);
            } else {
              child.kill('SIGTERM');
              setTimeout(() => {
                try { child.kill('SIGKILL'); } catch {}
              }, 1000);
            }
          }
        } catch {
          // ignore
        }
      };

      if (options?.signal) {
        options.signal.addEventListener('abort', () => {
          if (!isSettled) {
            killed = true;
            killChild();
          }
        });
      }

      child.stdout?.on('data', (chunk: Buffer) => {
        if (stdoutBytes + chunk.length <= maxOutputBytes) {
          stdout += chunk.toString('utf8');
          stdoutBytes += chunk.length;
        } else if (!truncated) {
          const remaining = maxOutputBytes - stdoutBytes;
          if (remaining > 0) {
            stdout += chunk.slice(0, remaining).toString('utf8');
          }
          truncated = true;
          stdout += '\n[OUTPUT TRUNCATED: Exceeded byte limit]';
        }
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        if (stderrBytes + chunk.length <= maxOutputBytes) {
          stderr += chunk.toString('utf8');
          stderrBytes += chunk.length;
        } else if (!truncated) {
          const remaining = maxOutputBytes - stderrBytes;
          if (remaining > 0) {
            stderr += chunk.slice(0, remaining).toString('utf8');
          }
          truncated = true;
          stderr += '\n[STDERR TRUNCATED: Exceeded byte limit]';
        }
      });

      child.on('error', (err) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve({
          exitCode: 1,
          stdout,
          stderr: `${stderr}\n${err.message}`.trim(),
          durationMs: Date.now() - startTime,
          truncated,
          timedOut,
          killed
        });
      });

      child.on('close', (code) => {
        if (isSettled) return;
        isSettled = true;
        cleanup();
        resolve({
          exitCode: timedOut ? 124 : (code ?? 1),
          stdout,
          stderr: timedOut ? `${stderr}\nCommand timed out after ${timeoutMs}ms`.trim() : stderr,
          durationMs: Date.now() - startTime,
          truncated,
          timedOut,
          killed
        });
      });
    });
  }

  public async inspect(): Promise<BackendStatus> {
    return {
      status: this.isStarted ? 'running' : 'ready',
      type: 'local',
      workspaceRoot: this.workspaceRoot,
      activeProcesses: this.runningProcesses.size,
      resourceLimits: {
        maxMemoryMb: 2048,
        maxTimeoutMs: 120000,
        maxOutputBytes: 65536
      }
    };
  }

  public async upload(localPath: string, remotePath: string): Promise<void> {
    const src = path.resolve(localPath);
    const dst = path.resolve(this.workspaceRoot, remotePath);
    await fs.promises.mkdir(path.dirname(dst), { recursive: true });
    await fs.promises.copyFile(src, dst);
  }

  public async download(remotePath: string, localPath: string): Promise<void> {
    const src = path.resolve(this.workspaceRoot, remotePath);
    const dst = path.resolve(localPath);
    await fs.promises.mkdir(path.dirname(dst), { recursive: true });
    await fs.promises.copyFile(src, dst);
  }
}
