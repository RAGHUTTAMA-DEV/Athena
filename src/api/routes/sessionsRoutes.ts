import { Router } from 'express';
import { DispatchService } from '../services/dispatchService.js';
import { HydrationService } from '../services/hydrationService.js';
import { SSEManager } from '../events/sseManager.js';
import { SessionsController } from '../controllers/sessionsController.js';

export function registerSessionsRoutes(
  app: Router,
  services: { dispatch: DispatchService; hydration: HydrationService; sse: SSEManager; stores: any }
) {
  const controller = new SessionsController(services);

  app.post('/api/v1/sessions/:sessionId/messages', controller.submitMessage);
  app.get('/api/v1/sessions/:sessionId/state', controller.getState);
  app.get('/api/v1/sessions/:sessionId/events', controller.getEvents);
  app.get('/api/v1/sessions', controller.listSessions);
}
