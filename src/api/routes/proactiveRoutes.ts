import { Router } from 'express';
import { ProactiveController } from '../controllers/proactiveController.js';

export function registerProactiveRoutes(app: Router, services: { stores: any }) {
  const controller = new ProactiveController(services.stores);

  app.get('/api/v1/proactive/heartbeats', controller.getHeartbeats);
  app.get('/api/v1/proactive/events', controller.listEvents);
  app.post('/api/v1/proactive/events/:id/retry', controller.retryEvent);
  app.get('/api/v1/proactive/webhooks', controller.listWebhooks);
  app.post('/api/v1/webhooks/incoming/:endpointId', controller.receiveWebhook);
}
