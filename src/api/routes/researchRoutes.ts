import { Router } from 'express';
import { ResearchController } from '../controllers/researchController.js';

export function registerResearchRoutes(app: Router, services: { stores: any }) {
  const controller = new ResearchController(services.stores);

  app.get('/api/v1/research/documents', controller.listDocuments);
  app.post('/api/v1/research/documents/upload', controller.uploadDocument);
  app.post('/api/v1/research/search', controller.search);
  app.get('/api/v1/research/vectors/stats', controller.getVectorStats);
}
