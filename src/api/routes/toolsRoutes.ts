import { Router } from 'express';
import { ToolsController } from '../controllers/toolsController.js';

export function registerToolsRoutes(app: Router) {
  const controller = new ToolsController();

  app.get('/api/v1/tools', controller.listTools);
  app.get('/api/v1/mcp/servers', controller.listMcpServers);
  app.post('/api/v1/mcp/servers', controller.registerMcpServer);
}
