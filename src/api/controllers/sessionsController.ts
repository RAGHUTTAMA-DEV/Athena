import { Request, Response } from 'express';
import { DispatchService } from '../services/dispatchService.js';
import { HydrationService } from '../services/hydrationService.js';
import { SSEManager } from '../events/sseManager.js';

export class SessionsController {
  constructor(
    private services: {
      dispatch: DispatchService;
      hydration: HydrationService;
      sse: SSEManager;
      stores: any;
    }
  ) {}

  submitMessage = async (req: Request, res: Response): Promise<void> => {
    try {
      const idempotencyKey = req.headers['x-idempotency-key'] as string | undefined;
      const result = await this.services.dispatch.submitMessage({
        sessionId: req.params.sessionId,
        content: req.body?.content,
        idempotencyKey,
        attachments: req.body?.attachments,
        metadata: req.body?.metadata,
        workspaceId: req.auth?.workspaceId
      });
      res.status(result.isDuplicate ? 200 : 202).json(result);
    } catch (err: any) {
      res.status(400).json({
        error: {
          code: 'DISPATCH_FAILED',
          message: err.message,
          requestId: req.id,
          details: {}
        }
      });
    }
  };

  getState = async (req: Request, res: Response): Promise<void> => {
    try {
      const state = await this.services.hydration.getSessionState(req.params.sessionId);
      res.json(state);
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'HYDRATION_FAILED',
          message: err.message,
          requestId: req.id,
          details: {}
        }
      });
    }
  };

  getEvents = async (req: Request, res: Response): Promise<void> => {
    const lastEventId = (req.headers['last-event-id'] || req.query.lastEventId) as string | undefined;
    const clientId = `client_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.services.sse.registerClient(clientId, res, {
      sessionId: req.params.sessionId,
      lastEventId
    });
  };

  listSessions = async (req: Request, res: Response): Promise<void> => {
    try {
      const runs = await this.services.stores.run.list(undefined, 100);
      const sessionMap = new Map<string, any>();
      for (const r of runs) {
        if (!sessionMap.has(r.sessionId)) {
          sessionMap.set(r.sessionId, {
            sessionId: r.sessionId,
            lastActiveAt: r.updatedAt,
            runCount: 1,
            latestRunId: r.runId,
            latestStatus: r.status
          });
        } else {
          sessionMap.get(r.sessionId).runCount++;
        }
      }
      res.json({
        sessions: Array.from(sessionMap.values()).slice(0, 50)
      });
    } catch (err: any) {
      res.status(500).json({
        error: {
          code: 'SESSIONS_FETCH_FAILED',
          message: err.message,
          requestId: req.id,
          details: {}
        }
      });
    }
  };
}
