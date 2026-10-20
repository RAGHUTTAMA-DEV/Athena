import { Router } from 'express';
import { SSEManager } from '../events/sseManager.js';
import { RunsController } from '../controllers/runsController.js';

export function registerRunsRoutes(
  app: Router,
  services: { stores: any; sse: SSEManager }
) {
  const controller = new RunsController(services);

  app.get('/api/v1/runs/:runId', controller.getRun);
  app.post('/api/v1/runs/:runId/abort', controller.abortRun);
  app.get('/api/v1/runs/:runId/events', controller.getEvents);
  app.get('/api/v1/runs/:runId/replay', controller.getReplay);
}
