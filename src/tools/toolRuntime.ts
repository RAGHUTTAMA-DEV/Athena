import * as fs from 'fs';
import * as path from 'path';
import { Tool, ToolDefinition, ToolContext } from '../runtime/types.js';
import { CancellationToken } from '../runtime/cancellation.js';
import { PolicyEngine } from '../security/policyEngine.js';
import { PromptDefense } from '../security/promptDefense.js';
import { CredentialManager } from '../security/credentialManager.js';
import { TelemetryManager } from '../observability/telemetry.js';
import { ExecutionBackend, LocalExecutionBackend } from './executionBackend.js';
import { FilesystemEngine } from './filesystemEngine.js';
import { SearchableToolRegistry } from './toolRegistry.js';
import { ToolDiscoveryPipeline } from './toolDiscovery.js';

export type {
  ToolRiskLevel,
  ToolPermission,
  ToolManifest,
  ToolResult
} from './toolTypes.js';
import type {
  ToolRiskLevel,
  ToolPermission,
  ToolManifest,
  ToolResult
} from './toolTypes.js';

export interface CircuitBreakerOptions {
  failureThreshold?: number; // Consecutive failures before tripping to open (default: 3)
  cooldownMs?: number; // Time in open state before half-open test (default: 30000ms)
  halfOpenSuccessThreshold?: number; // Successes in half-open state before closing (default: 1)
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export class CircuitBreaker {
  public readonly name: string;
  private state: CircuitState = 'closed';
  private failureCount: number = 0;
  private successCount: number = 0;
  private lastFailureTime: number = 0;
  private options: Required<CircuitBreakerOptions>;

  constructor(name: string, options?: CircuitBreakerOptions) {
    this.name = name;
    this.options = {
      failureThreshold: options?.failureThreshold ?? 3,
      cooldownMs: options?.cooldownMs ?? 30000,
      halfOpenSuccessThreshold: options?.halfOpenSuccessThreshold ?? 1
    };
  }

  getState(): CircuitState {
    if (this.state === 'open') {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.options.cooldownMs) {
        this.state = 'half-open';
        this.successCount = 0;
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const currentState = this.getState();
    return currentState === 'closed' || currentState === 'half-open';
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.options.halfOpenSuccessThreshold) {
        this.state = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
      }
    } else if (this.state === 'closed') {
      this.failureCount = 0;
    }
  }

  recordFailure(): void {
    this.lastFailureTime = Date.now();
    if (this.state === 'half-open') {
      this.state = 'open';
      this.failureCount = this.options.failureThreshold;
    } else if (this.state === 'closed') {
      this.failureCount++;
      if (this.failureCount >= this.options.failureThreshold) {
        this.state = 'open';
      }
    }
  }

  reset(): void {
    this.state = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = 0;
  }

  trip(): void {
    this.state = 'open';
    this.lastFailureTime = Date.now();
  }
}

export class CircuitBreakerRegistry {
  private static instance: CircuitBreakerRegistry;
  private breakers: Map<string, CircuitBreaker> = new Map();

  static getInstance(): CircuitBreakerRegistry {
    if (!CircuitBreakerRegistry.instance) {
      CircuitBreakerRegistry.instance = new CircuitBreakerRegistry();
    }
    return CircuitBreakerRegistry.instance;
  }

  getBreaker(toolName: string, options?: CircuitBreakerOptions): CircuitBreaker {
    let breaker = this.breakers.get(toolName);
    if (!breaker) {
      breaker = new CircuitBreaker(toolName, options);
      this.breakers.set(toolName, breaker);
    }
    return breaker;
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

export const DEFAULT_TOOL_MANIFESTS: Record<string, Partial<ToolManifest>> = {
  calculate: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 5000,
    permissions: ['system'],
    tags: ['math', 'utility']
  },
  systemTime: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 3000,
    permissions: ['system'],
    tags: ['utility', 'time']
  },
  readFile: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 15000,
    permissions: ['fs:read'],
    maxOutputBytes: 16384,
    tags: ['fs', 'code']
  },
  listFiles: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 15000,
    permissions: ['fs:read'],
    maxOutputBytes: 16384,
    tags: ['fs']
  },
  grepSearch: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 20000,
    permissions: ['fs:read'],
    maxOutputBytes: 16384,
    tags: ['fs', 'search', 'code']
  },
  replaceFileContent: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 20000,
    permissions: ['fs:write'],
    tags: ['fs', 'code']
  },
  writeFile: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 20000,
    permissions: ['fs:write'],
    tags: ['fs', 'code']
  },
  deleteFile: {
    riskLevel: 'destructive',
    parallelSafe: false,
    timeoutMs: 10000,
    permissions: ['fs:write'],
    tags: ['fs']
  },
  executeCommand: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 60000,
    permissions: ['cmd:exec'],
    maxOutputBytes: 20480,
    tags: ['terminal', 'exec']
  },
  processManage: {
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['cmd:exec'],
    maxOutputBytes: 16384,
    tags: ['terminal', 'process', 'exec']
  },
  executePython: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 30000,
    permissions: ['cmd:exec'],
    maxOutputBytes: 16384,
    tags: ['python', 'exec']
  },
  browser: {
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 35000,
    permissions: ['browser', 'net:http'],
    maxOutputBytes: 16384,
    tags: ['web', 'browser']
  },
  searchWeb: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 20000,
    permissions: ['net:http'],
    maxOutputBytes: 16384,
    tags: ['web', 'search']
  },
  researchWeb: {
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 90000,
    permissions: ['net:http'],
    maxOutputBytes: 20480,
    tags: ['web', 'research', 'search', 'rag']
  },
  ingestDocument: {
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 120000,
    permissions: ['fs:read', 'net:http', 'memory'],
    maxOutputBytes: 16384,
    tags: ['rag', 'documents', 'ingest']
  },
  searchDocuments: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 60000,
    permissions: ['memory'],
    maxOutputBytes: 20480,
    tags: ['rag', 'documents', 'search']
  },
  readDocument: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 60000,
    permissions: ['fs:read', 'memory'],
    maxOutputBytes: 20480,
    tags: ['documents', 'pdf', 'read']
  },
  semantic_memory_manage: {
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 10000,
    permissions: ['memory'],
    tags: ['memory']
  },
  skillManage: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['system'],
    tags: ['skills', 'evolution']
  },
  cronjob: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 10000,
    permissions: ['system'],
    tags: ['scheduler', 'cron']
  },
  browserNavigate: {
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 45000,
    permissions: ['browser'],
    tags: ['browser']
  },
  browserAction: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 30000,
    permissions: ['browser'],
    tags: ['browser']
  },
  browserScreenshot: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['browser'],
    tags: ['browser']
  },
  browserTabManage: {
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['browser'],
    tags: ['browser', 'tabs']
  },
  browserSessionManage: {
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['browser'],
    tags: ['browser', 'session']
  },
  browserExtract: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['browser'],
    tags: ['browser', 'extract']
  },
  delegateTask: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 120000,
    permissions: ['system'],
    tags: ['agent', 'orchestration']
  },
  delegateCodingTask: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 180000,
    permissions: ['system', 'cmd:exec'],
    tags: ['coding_harness', 'code']
  },
  computerInspect: {
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['computer'],
    tags: ['computer', 'desktop', 'inspect']
  },
  computerInteract: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 20000,
    permissions: ['computer'],
    tags: ['computer', 'input', 'interactive']
  },
  computerManageWindow: {
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['computer'],
    tags: ['computer', 'window']
  }
};

export class ToolExecutor {
  private circuitBreakers: CircuitBreakerRegistry;
  private policyEngine: PolicyEngine;
  private promptDefense: PromptDefense;
  private credentialManager: CredentialManager;
  private artifactsDir: string;
  private executionBackend: ExecutionBackend;
  private filesystemEngine: FilesystemEngine;

  constructor(options?: {
    artifactsDir?: string;
    circuitBreakers?: CircuitBreakerRegistry;
    policyEngine?: PolicyEngine;
    promptDefense?: PromptDefense;
    credentialManager?: CredentialManager;
    executionBackend?: ExecutionBackend;
    filesystemEngine?: FilesystemEngine;
  }) {
    this.artifactsDir = options?.artifactsDir || path.resolve(process.cwd(), 'scratch', 'artifacts');
    this.circuitBreakers = options?.circuitBreakers || CircuitBreakerRegistry.getInstance();
    this.policyEngine = options?.policyEngine || PolicyEngine.getInstance();
    this.promptDefense = options?.promptDefense || PromptDefense.getInstance();
    this.credentialManager = options?.credentialManager || CredentialManager.getInstance();
    this.executionBackend = options?.executionBackend || new LocalExecutionBackend();
    this.filesystemEngine = options?.filesystemEngine || new FilesystemEngine();
  }

  public getPolicyEngine(): PolicyEngine {
    return this.policyEngine;
  }

  public getPromptDefense(): PromptDefense {
    return this.promptDefense;
  }

  public getCredentialManager(): CredentialManager {
    return this.credentialManager;
  }

  public getExecutionBackend(): ExecutionBackend {
    return this.executionBackend;
  }

  public setExecutionBackend(backend: ExecutionBackend): void {
    this.executionBackend = backend;
  }

  public getFilesystemEngine(): FilesystemEngine {
    return this.filesystemEngine;
  }

  public setFilesystemEngine(engine: FilesystemEngine): void {
    this.filesystemEngine = engine;
  }

  resolveManifest(tool: Tool): ToolManifest {
    const defaultMeta = DEFAULT_TOOL_MANIFESTS[tool.definition.name] || {};
    return {
      name: tool.definition.name,
      version: tool.manifest?.version || defaultMeta.version || '1.0.0',
      description: tool.manifest?.description || tool.definition.description,
      riskLevel: tool.manifest?.riskLevel || defaultMeta.riskLevel || (tool.requiresConfirmation ? 'confirm' : 'safe'),
      parallelSafe: tool.manifest?.parallelSafe ?? defaultMeta.parallelSafe ?? false,
      timeoutMs: tool.manifest?.timeoutMs || defaultMeta.timeoutMs || 30000,
      permissions: tool.manifest?.permissions || defaultMeta.permissions || [],
      tags: tool.manifest?.tags || defaultMeta.tags || [],
      maxOutputBytes: tool.manifest?.maxOutputBytes || defaultMeta.maxOutputBytes || 16384
    };
  }

  validateArguments(definition: ToolDefinition, args: any): { valid: boolean; error?: string } {
    if (!args || typeof args !== 'object') {
      if (definition.parameters?.required && definition.parameters.required.length > 0) {
        return { valid: false, error: `Tool arguments must be an object. Missing required arguments: ${definition.parameters.required.join(', ')}` };
      }
      return { valid: true };
    }

    const required = definition.parameters?.required || [];
    for (const reqKey of required) {
      if (args[reqKey] === undefined || args[reqKey] === null) {
        return { valid: false, error: `Missing required argument: "${reqKey}" for tool "${definition.name}".` };
      }
    }
    return { valid: true };
  }

  async offloadLargePayload(
    runId: string | undefined,
    toolName: string,
    rawPayload: any,
    maxBytes: number
  ): Promise<{ payload: any; truncated: boolean; artifactPath?: string; originalSize: number }> {
    const serialized = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload, null, 2);
    const byteSize = Buffer.byteLength(serialized, 'utf8');

    if (byteSize <= maxBytes) {
      return { payload: rawPayload, truncated: false, originalSize: byteSize };
    }

    try {
      if (!fs.existsSync(this.artifactsDir)) {
        fs.mkdirSync(this.artifactsDir, { recursive: true });
      }

      const safeRunId = (runId || 'run').replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${safeRunId}_${toolName}_${Date.now()}.txt`;
      const artifactPath = path.join(this.artifactsDir, filename);

      fs.writeFileSync(artifactPath, serialized, 'utf8');

      // Generate a structured preview to fit safely within LLM context
      const previewChars = Math.min(1000, serialized.length);
      const preview = serialized.slice(0, previewChars) + `\n... [Truncated ${byteSize - previewChars} bytes]`;

      const condensed = {
        notice: `Output exceeded token limit (${byteSize} bytes > ${maxBytes} bytes limit). Full output saved to disk artifact.`,
        artifactPath,
        originalSizeBytes: byteSize,
        preview
      };

      return {
        payload: condensed,
        truncated: true,
        artifactPath,
        originalSize: byteSize
      };
    } catch (e: any) {
      // Fallback if writing artifact fails
      return { payload: rawPayload, truncated: false, originalSize: byteSize };
    }
  }

  async execute(tool: Tool, args: any, context?: ToolContext): Promise<ToolResult> {
    const manifest = this.resolveManifest(tool);
    const sanitizedArgs = this.credentialManager.redactData(args);
    return TelemetryManager.getInstance().startToolSpan(
      {
        toolName: manifest.name,
        runId: context?.runId,
        args: sanitizedArgs
      },
      async () => this.executeInternal(tool, args, context)
    );
  }

  private async executeInternal(tool: Tool, args: any, context?: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    const manifest = this.resolveManifest(tool);
    const breaker = this.circuitBreakers.getBreaker(manifest.name);

    // 0. Security Policy Evaluation Gate
    const backend = (context as any)?.executionBackend || this.executionBackend;
    const policyResult = this.policyEngine.evaluateToolCall(
      manifest.name,
      args,
      manifest.permissions,
      {
        isBackground: context?.isBackground,
        backendType: backend?.type,
        sandboxed: backend?.type === 'sandbox'
      }
    );
    if (!policyResult.allowed) {
      return {
        success: false,
        error: {
          code: 'POLICY_VIOLATION',
          message: policyResult.reason || `Tool execution blocked by security policy (${policyResult.ruleId || 'DENY'}).`
        },
        retryable: false,
        metadata: {
          durationMs: Date.now() - startTime,
          policyAction: policyResult.action,
          severity: policyResult.severity
        }
      };
    }
    if (policyResult.action === 'require_confirmation' && context?.confirm) {
      let approved = false;
      try {
        approved = await context.confirm(manifest.name, args);
      } catch {
        approved = false;
      }
      if (!approved) {
        return {
          success: false,
          error: {
            code: 'POLICY_CONFIRMATION_DENIED',
            message: policyResult.reason || `Tool "${manifest.name}" was not approved by the user.`
          },
          retryable: false,
          metadata: {
            durationMs: Date.now() - startTime,
            policyAction: policyResult.action,
            severity: policyResult.severity
          }
        };
      }
    }

    // 1. Circuit breaker guard
    if (!breaker.canExecute()) {
      return {
        success: false,
        error: {
          code: 'CIRCUIT_BREAKER_OPEN',
          message: `Tool "${manifest.name}" is temporarily quarantined due to consecutive failures. Circuit state: OPEN.`
        },
        retryable: false,
        metadata: {
          durationMs: 0,
          circuitBreakerState: 'open'
        }
      };
    }

    // 2. Argument validation
    const validation = this.validateArguments(tool.definition, args);
    if (!validation.valid) {
      return {
        success: false,
        error: {
          code: 'INVALID_ARGUMENTS',
          message: validation.error || 'Invalid arguments provided.'
        },
        retryable: false,
        metadata: {
          durationMs: Date.now() - startTime
        }
      };
    }

    // 3. Execution with Timeout & Cancellation
    const timeoutMs = manifest.timeoutMs || 30000;
    const cancellationToken = context?.cancellationToken;

    let timeoutTimer: NodeJS.Timeout | null = null;

    try {
      const execPromise = Promise.resolve().then(() => tool.execute(args, context));

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          const timeoutErr = new Error(`Tool "${manifest.name}" timed out after ${timeoutMs}ms.`);
          timeoutErr.name = 'TimeoutError';
          reject(timeoutErr);
        }, timeoutMs);
      });

      const cancelPromise = new Promise<never>((_, reject) => {
        if (cancellationToken?.isCancelled) {
          const cancelErr = new Error(cancellationToken.reason || `Tool execution cancelled.`);
          cancelErr.name = 'CancellationError';
          reject(cancelErr);
        } else if (cancellationToken) {
          cancellationToken.onCancel((reason?: string) => {
            const cancelErr = new Error(reason || `Tool execution cancelled.`);
            cancelErr.name = 'CancellationError';
            reject(cancelErr);
          });
        }
      });

      const rawResult = await Promise.race([execPromise, timeoutPromise, cancelPromise]);

      if (timeoutTimer) clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTime;

      // Successful execution: record success on circuit breaker
      breaker.recordSuccess();

      // Wrap untrusted web/external contents with dual-boundary defense
      let processedResult = rawResult;
      const isWebContent = manifest.tags?.includes('web') || manifest.permissions?.includes('browser') || manifest.name === 'searchWeb' || manifest.name === 'browseUrl';
      if (isWebContent && processedResult && typeof processedResult === 'object') {
        if (typeof processedResult.content === 'string') {
          processedResult = {
            ...processedResult,
            content: this.promptDefense.wrapUntrustedData(processedResult.content, {
              source: 'web',
              origin: args?.url || args?.query
            })
          };
        }
      }

      // Check if output payload exceeds maxOutputBytes and offload to disk artifact
      const maxBytes = manifest.maxOutputBytes || 16384;
      const offloaded = await this.offloadLargePayload(context?.runId, manifest.name, processedResult, maxBytes);

      // Check if rawResult itself indicated failure
      let isSuccess = true;
      let errorInfo: { code: string; message: string; details?: any } | undefined;

      if (rawResult && typeof rawResult === 'object' && rawResult.success === false) {
        isSuccess = false;
        errorInfo = {
          code: rawResult.code || 'TOOL_EXECUTION_ERROR',
          message: rawResult.error || 'Tool indicated failure.',
          details: rawResult
        };
      }

      // Deep redact sensitive secrets before returning
      const sanitizedPayload = isSuccess ? this.credentialManager.redactData(offloaded.payload) : undefined;
      const sanitizedError = errorInfo ? this.credentialManager.redactData(errorInfo) : undefined;

      return {
        success: isSuccess,
        data: sanitizedPayload,
        error: sanitizedError,
        retryable: false,
        metadata: {
          durationMs,
          truncated: offloaded.truncated,
          artifactPath: offloaded.artifactPath,
          originalSize: offloaded.originalSize,
          circuitBreakerState: breaker.getState()
        }
      };
    } catch (err: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const durationMs = Date.now() - startTime;

      const isTimeout = err.name === 'TimeoutError' || err.message?.includes('timed out');
      const isCancelled = err.name === 'CancellationError';
      const isRetryable = isTimeout || (!isCancelled && (
        err.message?.includes('fetch') ||
        err.message?.includes('network') ||
        err.message?.includes('ECONNRESET') ||
        err.message?.includes('503') ||
        err.message?.includes('502') ||
        err.message?.includes('504') ||
        err.message?.includes('rate limit')
      ));

      // Record failure for circuit breaker (skip if user cancellation)
      if (!isCancelled) {
        breaker.recordFailure();
      }

      const errorCode = isCancelled
        ? 'CANCELLED'
        : isTimeout
          ? 'TIMEOUT'
          : 'TOOL_EXECUTION_ERROR';

      const sanitizedError = this.credentialManager.redactData({
        code: errorCode,
        message: err.message || 'Tool execution encountered an error.'
      });

      return {
        success: false,
        error: sanitizedError,
        retryable: isRetryable,
        metadata: {
          durationMs,
          circuitBreakerState: breaker.getState()
        }
      };
    }

  }
}

export class ToolSelector {
  // Always include these foundation utility tools
  private static CORE_TOOLS = new Set([
    'calculate',
    'systemTime',
    'readFile',
    'semantic_memory_manage',
    'cronjob'
  ]);

  private static INTENT_KEYWORDS: Record<string, string[]> = {
    code: ['code', 'file', 'read file', 'write file', 'edit', 'replace', 'grep', 'repo', 'git', 'function', 'class', 'import', 'test', 'ts', 'js', 'directory', 'folder', 'workspace'],
    terminal: ['terminal', 'command', 'bash', 'cmd', 'shell', 'exec', 'run command', 'npm', 'install', 'dir', 'explorer'],
    web: ['web', 'search', 'google', 'url', 'site', 'browser', 'scrape', 'news', 'find online', 'http', 'https'],
    python: ['python', 'script', 'data', 'plot', 'numpy', 'pandas', 'calculate'],
    agent: ['subagent', 'delegate', 'worker', 'hire', 'team', 'spawn', 'background'],
    cron: ['cron', 'schedule', 'remind', 'reminder', 'timer', 'alarm', 'recurring', 'interval', 'every', 'secs', 'sec', 'second', 'seconds', 'min', 'mins', 'minute', 'minutes', 'hour', 'hours', 'daily', 'weekly', 'monthly', 'delay', 'job', 'jobs', 'cronjob'],
    github: ['github', 'gh', 'repo', 'repos', 'repository', 'repositories', 'pull request', 'pr', 'commit', 'commits', 'issue', 'issues', 'branch', 'branches', 'git', 'project', 'projects', 'fork', 'clone', 'release', 'workflow', 'star', 'pat'],
    email: ['email', 'mail', 'gmail', 'inbox', 'message', 'draft', 'send email', 'read email'],
    calendar: ['calendar', 'meeting', 'events', 'appointment', 'schedule', 'rsvp'],
    notion: ['notion', 'page', 'database', 'notes', 'docs', 'workspace'],
    diagram: ['excalidraw', 'draw', 'diagram', 'canvas', 'sketch', 'mermaid', 'shape'],
    computer: ['computer', 'desktop', 'window', 'windows', 'screen', 'screenshot', 'mouse', 'keyboard', 'click', 'type', 'scroll', 'accessibility', 'tree', 'hwnd', 'foreground', 'focus', 'drag', 'button', 'display', 'resolution']
  };

  private static TOOL_GROUPS: Record<string, string[]> = {
    code: ['readFile', 'replaceFileContent', 'writeFile', 'deleteFile', 'listFiles', 'grepSearch'],
    terminal: ['executeCommand', 'processManage'],
    web: ['searchWeb', 'browser', 'browserNavigate', 'browserAction', 'browserScreenshot'],
    python: ['executePython', 'calculate'],
    agent: ['delegateTask', 'delegateCodingTask'],
    cron: ['cronjob'],
    computer: ['computerInspect', 'computerInteract', 'computerManageWindow']
  };

  /**
   * Filter available tools using the 5-stage ToolDiscoveryPipeline.
   * Scales gracefully to 100+ registered tools while keeping prompt size bounded.
   */
  static selectRelevantTools(
    userPrompt: string,
    availableTools: Tool[],
    context?: string,
    options?: { policyEngine?: PolicyEngine; isBackground?: boolean }
  ): Tool[] {
    if (availableTools.length <= 8) {
      return availableTools;
    }

    const registry = new SearchableToolRegistry(availableTools);
    return ToolDiscoveryPipeline.discover(registry, userPrompt, {
      recentContext: context,
      policyEngine: options?.policyEngine,
      isBackground: options?.isBackground,
      maxPromptTokens: 2500,
      maxTools: 15,
      forcedTools: Array.from(ToolSelector.CORE_TOOLS)
    });
  }
}
