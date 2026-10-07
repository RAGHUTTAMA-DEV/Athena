export type ToolRiskLevel = 'safe' | 'confirm' | 'destructive';
export type ToolPermission =
  | 'fs:read'
  | 'fs:write'
  | 'net:http'
  | 'cmd:exec'
  | 'browser'
  | 'memory'
  | 'system'
  | string;

export interface ToolParameter {
  type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'INTEGER' | 'OBJECT' | 'ARRAY';
  description?: string;
  properties?: Record<string, ToolParameter>;
  required?: string[];
  items?: ToolParameter;
  enum?: string[];
}

/**
 * Section 16 & P4A Full ToolDefinition
 * Standardized across local tools, MCP, sub-agent tools, and sandbox execution.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  capabilities?: string[];
  inputSchema?: {
    type: 'OBJECT' | string;
    properties?: Record<string, any>;
    required?: string[];
    [key: string]: any;
  };
  outputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    [key: string]: any;
  };
  permissions?: ToolPermission[];
  risk?: ToolRiskLevel;
  timeout?: number;
  sideEffects?: boolean;
  idempotent?: boolean;
  parallelSafe?: boolean;
  tags?: string[];
  /** Backward-compatible alias matching Gemini/OpenAI tool declarations */
  parameters?: {
    type: 'OBJECT';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export interface ToolManifest {
  name: string;
  version?: string;
  description?: string;
  riskLevel: ToolRiskLevel;
  parallelSafe: boolean;
  timeoutMs?: number;
  permissions?: ToolPermission[];
  tags?: string[];
  maxOutputBytes?: number;
  capabilities?: string[];
  sideEffects?: boolean;
  idempotent?: boolean;
}

import type { ToolContext } from '../runtime/types.js';

export interface ToolResult<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  retryable: boolean;
  metadata?: {
    durationMs?: number;
    truncated?: boolean;
    artifactPath?: string;
    originalSize?: number;
    circuitBreakerState?: 'closed' | 'open' | 'half-open';
    [key: string]: any;
  };
}

export interface Tool {
  definition: ToolDefinition;
  manifest?: ToolManifest;
  execute: (args: any, context?: ToolContext) => Promise<any> | any;
  requiresConfirmation?: boolean;
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  truncated: boolean;
  timedOut?: boolean;
  killed?: boolean;
}

export interface ExecutionOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  isBackground?: boolean;
  signal?: AbortSignal;
}

export interface BackendStatus {
  status: 'ready' | 'running' | 'stopped';
  type: 'local' | 'sandbox';
  workspaceRoot: string;
  activeProcesses: number;
  resourceLimits?: {
    maxMemoryMb?: number;
    maxTimeoutMs?: number;
    maxOutputBytes?: number;
  };
}
