import * as fs from 'fs';
import * as path from 'path';
import { spawn, ChildProcess } from 'child_process';
import {
  ExecutionBackend
} from './executionBackend.js';
import {
  ExecutionResult,
  ExecutionOptions,
  BackendStatus
} from './toolTypes.js';
import { PolicyEngine } from '../security/policyEngine.js';
import { ObfuscationDetector } from '../security/obfuscationDetector.js';

export interface SandboxConfig {
  sandboxRoot: string;
  maxTimeoutMs?: number;
  maxOutputBytes?: number;
  allowedNetworkHosts?: string[];
  customEnv?: Record<string, string>;
}

export class SandboxedExecutionBackend implements ExecutionBackend {
  public readonly id: string;
  public readonly type: 'sandbox' = 'sandbox';
  private sandboxRoot: string;
  private maxTimeoutMs: number;
  private maxOutputBytes: number;
  private customEnv: Record<string, string>;
  private runningProcesses: Set<ChildProcess> = new Set();
  private policyEngine: PolicyEngine;
  private obfuscationDetector: ObfuscationDetector;
  private isStarted: boolean = false;

  // Environment variable prefixes and names to redact from sandboxed processes
  private sensitiveEnvKeys = [
    'AWS_', 'GITHUB_', 'GEMINI_', 'OPENAI_', 'ANTHROPIC_', 'SSH_', 'AZURE_',
    'DATABASE_', 'DB_', 'API_KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIALS',
    'NVIDIA_', 'TELEGRAM_'
  ];

  constructor(config: SandboxConfig, id?: string) {
    this.sandboxRoot = path.resolve(config.sandboxRoot);
    this.maxTimeoutMs = config.maxTimeoutMs || 30000;
    this.maxOutputBytes = config.maxOutputBytes || 32768;
    this.customEnv = config.customEnv || {};
    this.id = id || `sandbox-${Date.now()}`;
    this.policyEngine = PolicyEngine.getInstance();
    this.obfuscationDetector = ObfuscationDetector.getInstance();
  }

  public getSandboxRoot(): string {
    return this.sandboxRoot;
  }

  public async start(): Promise<void> {
    await fs.promises.mkdir(this.sandboxRoot, { recursive: true });
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
        // ignore
      }
    }
    this.runningProcesses.clear();
  }

  /**
   * Resolves and verifies that a target path resides strictly inside the sandbox.
   * Throws if path escapes sandbox via '..' or symlinks.
   */
  public verifySandboxPath(targetPath: string): string {
    const resolved = path.resolve(this.sandboxRoot, targetPath);
    const rel = path.relative(this.sandboxRoot, resolved);

    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Sandbox escape attempt blocked: Path "${targetPath}" resolves outside sandbox root.`);
    }

    // Verify symlink destination if path or parent exists
    try {
      if (fs.existsSync(resolved)) {
        const canonical = fs.realpathSync(resolved);
        const canRel = path.relative(this.sandboxRoot, canonical);
        if (canRel.startsWith('..') || path.isAbsolute(canRel)) {
          throw new Error(`Sandbox symlink escape attempt blocked: Symlink points to "${canonical}" outside sandbox.`);
        }
      }
    } catch (err: any) {
      if (err.message.includes('Sandbox symlink escape')) throw err;
    }

    return resolved;
  }

  /**
   * Produces an isolated, sanitized environment object with secrets stripped.
   */
  private buildSanitizedEnv(extraEnv?: Record<string, string>): Record<string, string> {
    const sanitized: Record<string, string> = {
      PATH: process.env.PATH || '',
      TEMP: this.sandboxRoot,
      TMP: this.sandboxRoot,
      NODE_ENV: 'sandbox',
      SANDBOX_ROOT: this.sandboxRoot,
      ...this.customEnv,
      ...extraEnv
    };

    // Include non-sensitive base vars from host
    for (const [key, val] of Object.entries(process.env)) {
      if (!val) continue;
      const isSensitive = this.sensitiveEnvKeys.some(s => key.toUpperCase().includes(s));
      if (!isSensitive && !sanitized[key]) {
        sanitized[key] = val;
      }
    }

    return sanitized;
  }

  public async execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const startTime = Date.now();
    const timeoutMs = Math.min(options?.timeoutMs || this.maxTimeoutMs, this.maxTimeoutMs);
    const maxOutputBytes = Math.min(options?.maxOutputBytes || this.maxOutputBytes, this.maxOutputBytes);

    // 1. Obfuscation & Destructive Command Defense
    const obf = this.obfuscationDetector.analyze(command);
    const candidateCmd = obf.isObfuscated ? obf.decodedCommand : command;

    const check = this.policyEngine.evaluateCommand(candidateCmd);
    if (!check.allowed) {
      return {
        exitCode: 126,
        stdout: '',
        stderr: `[SANDBOX POLICY DENIAL: ${check.ruleId || 'DENY'}] ${check.reason || 'Command denied by security policy.'}`,
        durationMs: Date.now() - startTime,
        truncated: false
      };
    }

    // 2. Traversal Defense in Command Text
    // Check for explicit attempts to navigate or copy from outside sandbox
    if (/\b(\.\.[\/\\]\.\.|\.\.[\/\\]\.env|\/etc\/|C:\\Windows|C:\\Users)/i.test(command)) {
      return {
        exitCode: 126,
        stdout: '',
        stderr: `[SANDBOX POLICY DENIAL] Directory traversal detected in command string.`,
        durationMs: Date.now() - startTime,
        truncated: false
      };
    }

    // 3. Resolve Working Directory strictly inside Sandbox
    let cwd = this.sandboxRoot;
    if (options?.cwd) {
      try {
        cwd = this.verifySandboxPath(options.cwd);
      } catch (err: any) {
        return {
          exitCode: 126,
          stdout: '',
          stderr: `[SANDBOX POLICY DENIAL] ${err.message}`,
          durationMs: Date.now() - startTime,
          truncated: false
        };
      }
    }

    // 4. Build Sanitized Environment
    const env = this.buildSanitizedEnv(options?.env);

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
        env,
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
          stdout += '\n[OUTPUT TRUNCATED: Exceeded sandbox byte limit]';
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
          stderr += '\n[STDERR TRUNCATED: Exceeded sandbox byte limit]';
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
          stderr: timedOut ? `${stderr}\nSandbox command timed out after ${timeoutMs}ms`.trim() : stderr,
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
      type: 'sandbox',
      workspaceRoot: this.sandboxRoot,
      activeProcesses: this.runningProcesses.size,
      resourceLimits: {
        maxMemoryMb: 512,
        maxTimeoutMs: this.maxTimeoutMs,
        maxOutputBytes: this.maxOutputBytes
      }
    };
  }

  public async upload(localPath: string, remotePath: string): Promise<void> {
    const src = path.resolve(localPath);
    const dst = this.verifySandboxPath(remotePath);
    await fs.promises.mkdir(path.dirname(dst), { recursive: true });
    await fs.promises.copyFile(src, dst);
  }

  public async download(remotePath: string, localPath: string): Promise<void> {
    const src = this.verifySandboxPath(remotePath);
    const dst = path.resolve(localPath);
    await fs.promises.mkdir(path.dirname(dst), { recursive: true });
    await fs.promises.copyFile(src, dst);
  }
}
