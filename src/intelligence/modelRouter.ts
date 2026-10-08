import { ProviderType } from '../runtime/types.js';
import { ModelCategory, ModelPolicy, RouterDecision } from './types.js';

export interface ModelPolicyConfig extends Partial<ModelPolicy> {
  model?: string;
  provider?: ProviderType;
  maxCostPer1kTokens?: number;
}

export interface ModelRouterOptions {
  enabled?: boolean;
  defaultProvider?: ProviderType;
  defaultModel?: string;
  policies?: Partial<Record<ModelCategory, ModelPolicyConfig>>;
}

export interface RouteParams {
  intent?: string;
  prompt?: string;
  taskType?: string;
  complexity?: string;
  tags?: string[];
  hasImages?: boolean;
  needsVision?: boolean;
  hasCode?: boolean;
  forceCategory?: ModelCategory;
}

export interface BenchmarkItem {
  id: string;
  prompt: string;
  expectedCategory: ModelCategory;
  difficulty?: number;
  needsVision?: boolean;
}

export interface BenchmarkResult {
  totalQueries: number;
  accuracy: number;
  baselineCost: number;
  routedCost: number;
  costReductionPercent: number;
  qualityDropPercent: number;
}

export const DEFAULT_MODEL_POLICIES: Record<ModelCategory, ModelPolicy> = {
  fast: {
    category: 'fast',
    preferredModel: 'gemini-2.5-flash',
    preferredProvider: 'gemini',
    requiredCapabilities: ['tool_use'],
    maxCostPerCallUsd: 0.0005,
    latencyTargetMs: 800
  },
  cheap: {
    category: 'cheap',
    preferredModel: 'gemini-2.5-flash',
    preferredProvider: 'gemini',
    requiredCapabilities: ['tool_use'],
    maxCostPerCallUsd: 0.0005,
    latencyTargetMs: 1000
  },
  normal: {
    category: 'normal',
    preferredModel: 'gemini-2.5-flash',
    preferredProvider: 'gemini',
    requiredCapabilities: ['tool_use'],
    maxCostPerCallUsd: 0.002,
    latencyTargetMs: 1500
  },
  reasoning: {
    category: 'reasoning',
    preferredModel: 'gemini-2.5-pro',
    preferredProvider: 'gemini',
    requiredCapabilities: ['tool_use', 'deep_reasoning'],
    maxCostPerCallUsd: 0.02,
    latencyTargetMs: 4000
  },
  coding: {
    category: 'coding',
    preferredModel: 'gemini-2.5-pro',
    preferredProvider: 'gemini',
    requiredCapabilities: ['tool_use', 'coding'],
    maxCostPerCallUsd: 0.015,
    latencyTargetMs: 3000
  },
  vision: {
    category: 'vision',
    preferredModel: 'gemini-2.5-flash',
    preferredProvider: 'gemini',
    requiredCapabilities: ['vision'],
    maxCostPerCallUsd: 0.003,
    latencyTargetMs: 2000
  },
  high_accuracy: {
    category: 'high_accuracy',
    preferredModel: 'gemini-2.5-pro',
    preferredProvider: 'gemini',
    requiredCapabilities: ['tool_use', 'deep_reasoning'],
    maxCostPerCallUsd: 0.03,
    latencyTargetMs: 5000
  }
};

export class ModelRouter {
  private enabled: boolean;
  private defaultProvider: ProviderType;
  private defaultModel: string;
  private policies: Record<ModelCategory, ModelPolicy>;

  constructor(options?: ModelRouterOptions) {
    this.enabled = options?.enabled ?? false;
    this.defaultProvider = options?.defaultProvider || (process.env.LLM_PROVIDER as ProviderType) || 'gemini';
    this.defaultModel = options?.defaultModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash';

    this.policies = { ...DEFAULT_MODEL_POLICIES };
    if (options?.policies) {
      for (const [cat, p] of Object.entries(options.policies)) {
        if (!p) continue;
        const categoryKey = cat as ModelCategory;
        const base = this.policies[categoryKey] || DEFAULT_MODEL_POLICIES.normal;
        this.policies[categoryKey] = {
          ...base,
          category: categoryKey,
          preferredModel: p.model || p.preferredModel || base.preferredModel,
          preferredProvider: p.provider || p.preferredProvider || base.preferredProvider,
          maxCostPerCallUsd: p.maxCostPer1kTokens !== undefined ? p.maxCostPer1kTokens : (p.maxCostPerCallUsd ?? base.maxCostPerCallUsd)
        };
      }
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(val: boolean): void {
    this.enabled = val;
  }

  getPolicy(category: ModelCategory): ModelPolicy {
    return this.policies[category] || this.policies.normal;
  }

  setPolicy(category: ModelCategory, policy: ModelPolicy): void {
    this.policies[category] = policy;
  }

  /**
   * Routes a task to the optimal model and provider.
   * If routing is disabled (default), returns the user's single configured model and provider.
   */
  route(params: RouteParams): RouterDecision {
    const rawText = params.intent || params.prompt || '';

    // Default: Single model operation if routing is disabled
    if (!this.enabled && !params.forceCategory) {
      return {
        category: 'normal',
        selectedModel: this.defaultModel,
        selectedProvider: this.defaultProvider,
        model: this.defaultModel,
        provider: this.defaultProvider,
        reason: 'Routing disabled, using default single model'
      };
    }

    // Determine target category
    let category: ModelCategory = params.forceCategory || 'normal';

    if (!params.forceCategory) {
      const intentLower = rawText.toLowerCase();
      const hasImages = params.hasImages || params.needsVision;
      const hasCode = params.hasCode || params.taskType === 'coding';

      if (hasImages || /\b(image|screenshot|photo|diagram|visual|ocr)\b/i.test(intentLower)) {
        category = 'vision';
      } else if (hasCode || /\b(refactor|implement|code|bug|function|class|typescript|python|compile|fix|fibonacci|traversal|rust)\b/i.test(intentLower)) {
        category = 'coding';
      } else if (params.complexity === 'complex' || /\b(architect|decompose|multi-agent|plan|evaluate|verify|step by step|prove|irrational)\b/i.test(intentLower)) {
        category = 'reasoning';
      } else if (params.complexity === 'simple' || /\b(hi|hello|what is|time|status|ping|echo|calculate)\b/i.test(intentLower)) {
        category = 'fast';
      } else if (/\b(summarize|tldr|briefly|gist)\b/i.test(intentLower) || params.tags?.includes('background') || params.tags?.includes('heartbeat')) {
        category = 'cheap';
      }
    }

    const policy = this.getPolicy(category);

    return {
      category,
      selectedModel: policy.preferredModel,
      selectedProvider: policy.preferredProvider,
      model: policy.preferredModel,
      provider: policy.preferredProvider,
      reason: `Routed to category [${category}] based on task intent and requirements`,
      estimatedCostUsd: policy.maxCostPerCallUsd
    };
  }

  estimateCost(category: ModelCategory, inputTokens: number, outputTokens: number): number {
    const policy = this.getPolicy(category);
    // If local provider (e.g. ollama), cost is zero
    if (policy.preferredProvider === 'ollama') {
      return 0;
    }
    const ratePer1k = policy.maxCostPerCallUsd ?? 0.002;
    return ((inputTokens + outputTokens) / 1000) * ratePer1k;
  }

  runBenchmark(benchmarks: BenchmarkItem[]): BenchmarkResult {
    let correctCount = 0;
    let baselineCost = 0;
    let routedCost = 0;

    // Baseline uses reasoning / pro model for every request ($0.02 / call)
    const baselinePerQuery = 0.02;

    for (const item of benchmarks) {
      baselineCost += baselinePerQuery;
      const decision = this.route({
        prompt: item.prompt,
        needsVision: item.needsVision
      });

      if (decision.category === item.expectedCategory) {
        correctCount++;
      }

      // Cost for routed decision
      const cost = this.estimateCost(decision.category, 500, 200);
      routedCost += cost;
    }

    const accuracy = correctCount / benchmarks.length;
    const costReductionPercent = baselineCost > 0
      ? ((baselineCost - routedCost) / baselineCost) * 100
      : 0;

    // Quality drop: 100% accuracy = 0% drop
    const qualityDropPercent = Math.max(0, (1 - accuracy) * 100);

    return {
      totalQueries: benchmarks.length,
      accuracy,
      baselineCost,
      routedCost,
      costReductionPercent,
      qualityDropPercent
    };
  }
}
