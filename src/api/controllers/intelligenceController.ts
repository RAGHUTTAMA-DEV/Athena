import { Request, Response } from 'express';
import { DEFAULT_MODEL_POLICIES } from '../../intelligence/modelRouter.js';
import { PromptCacheManager } from '../../intelligence/promptCache.js';

export class IntelligenceController {
  private cacheManager = new PromptCacheManager();

  constructor(private stores?: any) {}

  listModels = async (req: Request, res: Response): Promise<void> => {
    try {
      const policies = Object.entries(DEFAULT_MODEL_POLICIES).map(([category, policy]) => ({
        category,
        model: policy.preferredModel,
        fallbackModel: policy.fallbackModel,
        provider: policy.preferredProvider,
        requiredCapabilities: policy.requiredCapabilities || [],
        maxCostPerCallUsd: policy.maxCostPerCallUsd,
        latencyTargetMs: policy.latencyTargetMs
      }));

      // Deduplicate distinct models for API consumer
      const distinctModelsMap = new Map<string, any>();
      for (const p of policies) {
        if (!distinctModelsMap.has(p.model)) {
          distinctModelsMap.set(p.model, {
            id: p.model,
            provider: p.provider,
            categories: [p.category],
            maxCostPerCallUsd: p.maxCostPerCallUsd,
            latencyTargetMs: p.latencyTargetMs,
            active: true
          });
        } else {
          distinctModelsMap.get(p.model).categories.push(p.category);
        }
      }

      res.json({
        models: Array.from(distinctModelsMap.values()),
        policies
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'MODELS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getCacheStats = async (req: Request, res: Response): Promise<void> => {
    try {
      const telemetry = this.cacheManager.getTelemetry();
      const total = telemetry.totalRequests;
      const hitRate = total > 0 ? Number((telemetry.cacheHits / total).toFixed(3)) : 0;

      res.json({
        totalRequests: telemetry.totalRequests,
        hits: telemetry.cacheHits,
        misses: telemetry.cacheMisses,
        hitRate,
        tokensSaved: telemetry.cachedTokensSaved,
        costSavingsUsd: Number(telemetry.totalSavingsUSD.toFixed(4))
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'CACHE_STATS_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getTelemetryMetrics = async (req: Request, res: Response): Promise<void> => {
    try {
      let totalRuns = 0;
      let completedRuns = 0;

      if (this.stores?.run) {
        try {
          const runs = await this.stores.run.list({ limit: 500 });
          totalRuns = runs.length;
          completedRuns = runs.filter((r: any) => r.status === 'completed').length;
        } catch {
          // If storage uninitialized or empty, keep defaults
        }
      }

      const successRate = totalRuns > 0 ? Number((completedRuns / totalRuns).toFixed(2)) : 1.0;

      res.json({
        metrics: {
          uptimeSeconds: Math.floor(process.uptime()),
          memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
          totalRunsExecuted: totalRuns,
          completedRuns,
          runSuccessRate: successRate,
          nodeVersion: process.version,
          platform: process.platform
        }
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'TELEMETRY_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
