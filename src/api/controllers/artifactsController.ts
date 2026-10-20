import { Request, Response } from 'express';
import { ArtifactService } from '../services/artifactService.js';

export class ArtifactsController {
  constructor(private artifactService: ArtifactService) {}

  listArtifacts = async (req: Request, res: Response): Promise<void> => {
    try {
      const list = await this.artifactService.list(req.query);
      res.json({ artifacts: list, count: list.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'ARTIFACTS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getArtifact = async (req: Request, res: Response): Promise<void> => {
    try {
      const art = await this.artifactService.get(req.params.artifactId);
      res.json(art);
    } catch (err: any) {
      res.status(404).json({
        error: { code: 'ARTIFACT_NOT_FOUND', message: err.message, requestId: req.id }
      });
    }
  };

  getVersions = async (req: Request, res: Response): Promise<void> => {
    try {
      const versions = await this.artifactService.getVersions(req.params.artifactId);
      res.json({ artifactId: req.params.artifactId, versions });
    } catch (err: any) {
      res.status(404).json({
        error: { code: 'ARTIFACT_NOT_FOUND', message: err.message, requestId: req.id }
      });
    }
  };

  computeDiff = async (req: Request, res: Response): Promise<void> => {
    try {
      const fromV = parseInt(String(req.query.fromVersion), 10);
      const toV = parseInt(String(req.query.toVersion), 10);
      const diffResult = await this.artifactService.computeDiff(req.params.artifactId, fromV, toV);
      res.json(diffResult);
    } catch (err: any) {
      res.status(400).json({
        error: { code: 'DIFF_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getRawContent = async (req: Request, res: Response): Promise<void> => {
    try {
      const rawData = await this.artifactService.getRawContent(req.params.artifactId);
      res.setHeader('Content-Type', rawData.mimeType);
      res.send(rawData.content);
    } catch (err: any) {
      res.status(404).json({
        error: { code: 'RAW_ARTIFACT_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
