import { Router } from 'express';
import { IntelligenceController } from '../controllers/intelligenceController.js';

export function registerIntelligenceRoutes(app: Router, services?: { stores?: any }) {
  const controller = new IntelligenceController(services?.stores);

  app.get('/api/v1/intelligence/models', controller.listModels);
  app.get('/api/v1/intelligence/cache/stats', controller.getCacheStats);
  app.get('/api/v1/telemetry/metrics', controller.getTelemetryMetrics);
}
