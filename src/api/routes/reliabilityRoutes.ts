import { Router } from 'express';
import { ReliabilityController } from '../controllers/reliabilityController.js';

export function registerReliabilityRoutes(app: Router) {
  const controller = new ReliabilityController();

  app.post('/api/v1/reliability/verify', controller.verify);
  app.post('/api/v1/reliability/repair', controller.repair);
  app.post('/api/v1/reliability/clarifications/assess', controller.assessClarification);
  app.get('/api/v1/reliability/clarifications/pending', controller.getPendingClarifications);
  app.post('/api/v1/reliability/clarifications/:id/answer', controller.answerClarification);
}
