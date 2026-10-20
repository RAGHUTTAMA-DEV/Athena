import { Router } from 'express';
import { HarnessController } from '../controllers/harnessController.js';

export function registerHarnessRoutes(app: Router) {
  const controller = new HarnessController();

  app.get('/api/v1/harness/status', controller.getStatus);
  app.post('/api/v1/harness/snapshots', controller.createSnapshot);
  app.post('/api/v1/harness/rollback', controller.rollback);
  app.get('/api/v1/harness/diff', controller.getDiff);
}
