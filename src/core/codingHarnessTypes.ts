export interface CodingTaskRequest {
  runId: string;
  task: string;
  cwd: string;
  traceId?: string;
  maxIterations?: number;
  timeoutSec?: number;
  constraints?: string[];
  autoSnapshot?: boolean;
}

export interface CodingTaskResult {
  status: 'success' | 'failed' | 'cancelled';
  runId?: string;
  summary?: string;
  filesChanged?: string[];
  testsPassed?: boolean;
  diff?: string;
  checkpointId?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
  durationMs?: number;
}

export interface HarnessRepoInfo {
  cwd: string;
  gitBranch?: string;
  gitStatus?: string;
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun' | 'pip' | 'cargo';
  hasTests?: boolean;
}
