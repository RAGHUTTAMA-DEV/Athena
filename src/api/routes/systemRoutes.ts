import { Router } from 'express';
import { InitializedStorage } from '../../storage/storeFactory.js';
import { SystemController } from '../controllers/systemController.js';

export function registerSystemRoutes(
  app: Router,
  services: { storage: InitializedStorage }
) {
  const controller = new SystemController(services.storage);

  app.get('/health/live', controller.getLiveness);
  app.get('/health/ready', controller.getReadiness);
  app.get('/api/v1/system/capabilities', controller.listCapabilities);
  app.get('/api/v1/system/policy', controller.getPolicy);
}
