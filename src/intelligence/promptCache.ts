import * as crypto from 'crypto';
import { Message } from '../runtime/types.js';

export interface PromptCachePrefix {
  systemPrompt: string;
  staticDirectives?: string;
  skillsBlock?: string;
  toolsJson?: string;
}

export interface CachedPromptRequest {
  systemPrompt: string;
  toolsJson?: string;
  conversationHistory?: Message[] | Array<{ role: string; content: string }>;
  turnPrompt: string;
}

export interface PromptUsageRecord {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  costWithoutCache: number;
  actualCost: number;
}

export interface PromptCacheTelemetry {
  totalRequests: number;
  cacheHits: number;
  cacheMisses: number;
  cachedTokensSaved: number;
  totalSavingsUSD: number;
}

export class PromptCacheManager {
  private knownPrefixes: Set<string> = new Set();
  private telemetry: PromptCacheTelemetry = {
    totalRequests: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cachedTokensSaved: 0,
    totalSavingsUSD: 0
  };

  /**
   * Assembles a structured prompt ensuring a stable prefix across turns.
   * Providers with prompt caching (Gemini, Claude, OpenAI) hit cache on stable prefixes.
   */
  static assembleStablePrefix(parts: PromptCachePrefix): { prefixText: string; prefixHash: string } {
    const blocks: string[] = [];

    if (parts.systemPrompt) {
      blocks.push(`[CORE SYSTEM]\n${parts.systemPrompt.trim()}`);
    }
    if (parts.staticDirectives) {
      blocks.push(`[SAFETY & DIRECTIVES]\n${parts.staticDirectives.trim()}`);
    }
    if (parts.skillsBlock) {
      blocks.push(`[PROCEDURAL SKILLS]\n${parts.skillsBlock.trim()}`);
    }
    if (parts.toolsJson) {
      blocks.push(`[TOOLS SPEC]\n${parts.toolsJson.trim()}`);
    }

    const prefixText = blocks.join('\n\n---\n\n');
    const prefixHash = crypto.createHash('sha256').update(prefixText).digest('hex');

    return { prefixText, prefixHash };
  }

  /**
   * Computes estimated cache hit savings.
   */
  static estimateSavings(totalInputTokens: number, cachedTokens: number): {
    savingsPercentage: number;
    effectiveTokens: number;
  } {
    if (totalInputTokens <= 0) return { savingsPercentage: 0, effectiveTokens: 0 };
    const effectiveTokens = Math.max(0, totalInputTokens - cachedTokens * 0.75); // 75% discount
    const savingsPercentage = Number((((totalInputTokens - effectiveTokens) / totalInputTokens) * 100).toFixed(1));

    return { savingsPercentage, effectiveTokens };
  }

  assembleCachedPrompt(req: CachedPromptRequest): {
    fullPrompt: string;
    prefixHash: string;
    cacheHit: boolean;
  } {
    const { prefixText, prefixHash } = PromptCacheManager.assembleStablePrefix({
      systemPrompt: req.systemPrompt,
      toolsJson: req.toolsJson
    });

    const isHit = this.knownPrefixes.has(prefixHash);
    if (!isHit) {
      this.knownPrefixes.add(prefixHash);
      this.telemetry.cacheMisses++;
    } else {
      this.telemetry.cacheHits++;
    }
    this.telemetry.totalRequests++;

    const historyStr = (req.conversationHistory || [])
      .map(m => {
        const anyM = m as any;
        let text = '';
        if (typeof anyM.content === 'string') {
          text = anyM.content;
        } else if (Array.isArray(anyM.parts)) {
          text = anyM.parts.map((p: any) => p.text || '').join('');
        } else {
          text = JSON.stringify(anyM.content || anyM.parts || '');
        }
        return `[${anyM.role.toUpperCase()}]: ${text}`;
      })
      .join('\n');

    const fullPrompt = `${prefixText}\n\n[CONVERSATION]\n${historyStr}\n\n[USER TURN]\n${req.turnPrompt}`;

    return {
      fullPrompt,
      prefixHash,
      cacheHit: isHit
    };
  }

  recordUsage(usage: PromptUsageRecord): void {
    this.telemetry.cachedTokensSaved += usage.cachedTokens;
    const savings = Math.max(0, usage.costWithoutCache - usage.actualCost);
    this.telemetry.totalSavingsUSD += savings;
  }

  getTelemetry(): PromptCacheTelemetry {
    return { ...this.telemetry };
  }
}
