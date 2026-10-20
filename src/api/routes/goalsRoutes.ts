import { Router } from 'express';
import { GoalsController } from '../controllers/goalsController.js';

export function registerGoalsRoutes(app: Router, services: { stores: any }) {
  const controller = new GoalsController(services.stores);

  app.get('/api/v1/goals', controller.listGoals);
  app.post('/api/v1/goals', controller.createGoal);
  app.get('/api/v1/goals/:goalId', controller.getGoal);
  app.get('/api/v1/goals/:goalId/tasks', controller.getGoalTasks);
  app.post('/api/v1/goals/:goalId/pause', controller.pauseGoal);
  app.post('/api/v1/goals/:goalId/resume', controller.resumeGoal);
}
