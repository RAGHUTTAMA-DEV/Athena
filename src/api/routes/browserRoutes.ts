import { Router } from 'express';
import { BrowserController } from '../controllers/browserController.js';

export function registerBrowserRoutes(app: Router, services: { stores: any }) {
  const controller = new BrowserController(services.stores);

  app.get('/api/v1/browser/profiles', controller.listProfiles);
  app.get('/api/v1/browser/sessions/:id', controller.getSession);
  app.get('/api/v1/browser/sessions/:id/snapshot', controller.getSnapshot);
}
