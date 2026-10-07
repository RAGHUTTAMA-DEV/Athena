import * as path from 'path';
import { PermissionModel, ToolPermissionRule } from './identityTypes.js';
import { isEmptyPermissionModel } from './identity.js';

export type PolicyAction = 'allow' | 'deny' | 'require_confirmation';
export type PolicySeverity = 'low' | 'medium' | 'high' | 'critical';

export interface PolicyCheckResult {
  allowed: boolean;
  action: PolicyAction;
  reason?: string;
  severity?: PolicySeverity;
  ruleId?: string;
}

export interface SecurityPolicyConfig {
  workspaceRoot?: string;
  allowDestructiveCommands?: boolean;
  blockedFilePatterns?: RegExp[];
  blockedCommandPatterns?: RegExp[];
  sensitiveEnvPatterns?: RegExp[];
}

export class PolicyEngine {
  private static instance: PolicyEngine;
  private workspaceRoot: string;
  private allowDestructiveCommands: boolean;
  /**
   * Data-driven permission model (agent + user). Primary layer.
   * null means V1 behavior: default-allow, hardcoded rules only.
   */
  private permissionModel: PermissionModel | null = null;

  // Patterns for sensitive file paths that should never be read, overwritten or leaked
  private blockedFilePatterns: RegExp[] = [
    /(^|[/\\])\.env($|\..*)/i,                          // .env, .env.local, .env.production
    /(^|[/\\])id_(rsa|dsa|ecdsa|ed25519)($|\..*)/i,    // SSH private keys
    /\.(pem|key|pfx|p12|pkcs12)$/i,                     // Certificates & private keys
    /(^|[/\\])\.ssh([/\\]|$)/i,                         // .ssh directory
    /(^|[/\\])credentials(\.json|\.ini|\.xml)?$/i,     // Cloud & app credentials
    /(^|[/\\])client_secret.*\.json$/i,                 // OAuth client secrets
    /(^|[/\\])\.git[/\\]config$/i,                      // Git config (may contain tokens in URL)
    /(^|[/\\])\.aws([/\\]|$)/i,                         // AWS credentials
    /(^|[/\\])\.kube([/\\]config)?$/i,                  // Kubernetes credentials
    /\/etc\/(shadow|passwd|sudoers)/i,                  // Linux core auth files
    /\\system32\\config\\(sam|system|security)/i,       // Windows registry hives & SAM
  ];

  // Patterns for highly destructive or irreversible shell commands
  private blockedCommandPatterns: RegExp[] = [
    /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f*|-[a-zA-Z]*f[a-zA-Z]*r*)\s+[\/\\]?(\*|$|\s)/i, // rm -rf / or rm -rf *
    /\b(rmdir|rd)(\s+\/[a-zA-Z]+)*\s+[a-zA-Z]:\\?/i,                               // Windows rmdir /s /q C:\
    /\bdel(\s+\/[a-zA-Z]+)*\s+[a-zA-Z]:\\?/i,                                       // Windows del /f /s /q C:\
    /\bmkfs(\.[a-zA-Z0-9]+)?\s+/i,                                                 // Filesystem format
    /\bformat\s+[a-zA-Z]:/i,                                                        // Windows drive format
    /\bdd\s+if=.*of=(\/dev\/[a-z]+|[a-zA-Z]:)/i,                                   // Raw disk overwrites
    /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,                                    // Bash fork bomb
    /\b(shutdown|reboot|init\s+0|poweroff)\b/i,                                     // OS shutdown/reboot
    /\bdrop\s+database\b/i,                                                         // Direct SQL database drop
    /\bcurl\s+.*(@\.env|--data\s+.*process\.env)/i,                                // Secret exfiltration via curl
  ];

  constructor(config?: SecurityPolicyConfig) {
    this.workspaceRoot = path.resolve(config?.workspaceRoot || process.cwd());
    this.allowDestructiveCommands = config?.allowDestructiveCommands || false;
    if (config?.blockedFilePatterns) {
      this.blockedFilePatterns.push(...config.blockedFilePatterns);
    }
    if (config?.blockedCommandPatterns) {
      this.blockedCommandPatterns.push(...config.blockedCommandPatterns);
    }
  }

  public static getInstance(config?: SecurityPolicyConfig): PolicyEngine {
    if (!PolicyEngine.instance) {
      PolicyEngine.instance = new PolicyEngine(config);
    }
    return PolicyEngine.instance;
  }

  public setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
  }

  public getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /** Install or clear the data-driven permission model. An empty model clears it. */
  public setPermissionModel(model: PermissionModel | null): void {
    this.permissionModel = !model || isEmptyPermissionModel(model) ? null : model;
  }

  public getPermissionModel(): PermissionModel | null {
    return this.permissionModel;
  }

  /**
   * First matching rule wins. composePermissionModels orders user denies
   * ahead of agent allows, so this walk must not prefer a tool-name match
   * over an earlier category deny.
   */
  private matchPermissionRule(toolName: string, toolPermissions?: string[]): ToolPermissionRule | null {
    if (!this.permissionModel) return null;
    for (const rule of this.permissionModel.toolPermissions) {
      if (rule.pattern === '*' || rule.pattern === toolName || toolPermissions?.includes(rule.pattern)) {
        return rule;
      }
    }
    return null;
  }

  /**
   * Evaluates filesystem operations (read, write, delete)
   */
  public evaluateFileAccess(filePath: string, operation: 'read' | 'write' | 'delete'): PolicyCheckResult {
    if (!filePath || typeof filePath !== 'string') {
      return {
        allowed: false,
        action: 'deny',
        reason: 'Empty or invalid file path provided.',
        severity: 'medium',
        ruleId: 'INVALID_PATH'
      };
    }

    const normalizedPath = path.normalize(filePath).trim();

    // Check sensitive file patterns
    for (const pattern of this.blockedFilePatterns) {
      if (pattern.test(normalizedPath)) {
        return {
          allowed: false,
          action: 'deny',
          reason: `Access to sensitive security file denied by policy (pattern matched: ${pattern.source}).`,
          severity: 'critical',
          ruleId: 'SENSITIVE_FILE_PROTECTION'
        };
      }
    }

    // Path traversal / escaping workspace root verification
    const resolvedPath = path.resolve(this.workspaceRoot, normalizedPath);
    const relative = path.relative(this.workspaceRoot, resolvedPath);

    // If file is outside workspace and attempts modification/deletion, restrict or require confirmation
    const isOutsideWorkspace = relative.startsWith('..') || path.isAbsolute(relative);
    if (isOutsideWorkspace && (operation === 'write' || operation === 'delete')) {
      const extraRoots = this.permissionModel?.fileWriteRoots || [];
      for (const root of extraRoots) {
        const resolvedRoot = path.resolve(root);
        const rel = path.relative(resolvedRoot, resolvedPath);
        const inside = !rel.startsWith('..') && !path.isAbsolute(rel);
        if (inside) {
          return {
            allowed: true,
            action: 'allow',
            reason: `Path permitted by permission model write root: ${resolvedRoot}`,
            ruleId: 'PERMISSION_MODEL_WRITE_ROOT'
          };
        }
      }
      return {
        allowed: false,
        action: 'deny',
        reason: `Destructive file operation outside the active workspace is blocked (${normalizedPath}).`,
        severity: 'high',
        ruleId: 'WORKSPACE_BOUNDARY_ENFORCEMENT'
      };
    }

    return {
      allowed: true,
      action: 'allow'
    };
  }

  /**
   * Evaluates terminal command execution
   */
  public evaluateCommand(command: string): PolicyCheckResult {
    if (!command || typeof command !== 'string') {
      return {
        allowed: false,
        action: 'deny',
        reason: 'Empty command string.',
        severity: 'medium',
        ruleId: 'EMPTY_COMMAND'
      };
    }

    const trimmed = command.trim();

    if (!this.allowDestructiveCommands) {
      for (const pattern of this.blockedCommandPatterns) {
        if (pattern.test(trimmed)) {
          return {
            allowed: false,
            action: 'deny',
            reason: `Execution of potentially destructive command blocked by policy: "${trimmed.slice(0, 60)}..."`,
            severity: 'critical',
            ruleId: 'DESTRUCTIVE_COMMAND_BLOCKED'
          };
        }
      }
    }

    return {
      allowed: true,
      action: 'allow'
    };
  }

  /**
   * Central evaluation hook for any tool invocation.
   * The data-driven permission model is evaluated first. deny blocks
   * immediately. require_confirmation is flagged for the executor.
   * allow falls through so the V1 hardcoded rules still apply.
   */
  public evaluateToolCall(
    toolName: string,
    args: any,
    toolPermissions?: string[],
    options?: { isBackground?: boolean }
  ): PolicyCheckResult {
    if (options?.isBackground) {
      const unsafeBackgroundTools = ['executeCommand', 'writeFile', 'replaceFileContent', 'deleteFile'];
      if (unsafeBackgroundTools.includes(toolName)) {
        return {
          allowed: false,
          action: 'deny',
          reason: `Background execution is restricted to safe/read-only tools until P4A sandbox is available (tool "${toolName}" is blocked).`,
          severity: 'high',
          ruleId: 'BACKGROUND_SAFE_TOOL_RESTRICTION'
        };
      }
    }

    const rule = this.matchPermissionRule(toolName, toolPermissions);
    if (rule && rule.effect === 'deny') {
      return {
        allowed: false,
        action: 'deny',
        reason: rule.reason || `Tool "${toolName}" is denied by the permission model (pattern: ${rule.pattern}).`,
        severity: 'high',
        ruleId: 'PERMISSION_MODEL_DENIED'
      };
    }
    if (rule && rule.effect === 'require_confirmation') {
      return {
        allowed: true,
        action: 'require_confirmation',
        reason: rule.reason || `Tool "${toolName}" requires confirmation per the permission model (pattern: ${rule.pattern}).`,
        severity: 'medium',
        ruleId: 'PERMISSION_MODEL_CONFIRMATION'
      };
    }

    switch (toolName) {
      case 'readFile': {
        const targetPath = args?.path || args?.filePath;
        if (targetPath) {
          return this.evaluateFileAccess(targetPath, 'read');
        }
        break;
      }

      case 'writeFile':
      case 'replaceFileContent': {
        const targetPath = args?.path || args?.filePath;
        if (targetPath) {
          return this.evaluateFileAccess(targetPath, 'write');
        }
        break;
      }

      case 'deleteFile': {
        const targetPath = args?.path || args?.filePath;
        if (targetPath) {
          return this.evaluateFileAccess(targetPath, 'delete');
        }
        break;
      }

      case 'executeCommand':
        if (args?.command) {
          return this.evaluateCommand(args.command);
        }
        break;

      default:
        break;
    }

    return {
      allowed: true,
      action: 'allow'
    };
  }
}
