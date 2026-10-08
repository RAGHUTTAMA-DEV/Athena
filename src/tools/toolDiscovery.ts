import { Tool } from './toolTypes.js';
import { SearchableToolRegistry } from './toolRegistry.js';
import { PolicyEngine } from '../security/policyEngine.js';

export interface ToolDiscoveryOptions {
  maxTools?: number;
  maxPromptTokens?: number;
  recentContext?: string;
  isBackground?: boolean;
  policyEngine?: PolicyEngine;
  forcedTools?: string[];
}

export class ToolDiscoveryPipeline {
  private static capabilityKeywords: Record<string, string[]> = {
    'fs:read': ['read', 'view', 'cat', 'open', 'inspect', 'file', 'content', 'grep', 'search', 'find'],
    'fs:write': ['write', 'edit', 'replace', 'modify', 'save', 'update', 'delete', 'remove', 'move', 'copy'],
    'cmd:exec': ['run', 'exec', 'execute', 'terminal', 'shell', 'command', 'bash', 'powershell', 'npm', 'git', 'node', 'python'],
    'net:http': ['search', 'google', 'web', 'fetch', 'url', 'http', 'api', 'curl', 'query'],
    'browser': ['browser', 'navigate', 'click', 'page', 'screenshot', 'dom', 'form', 'webpage'],
    'system': ['cron', 'schedule', 'timer', 'reminder', 'background', 'skill', 'delegate', 'routine', 'routines', 'automate', 'automated', 'workflow', 'standing', 'multiagent', 'multi-agent', 'specialist', 'researcher', 'coder', 'reviewer', 'planner', 'agent', 'agents', 'pipeline', 'handoff', 'mailbox'],
    'memory': ['remember', 'memory', 'recall', 'fact', 'preference', 'store'],
    'research': ['research', 'investigate', 'cite', 'sources', 'report', 'corroborate', 'evidence', 'documents', 'document', 'pdf', 'docx', 'xlsx', 'csv', 'ingest', 'rag', 'knowledge', 'read', 'summarize'],
    'computer': ['computer', 'desktop', 'window', 'windows', 'screen', 'screenshot', 'mouse', 'keyboard', 'click', 'type', 'scroll', 'accessibility', 'tree', 'hwnd', 'foreground', 'focus', 'drag', 'button', 'display', 'resolution']
  };

  /**
   * Stage 1: Detect required capabilities from task intent and context.
   */
  public static detectCapabilities(intent: string, recentContext?: string): string[] {
    const combined = `${intent} ${recentContext || ''}`.toLowerCase();
    const detected: Set<string> = new Set();

    for (const [capability, keywords] of Object.entries(this.capabilityKeywords)) {
      for (const kw of keywords) {
        const regex = new RegExp(`\\b${kw}\\b`, 'i');
        if (regex.test(combined)) {
          detected.add(capability);
          break;
        }
      }
    }

    return Array.from(detected);
  }

  /**
   * Estimates tokens of a tool definition schema.
   */
  private static estimateToolTokens(tool: Tool): number {
    const jsonStr = JSON.stringify(tool.definition);
    return Math.ceil(jsonStr.length / 4);
  }

  /**
   * Executes the full 5-stage discovery pipeline:
   * 1. Capability Detection
   * 2. Search & Discovery
   * 3. Ranking
   * 4. Permission & Security Filtering
   * 5. Bounded Prompt Budgeting
   */
  public static discover(
    registry: SearchableToolRegistry,
    intent: string,
    options?: ToolDiscoveryOptions
  ): Tool[] {
    const maxTools = options?.maxTools || 15;
    const maxPromptTokens = options?.maxPromptTokens || 2000;
    const policyEngine = options?.policyEngine || PolicyEngine.getInstance();
    const forcedTools = new Set(options?.forcedTools || []);

    // If registry is very small (<= 5 tools), return all permitted tools
    if (registry.size() <= 5) {
      return registry.getAll().filter(t => {
        const check = policyEngine.evaluateToolCall(t.definition.name, {}, t.manifest?.permissions, {
          isBackground: options?.isBackground
        });
        return check.allowed;
      });
    }

    // Stage 1: Capability Detection
    const capabilities = this.detectCapabilities(intent, options?.recentContext);

    // Stage 2: Search & Discovery
    const scored = registry.search(intent, {
      limit: Math.max(maxTools * 2, 30),
      capabilities
    });

    // Stage 3: Ranking
    const rankedTools: Tool[] = [];
    const seenNames = new Set<string>();

    // Always include forced tools first if registered
    for (const forced of forcedTools) {
      const tool = registry.get(forced);
      if (tool && !seenNames.has(tool.definition.name)) {
        rankedTools.push(tool);
        seenNames.add(tool.definition.name);
      }
    }

    const topScore = scored.length > 0 ? scored[0].score : 0;
    const minThreshold = Math.max(2.0, topScore * 0.35);
    const relevantScored = scored.filter(item => {
      if (item.score < minThreshold) return false;
      const isDestructive = item.tool.manifest?.riskLevel === 'destructive' || item.tool.definition.risk === 'destructive';
      const hasExecPermission = item.tool.manifest?.permissions?.includes('cmd:exec') || item.tool.definition.capabilities?.includes('cmd:exec');
      if (isDestructive && !hasExecPermission && !/\b(delete|remove|destroy|kill|rm|drop|erase)\b/i.test(intent)) {
        return false;
      }
      return true;
    });

    for (const item of relevantScored) {
      if (!seenNames.has(item.tool.definition.name)) {
        rankedTools.push(item.tool);
        seenNames.add(item.tool.definition.name);
      }
    }

    // Fallback: If no tools matched, pull core tools
    if (rankedTools.length < 3) {
      for (const t of registry.getAll().slice(0, 5)) {
        if (!seenNames.has(t.definition.name)) {
          rankedTools.push(t);
          seenNames.add(t.definition.name);
        }
      }
    }

    // Stage 4: Permission & Security Filtering
    const permittedTools: Tool[] = [];
    for (const tool of rankedTools) {
      const check = policyEngine.evaluateToolCall(
        tool.definition.name,
        {},
        tool.manifest?.permissions,
        { isBackground: options?.isBackground }
      );
      if (check.allowed) {
        permittedTools.push(tool);
      }
    }

    // Stage 5: Bounded Prompt Budgeting
    const selected: Tool[] = [];
    let currentTokens = 0;

    for (const tool of permittedTools) {
      if (selected.length >= maxTools) break;

      const toolTokens = this.estimateToolTokens(tool);
      if (currentTokens + toolTokens <= maxPromptTokens || selected.length < 3) {
        selected.push(tool);
        currentTokens += toolTokens;
      }
    }

    return selected;
  }
}
