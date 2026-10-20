import { Router } from 'express';
import { LearningController } from '../controllers/learningController.js';

export function registerLearningRoutes(app: Router, services: { stores: any }) {
  const controller = new LearningController(services.stores);

  app.get('/api/v1/learning/skills', controller.listSkills);
  app.get('/api/v1/learning/workflows', controller.listWorkflows);
  app.post('/api/v1/learning/workflows/:id/review', controller.reviewWorkflow);
  app.get('/api/v1/learning/routines', controller.listRoutines);
  app.post('/api/v1/learning/routines', controller.createRoutine);
}
