import { TokenUsageRecord } from './memoryTypes.js';

export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
}

export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  // Gemini 2.0 / 1.5
  'gemini-2.0-flash': { inputPerMillion: 0.10, outputPerMillion: 0.40, cachedInputPerMillion: 0.025 },
  'gemini-1.5-flash': { inputPerMillion: 0.075, outputPerMillion: 0.30, cachedInputPerMillion: 0.01875 },
  'gemini-1.5-pro': { inputPerMillion: 1.25, outputPerMillion: 5.00, cachedInputPerMillion: 0.3125 },
  // OpenAI
  'gpt-4o': { inputPerMillion: 2.50, outputPerMillion: 10.00, cachedInputPerMillion: 1.25 },
  'gpt-4o-mini': { inputPerMillion: 0.15, outputPerMillion: 0.60, cachedInputPerMillion: 0.075 },
  // Anthropic Claude
  'claude-3-5-sonnet': { inputPerMillion: 3.00, outputPerMillion: 15.00, cachedInputPerMillion: 0.30 },
  'claude-3-5-haiku': { inputPerMillion: 0.80, outputPerMillion: 4.00, cachedInputPerMillion: 0.08 },
  // Local / Default
  'default': { inputPerMillion: 0.50, outputPerMillion: 1.50, cachedInputPerMillion: 0.10 }
};

export interface CumulativeTokenUsage {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalLatencyMs: number;
  totalCostUsd: number;
}

export class TokenAccountant {
  private records: TokenUsageRecord[] = [];
  private pricingTable: Record<string, ModelPricing>;

  constructor(customPricing?: Record<string, ModelPricing>) {
    this.pricingTable = { ...DEFAULT_MODEL_PRICING, ...customPricing };
  }

  public calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    cachedTokens: number = 0
  ): number {
    const key = Object.keys(this.pricingTable).find(k => model.toLowerCase().includes(k)) || 'default';
    const pricing = this.pricingTable[key];

    const standardInputTokens = Math.max(0, inputTokens - cachedTokens);
    const standardInputCost = (standardInputTokens / 1_000_000) * pricing.inputPerMillion;
    const cachedInputCost = (cachedTokens / 1_000_000) * (pricing.cachedInputPerMillion ?? pricing.inputPerMillion * 0.25);
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;

    return Number((standardInputCost + cachedInputCost + outputCost).toFixed(6));
  }

  public recordUsage(record: {
    callId?: string;
    runId?: string;
    goalId?: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens?: number;
    latencyMs?: number;
  }): TokenUsageRecord {
    const cachedTokens = record.cachedTokens || 0;
    const latencyMs = record.latencyMs || 0;
    const costUsd = this.calculateCost(record.model, record.inputTokens, record.outputTokens, cachedTokens);

    const fullRecord: TokenUsageRecord = {
      callId: record.callId || `call_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      runId: record.runId,
      goalId: record.goalId,
      model: record.model,
      inputTokens: record.inputTokens,
      outputTokens: record.outputTokens,
      cachedTokens,
      latencyMs,
      costUsd,
      timestamp: Date.now()
    };

    this.records.push(fullRecord);
    return fullRecord;
  }

  public getRunUsage(runId: string): CumulativeTokenUsage {
    return this.aggregate(this.records.filter(r => r.runId === runId));
  }

  public getGoalUsage(goalId: string): CumulativeTokenUsage {
    return this.aggregate(this.records.filter(r => r.goalId === goalId));
  }

  public getTotalUsage(): CumulativeTokenUsage {
    return this.aggregate(this.records);
  }

  public getRecords(): TokenUsageRecord[] {
    return [...this.records];
  }

  private aggregate(records: TokenUsageRecord[]): CumulativeTokenUsage {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCachedTokens = 0;
    let totalLatencyMs = 0;
    let totalCostUsd = 0;

    for (const r of records) {
      totalInputTokens += r.inputTokens;
      totalOutputTokens += r.outputTokens;
      totalCachedTokens += r.cachedTokens;
      totalLatencyMs += r.latencyMs;
      totalCostUsd += r.costUsd;
    }

    return {
      totalCalls: records.length,
      totalInputTokens,
      totalOutputTokens,
      totalCachedTokens,
      totalLatencyMs,
      totalCostUsd: Number(totalCostUsd.toFixed(6))
    };
  }
}
