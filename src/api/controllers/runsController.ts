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

  listRuns = async (req: Request, res: Response): Promise<void> => {
    try {
      const sessionId = req.query.sessionId ? String(req.query.sessionId) : undefined;
      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
      const runs = await this.services.stores.run.list(sessionId, limit);
      res.json({ runs, count: runs.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'RUNS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

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

  getTrace = async (req: Request, res: Response): Promise<void> => {
    try {
      const runId = req.params.runId;
      const run = await this.services.stores.run.get(runId);
      if (!run) {
        res.status(404).json({
          error: { code: 'RUN_NOT_FOUND', message: `Run not found: ${runId}`, requestId: req.id }
        });
        return;
      }

      let events: any[] = [];
      try {
        if (this.services.stores.event?.getRunEvents) {
          events = await this.services.stores.event.getRunEvents(runId);
        }
      } catch {}

      let approvals: any[] = [];
      try {
        if (this.services.stores.approval?.listAll) {
          approvals = await this.services.stores.approval.listAll({ runId, limit: 50 });
        }
      } catch {}

      let replaySteps: any[] = [];
      try {
        if (this.services.stores.replay?.getSteps) {
          replaySteps = await this.services.stores.replay.getSteps(runId);
        }
      } catch {}

      res.json({
        run,
        events,
        approvals,
        replaySteps
      });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'TRACE_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
