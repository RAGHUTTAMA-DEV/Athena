import { Router } from 'express';
import { ArtifactService } from '../services/artifactService.js';
import { ArtifactsController } from '../controllers/artifactsController.js';

export function registerArtifactsRoutes(
  app: Router,
  services: { artifactService: ArtifactService }
) {
  const controller = new ArtifactsController(services.artifactService);

  app.get('/api/v1/artifacts', controller.listArtifacts);
  app.get('/api/v1/artifacts/:artifactId', controller.getArtifact);
  app.get('/api/v1/artifacts/:artifactId/versions', controller.getVersions);
  app.get('/api/v1/artifacts/:artifactId/diff', controller.computeDiff);
  app.get('/api/v1/artifacts/:artifactId/raw', controller.getRawContent);
}
