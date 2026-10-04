export interface TextPart {
  text: string;
}

export interface FunctionCallPart {
  functionCall: {
    id?: string;
    name: string;
    args: Record<string, any>;
  };
}

export interface FunctionResponsePart {
  functionResponse: {
    id?: string;
    name: string;
    response: Record<string, any>;
  };
}

export type Part = TextPart | FunctionCallPart | FunctionResponsePart;

export interface Message {
  role: 'user' | 'model';
  parts: Part[];
}

export interface ToolParameter {
    type: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'INTEGER' | 'OBJECT' | 'ARRAY';
    description?: string;
    properties?: Record<string, ToolParameter>;
    required?: string[];
    items?: ToolParameter;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: {
    type: 'OBJECT';
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

import type { ToolManifest } from './toolRuntime.js';

export interface Tool {
  definition: ToolDefinition;
  manifest?: ToolManifest;
  execute: (args: any, context?: ToolContext) => Promise<any> | any;
  requiresConfirmation?: boolean;
}

import { CancellationToken } from './cancellation.js';
import { RunBudget } from './runState.js';
import { AgentEventEmitter } from './events.js';

export interface ToolContext {
  confirm?: (toolName: string, args: any) => Promise<boolean>;
  memory?: any;
  depth?: number;
  runId?: string;
  parentRunId?: string;
  rootRunId?: string;
  cancellationToken?: CancellationToken;
  budget?: RunBudget;
  events?: AgentEventEmitter;
  idempotencyKey?: string;
  onUpdate?: (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void;
  provider?: ProviderType;
  modelName?: string;
  nvidiaApiKey?: string;
  nvidiaBaseUrl?: string;
}

export interface RunOptions {
  runId?: string;
  parentRunId?: string;
  rootRunId?: string;
  sessionId?: string;
  budget?: RunBudget;
  cancellationToken?: CancellationToken;
  events?: AgentEventEmitter;
  onUpdate?: (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void;
  confirm?: (toolName: string, args: any) => Promise<boolean>;
}

export type ProviderType = 'gemini' | 'nvidia';

export interface AgentConfig {
  provider?: ProviderType;
  modelName: string;
  maxTurns: number;
  systemPrompt: string;
  soulPath?: string;
  dbPath?: string;
  skillsPath?: string;
  allowedTools?: string[];
  depth?: number;
  taskId?: string;
  consolidationThreshold?: number;
  nvidiaApiKey?: string;
  nvidiaBaseUrl?: string;
}
