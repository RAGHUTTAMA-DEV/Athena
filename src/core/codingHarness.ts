import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { CodingTaskRequest, CodingTaskResult, HarnessRepoInfo } from './codingHarnessTypes.js';
import { CancellationToken } from './cancellation.js';
import { AgentEventEmitter } from './events.js';
import { TelemetryManager } from './telemetry.js';

const execPromise = promisify(exec);

export class CodingHarnessBridge {
  private static instance: CodingHarnessBridge;

  static getInstance(): CodingHarnessBridge {
    if (!CodingHarnessBridge.instance) {
      CodingHarnessBridge.instance = new CodingHarnessBridge();
    }
    return CodingHarnessBridge.instance;
  }

  /**
   * Inspect the target workspace to discover tech stack, package manager, and git status.
   */
  async inspectRepo(cwd: string): Promise<HarnessRepoInfo> {
    const resolvedCwd = path.resolve(cwd);
    const info: HarnessRepoInfo = { cwd: resolvedCwd };

    try {
      const { stdout: branch } = await execPromise('git rev-parse --abbrev-ref HEAD', { cwd: resolvedCwd, timeout: 5000 });
      info.gitBranch = branch.trim();
    } catch (e) {}

    try {
      const { stdout: status } = await execPromise('git status --short', { cwd: resolvedCwd, timeout: 5000 });
      info.gitStatus = status.trim();
    } catch (e) {}

    // Check package manager
    if (fs.existsSync(path.join(resolvedCwd, 'pnpm-lock.yaml'))) {
      info.packageManager = 'pnpm';
    } else if (fs.existsSync(path.join(resolvedCwd, 'yarn.lock'))) {
      info.packageManager = 'yarn';
    } else if (fs.existsSync(path.join(resolvedCwd, 'bun.lockb'))) {
      info.packageManager = 'bun';
    } else if (fs.existsSync(path.join(resolvedCwd, 'package.json'))) {
      info.packageManager = 'npm';
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(resolvedCwd, 'package.json'), 'utf-8'));
        const scriptKeys = Object.keys(pkg.scripts || {});
        info.hasTests = Boolean(pkg.scripts?.test || scriptKeys.some(k => k.startsWith('test')));
      } catch (e) {}
    } else if (fs.existsSync(path.join(resolvedCwd, 'Cargo.toml'))) {
      info.packageManager = 'cargo';
    } else if (fs.existsSync(path.join(resolvedCwd, 'requirements.txt')) || fs.existsSync(path.join(resolvedCwd, 'pyproject.toml'))) {
      info.packageManager = 'pip';
    }

    return info;
  }

  /**
   * Create a snapshot or checkpoint before editing.
   * Tries `harness snapshot create` first, with graceful fallback to git stash.
   */
  async createSnapshot(cwd: string, label: string): Promise<string | null> {
    try {
      const { stdout } = await execPromise(`cmd.exe /c harness snapshot create "${label}" --cwd "${cwd}"`, { timeout: 10000 });
      const parsed = JSON.parse(stdout.trim());
      if (parsed.snapshotId) return parsed.snapshotId;
    } catch (e) {
      // Fallback to git stash or git tag if harness subcommand is unavailable
      try {
        const stashMsg = `athena_auto_snapshot_${Date.now()}`;
        await execPromise(`git stash create "${stashMsg}"`, { cwd, timeout: 5000 });
        return stashMsg;
      } catch (gitErr) {}
    }
    return null;
  }

  /**
   * Restore a snapshot or rollback changes.
   */
  async rollbackSnapshot(cwd: string, snapshotId: string): Promise<boolean> {
    try {
      await execPromise(`cmd.exe /c harness snapshot restore "${snapshotId}" --cwd "${cwd}"`, { timeout: 10000 });
      return true;
    } catch (e) {
      try {
        await execPromise(`git stash apply "${snapshotId}"`, { cwd, timeout: 5000 });
        return true;
      } catch (gitErr) {
        return false;
      }
    }
  }

  /**
   * Execute a coding task via the global `harness` CLI, streaming events and enforcing budgets.
   */
  async executeTask(
    request: CodingTaskRequest,
    options?: {
      cancellationToken?: CancellationToken;
      events?: AgentEventEmitter;
      onUpdate?: (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void;
    }
  ): Promise<CodingTaskResult> {
    const startTime = Date.now();
    const resolvedCwd = path.resolve(request.cwd);

    // Auto-snapshot before running if requested
    let snapshotId: string | null = null;
    if (request.autoSnapshot) {
      options?.onUpdate?.({ type: 'thought', message: `[Harness Bridge] Creating pre-execution snapshot for ${resolvedCwd}...` });
      snapshotId = await this.createSnapshot(resolvedCwd, `pre_${request.runId}`);
    }

    const execArgs = [
      '--task', request.task,
      '--cwd', resolvedCwd
    ];

    const traceId = request.traceId || TelemetryManager.getInstance().getCurrentTraceId() || request.runId;
    if (traceId) {
      execArgs.push('--trace-id', traceId);
    }
    if (request.maxIterations) {
      execArgs.push('--max-iterations', String(request.maxIterations));
    }
    if (request.timeoutSec) {
      execArgs.push('--timeout', String(request.timeoutSec));
    }

    return new Promise<CodingTaskResult>((resolve) => {
      let isSettled = false;
      const timeoutMs = (request.timeoutSec || 300) * 1000;

      // Spawn harness
      const child = process.platform === 'win32'
        ? spawn('cmd.exe', ['/c', 'harness', ...execArgs], { timeout: timeoutMs, shell: false })
        : spawn('harness', execArgs, { timeout: timeoutMs, shell: false });

      let stdout = '';
      let stderr = '';

      // Cancellation listener
      let cancelCleanup: (() => void) | null = null;
      if (options?.cancellationToken) {
        cancelCleanup = options.cancellationToken.onCancel((reason) => {
          if (!isSettled) {
            isSettled = true;
            try {
              child.kill('SIGTERM');
              // Also send harness cancel
              execPromise(`cmd.exe /c harness cancel "${traceId}" --cwd "${resolvedCwd}"`, { timeout: 5000 }).catch(() => {});
            } catch (e) {}

            resolve({
              status: 'cancelled',
              runId: request.runId,
              error: reason || 'Coding task cancelled by user request.',
              durationMs: Date.now() - startTime
            });
          }
        });
      }

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        const trimmed = chunk.trim();
        if (trimmed) {
          options?.onUpdate?.({
            type: 'thought',
            message: `[Harness] ${trimmed}`
          });
        }
      });

      child.on('close', async (code) => {
        if (isSettled) return;
        isSettled = true;
        if (cancelCleanup) cancelCleanup();

        const durationMs = Date.now() - startTime;
        let parsedResult: any = null;

        try {
          parsedResult = JSON.parse(stdout.trim());
        } catch (e) {
          // Check for JSON embedded in output
          const match = stdout.match(/\{[\s\S]*"status"[\s\S]*\}/);
          if (match) {
            try {
              parsedResult = JSON.parse(match[0]);
            } catch (err) {}
          }
        }

        if (code === 0 && parsedResult && parsedResult.status === 'success') {
          resolve({
            status: 'success',
            runId: request.runId,
            summary: parsedResult.summary || 'Coding task completed successfully.',
            filesChanged: parsedResult.filesChanged || [],
            testsPassed: parsedResult.testsPassed ?? true,
            diff: parsedResult.diff,
            checkpointId: snapshotId || parsedResult.checkpointId,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            durationMs
          });
        } else if (parsedResult) {
          // If tests failed and autoSnapshot was enabled, rollback
          if (request.autoSnapshot && snapshotId && parsedResult.testsPassed === false) {
            options?.onUpdate?.({ type: 'thought', message: `[Harness Bridge] Tests failed; rolling back to snapshot ${snapshotId}...` });
            await this.rollbackSnapshot(resolvedCwd, snapshotId);
          }

          resolve({
            status: parsedResult.status || (code === 0 ? 'success' : 'failed'),
            runId: request.runId,
            summary: parsedResult.summary,
            filesChanged: parsedResult.filesChanged || [],
            testsPassed: parsedResult.testsPassed,
            diff: parsedResult.diff,
            checkpointId: snapshotId || parsedResult.checkpointId,
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: parsedResult.error || (code !== 0 ? `Harness exited with code ${code}` : undefined),
            durationMs
          });
        } else {
          // Failed to parse JSON
          resolve({
            status: code === 0 ? 'success' : 'failed',
            runId: request.runId,
            summary: stdout.trim().slice(0, 500),
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            error: code !== 0 ? `Harness execution failed with exit code ${code}` : undefined,
            checkpointId: snapshotId || undefined,
            durationMs
          });
        }
      });

      child.on('error', (err) => {
        if (isSettled) return;
        isSettled = true;
        if (cancelCleanup) cancelCleanup();

        resolve({
          status: 'failed',
          runId: request.runId,
          error: `Failed to spawn harness process: ${err.message}`,
          durationMs: Date.now() - startTime
        });
      });
    });
  }
}

export class CodingAcceptanceGate {
  /**
   * Final verification gate for code changes before marking a task complete.
   */
  static verify(
    result: CodingTaskResult,
    options?: { requireTests?: boolean; requiredFiles?: string[] }
  ): { passed: boolean; reasoning: string; issues: string[] } {
    const issues: string[] = [];

    if (result.status !== 'success') {
      issues.push(`Harness reported failure: ${result.error || 'Unknown error'}`);
    }

    if (options?.requireTests && result.testsPassed === false) {
      issues.push('Automated tests failed during harness execution.');
    }

    if (options?.requiredFiles && options.requiredFiles.length > 0) {
      const changed = new Set((result.filesChanged || []).map(f => path.basename(f)));
      for (const required of options.requiredFiles) {
        if (!changed.has(path.basename(required))) {
          issues.push(`Required file "${required}" was not modified.`);
        }
      }
    }

    const passed = issues.length === 0;
    return {
      passed,
      reasoning: passed
        ? 'Coding task passed acceptance criteria.'
        : `Coding task failed acceptance verification: ${issues.join('; ')}`,
      issues
    };
  }
}
