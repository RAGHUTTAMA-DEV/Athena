import { Request, Response } from 'express';
import { CodingHarnessBridge } from '../../harness/codingHarness.js';
import { promisify } from 'util';
import { exec } from 'child_process';

const execPromise = promisify(exec);

export class HarnessController {
  private harness = CodingHarnessBridge.getInstance();

  getStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const cwd = (req.query.cwd as string) || process.cwd();
      const info = await this.harness.inspectRepo(cwd);
      res.json(info);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'HARNESS_STATUS_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  createSnapshot = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.label) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "label" is required', requestId: req.id }
        });
        return;
      }
      const cwd = req.body.cwd || process.cwd();
      const snapshotId = await this.harness.createSnapshot(cwd, req.body.label);
      res.json({ success: Boolean(snapshotId), snapshotId });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'SNAPSHOT_CREATE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  rollback = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!req.body?.snapshotId) {
        res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Field "snapshotId" is required', requestId: req.id }
        });
        return;
      }
      const cwd = req.body.cwd || process.cwd();
      const ok = await this.harness.rollbackSnapshot(cwd, req.body.snapshotId);
      res.json({ success: ok, snapshotId: req.body.snapshotId });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'ROLLBACK_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getDiff = async (req: Request, res: Response): Promise<void> => {
    const cwd = (req.query.cwd as string) || process.cwd();
    try {
      const { stdout } = await execPromise('git diff', { cwd, timeout: 5000 });
      res.json({ diff: stdout });
    } catch (e: any) {
      res.json({ diff: '', error: e.message });
    }
  };
}
