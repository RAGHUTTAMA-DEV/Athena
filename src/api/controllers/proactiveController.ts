import { Request, Response } from 'express';
import * as crypto from 'crypto';

export class ProactiveController {
  constructor(private stores: any) {}

  getHeartbeats = async (req: Request, res: Response): Promise<void> => {
    try {
      let logs: any[] = [];
      let summary: any = { totalCostUsd: 0, totalTokens: 0, totalWakes: 0, totalTicks: 0 };
      if (this.stores.heartbeat) {
        logs = await this.stores.heartbeat.listRecent(50);
        summary = await this.stores.heartbeat.getCostSummary(Date.now() - (24 * 3600 * 1000));
      }
      res.json({ summary, recentLogs: logs });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'HEARTBEATS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  listEvents = async (req: Request, res: Response): Promise<void> => {
    try {
      let events: any[] = [];
      if (this.stores.durableEvent) {
        events = await this.stores.durableEvent.list({
          status: req.query.status,
          limit: req.query.limit ? parseInt(String(req.query.limit), 10) : 50
        });
      }
      res.json({ events, count: events.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'EVENTS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  retryEvent = async (req: Request, res: Response): Promise<void> => {
    try {
      if (this.stores.durableEvent) {
        await this.stores.durableEvent.updateStatus(req.params.id, 'pending');
        res.json({ success: true, eventId: req.params.id, status: 'pending' });
        return;
      }
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Durable event store unavailable', requestId: req.id } });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'EVENT_RETRY_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  listWebhooks = async (req: Request, res: Response): Promise<void> => {
    try {
      let endpoints: any[] = [];
      if (this.stores.webhook) {
        endpoints = await this.stores.webhook.listEndpoints();
      }
      res.json({ endpoints, count: endpoints.length });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'WEBHOOKS_FETCH_FAILED', message: err.message, requestId: req.id }
      });
    }
  };

  receiveWebhook = async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.stores.webhook) {
        res.status(503).json({ error: { code: 'WEBHOOK_STORE_UNAVAILABLE', message: 'Webhook engine offline', requestId: req.id } });
        return;
      }

      const endpoint = await this.stores.webhook.getEndpoint(req.params.endpointId);
      if (!endpoint || !endpoint.isActive) {
        res.status(404).json({ error: { code: 'ENDPOINT_NOT_FOUND', message: 'Webhook endpoint invalid or disabled', requestId: req.id } });
        return;
      }

      // Verify signature if required
      if (endpoint.requireSignature) {
        const sig = req.headers['x-signature'] as string | undefined;
        if (!sig) {
          res.status(401).json({ error: { code: 'SIGNATURE_MISSING', message: 'Missing x-signature header', requestId: req.id } });
          return;
        }
        const rawPayload = JSON.stringify(req.body || {});
        const expected = crypto.createHmac('sha256', endpoint.secret).update(rawPayload).digest('hex');
        if (sig !== expected) {
          res.status(401).json({ error: { code: 'SIGNATURE_INVALID', message: 'Invalid HMAC signature', requestId: req.id } });
          return;
        }
      }

      const receiptId = `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await this.stores.webhook.recordReceipt({
        id: receiptId,
        endpointId: req.params.endpointId,
        idempotencyKey: req.headers['x-idempotency-key'] as string | undefined,
        timestamp: Date.now(),
        status: 'accepted',
        sourceIp: (req as any).ip || req.socket.remoteAddress,
        createdAt: Date.now()
      });

      res.status(202).json({ accepted: true, receiptId });
    } catch (err: any) {
      res.status(500).json({
        error: { code: 'WEBHOOK_RECEIVE_FAILED', message: err.message, requestId: req.id }
      });
    }
  };
}
