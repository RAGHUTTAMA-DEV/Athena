import { Router } from 'express';
import { ComputerPlatformController } from '../controllers/computerController.js';

export function registerComputerRoutes(app: Router) {
  const controller = new ComputerPlatformController();

  app.get('/api/v1/computer/screen', controller.inspectScreen);
  app.get('/api/v1/computer/windows', controller.listWindows);
  app.post('/api/v1/computer/focus', controller.focusWindow);
}
