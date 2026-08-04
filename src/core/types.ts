export interface TextPart {
  text: string;
}

export interface FunctionCallPart {
  functionCall: {
    name: string;
    args: Record<string, any>;
  };
}

export interface FunctionResponsePart {
  functionResponse: {
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

export interface Tool {
  definition: ToolDefinition;
  execute: (args: any, context?: ToolContext) => Promise<any> | any;
  requiresConfirmation?: boolean;
}

export interface ToolContext {
  confirm?: (toolName: string, args: any) => Promise<boolean>;
  memory?: any;
  depth?: number;
  parentRunId?: string;
  onUpdate?: (status: { type: 'thought' | 'tool_call' | 'tool_response' | 'error' | 'memory'; message: string }) => void;
}

export interface AgentConfig {
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
}
