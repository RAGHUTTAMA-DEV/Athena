import { Router } from 'express';
import { MultiagentController } from '../controllers/multiagentController.js';

export function registerMultiagentRoutes(app: Router, services: { stores: any }) {
  const controller = new MultiagentController(services.stores);

  app.get('/api/v1/teams', controller.listTeams);
  app.post('/api/v1/teams', controller.createTeam);
  app.get('/api/v1/teams/:id', controller.getTeam);
  app.get('/api/v1/agents/messages', controller.listMessages);
  app.post('/api/v1/agents/messages', controller.sendMessage);
}
