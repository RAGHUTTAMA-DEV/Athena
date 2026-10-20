import { Request, Response } from 'express';
import { SSEManager } from '../events/sseManager.js';
import { createEventEnvelope } from '../events/eventEnvelope.js';

export class RunsController {
  constructor(
    private services: {
      stores: any;
      sse: SSEManager;
    }
  ) {}

  getRun = async (req: Request, res: Response): Promise<void> => {
    try {
      const run = await this.services.stores.run.get(req.params.runId);
      if (!run) {
        res.status(404).json({
          error: {
            code: 'RUN_NOT_FOUND',
            message: `Run not found: ${req.params.runId}`,
            requestId: req.id
          }
        });
        return;
      }
      res.json(run);
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'RUN_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  abortRun = async (req: Request, res: Response): Promise<void> => {
    try {
      const run = await this.services.stores.run.get(req.params.runId);
      if (!run) {
        res.status(404).json({
          error: { code: 'RUN_NOT_FOUND', message: `Run not found: ${req.params.runId}`, requestId: req.id }
        });
        return;
      }

      await this.services.stores.run.update(req.params.runId, {
        status: 'cancelled',
        terminationReason: 'user_cancelled'
      });

      this.services.sse.broadcast(
        createEventEnvelope(
          'run.cancellation_requested',
          { runId: req.params.runId, reason: 'user_cancelled' },
          { runId: req.params.runId, sessionId: run.sessionId }
        )
      );

      res.json({ runId: req.params.runId, status: 'cancelled' });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'RUN_ABORT_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  getEvents = async (req: Request, res: Response): Promise<void> => {
    const lastEventId = (req.headers['last-event-id'] || req.query.lastEventId) as string | undefined;
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.services.sse.registerClient(clientId, res, {
      runId: req.params.runId,
      lastEventId
    });
  };

  getReplay = async (req: Request, res: Response): Promise<void> => {
    try {
      const steps = await this.services.stores.replay.getSteps(req.params.runId);
      res.json({
        runId: req.params.runId,
        stepCount: steps.length,
        steps
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'REPLAY_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
