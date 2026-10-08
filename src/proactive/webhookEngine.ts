import * as crypto from 'crypto';
import { WebhookStore, DurableAgentEventStore } from '../storage/stores/types.js';
import { PromptDefense } from '../security/promptDefense.js';
import { EventPipeline } from './eventPipeline.js';
import { WebhookRequest, WebhookResponse } from './types.js';

export class WebhookEngine {
  private promptDefense: PromptDefense;
  private readonly defaultMaxSkewMs = 300000; // 5 minutes
  private readonly defaultDedupWindowMs = 600000; // 10 minutes

  constructor(
    private webhookStore: WebhookStore,
    private eventStore: DurableAgentEventStore,
    private eventPipeline?: EventPipeline,
    promptDefense?: PromptDefense
  ) {
    this.promptDefense = promptDefense || PromptDefense.getInstance();
  }

  setEventPipeline(pipeline: EventPipeline): void {
    this.eventPipeline = pipeline;
  }

  /**
   * Secure Webhook Ingestion Handler (Spec Section 66).
   * Enforces: Authentication, Signature Verification, Replay Protection,
   * Deduplication, Schema Validation, PromptDefense, and Privilege Separation.
   */
  async handleWebhook(request: WebhookRequest): Promise<WebhookResponse> {
    const now = Date.now();
    const receiptId = `rcpt_${now}_${Math.random().toString(36).substring(2, 7)}`;

    // 1. Endpoint Lookup & Authentication
    const endpoint = await this.webhookStore.getEndpoint(request.endpointId);
    if (!endpoint || !endpoint.isActive) {
      return {
        statusCode: 404,
        accepted: false,
        message: `Endpoint "${request.endpointId}" not found or disabled`
      };
    }

    // Extract headers (case-insensitive lookup)
    const headers = this.normalizeHeaders(request.headers);
    const signatureHeader = headers['x-hub-signature-256'] || headers['x-webhook-signature'] || headers['x-signature'];
    const timestampHeader = headers['x-webhook-timestamp'] || headers['x-timestamp'] || headers['date'];
    const idempotencyKey = headers['x-webhook-id'] || headers['x-delivery-id'] || headers['x-idempotency-key'] || request.parsedBody?.idempotencyKey;

    // 2. Signature Verification (HMAC-SHA256, Constant-Time Comparison)
    if (endpoint.requireSignature) {
      if (!signatureHeader) {
        await this.recordRejection(receiptId, endpoint.id, idempotencyKey, undefined, 'rejected_signature', request.sourceIp);
        return {
          statusCode: 401,
          accepted: false,
          message: 'Missing required webhook signature header',
          receiptId
        };
      }

      const isValidSignature = this.verifySignature(endpoint.secret, request.rawBody, signatureHeader);
      if (!isValidSignature) {
        await this.recordRejection(receiptId, endpoint.id, idempotencyKey, signatureHeader, 'rejected_signature', request.sourceIp);
        return {
          statusCode: 401,
          accepted: false,
          message: 'Invalid webhook signature',
          receiptId
        };
      }
    }

    // 3. Replay Protection (Timestamp skew verification)
    if (timestampHeader) {
      const parsedTime = this.parseTimestamp(timestampHeader);
      if (isNaN(parsedTime) || Math.abs(now - parsedTime) > this.defaultMaxSkewMs) {
        await this.recordRejection(receiptId, endpoint.id, idempotencyKey, signatureHeader, 'rejected_replay', request.sourceIp);
        return {
          statusCode: 400,
          accepted: false,
          message: `Webhook rejected: timestamp skew exceeds tolerance (${this.defaultMaxSkewMs}ms). Possible replay attack.`,
          receiptId
        };
      }
    }

    // 4. Deduplication
    if (idempotencyKey) {
      const existing = await this.webhookStore.getReceiptByIdempotencyKey(
        endpoint.id,
        idempotencyKey,
        this.defaultDedupWindowMs
      );
      if (existing) {
        await this.recordRejection(receiptId, endpoint.id, idempotencyKey, signatureHeader, 'rejected_duplicate', request.sourceIp);
        return {
          statusCode: 409,
          accepted: false,
          message: `Webhook rejected: duplicate idempotency key "${idempotencyKey}".`,
          receiptId
        };
      }
    }

    // 5. Payload Validation & Parsing
    let payload = request.parsedBody;
    if (!payload) {
      try {
        payload = JSON.parse(request.rawBody);
      } catch (err: any) {
        await this.recordRejection(receiptId, endpoint.id, idempotencyKey, signatureHeader, 'rejected_validation', request.sourceIp);
        return {
          statusCode: 400,
          accepted: false,
          message: `Malformed JSON payload: ${err.message}`,
          receiptId
        };
      }
    }

    // 6. Privilege Separation Guard (Spec Section 66)
    // Webhooks cannot trigger privileged actions directly!
    const privilegeViolation = this.checkPrivilegeSeparationViolation(payload);
    if (privilegeViolation) {
      await this.recordRejection(receiptId, endpoint.id, idempotencyKey, signatureHeader, 'rejected_validation', request.sourceIp);
      return {
        statusCode: 403,
        accepted: false,
        message: `Privilege separation violation: webhooks cannot invoke privileged tool or action "${privilegeViolation}" directly.`,
        receiptId
      };
    }

    // 7. PromptDefense Sanitization (neutralize prompt injections)
    const sanitizedPayload = this.sanitizePayload(payload);

    // 8. Record Accepted Receipt
    const payloadHash = crypto.createHash('sha256').update(request.rawBody).digest('hex');
    await this.webhookStore.recordReceipt({
      id: receiptId,
      endpointId: endpoint.id,
      idempotencyKey,
      signature: signatureHeader,
      timestamp: now,
      status: 'accepted',
      sourceIp: request.sourceIp,
      payloadHash,
      createdAt: now
    });

    // 9. Dispatch as Durable Agent Event
    const eventTopic = sanitizedPayload.topic || `webhook:${endpoint.name || endpoint.id}`;
    const eventId = `evt_wh_${now}_${Math.random().toString(36).substring(2, 6)}`;

    const agentEvent = {
      id: eventId,
      topic: eventTopic,
      payload: {
        ...sanitizedPayload,
        _webhookOrigin: {
          endpointId: endpoint.id,
          receiptId,
          sourceIp: request.sourceIp,
          isUntrusted: true // Mandatory boundary tag
        }
      },
      priority: 'normal' as const,
      source: `webhook:${endpoint.id}`,
      status: 'pending' as const,
      idempotencyKey,
      retryCount: 0,
      maxRetries: 3,
      timestamp: now
    };

    await this.eventStore.save(agentEvent);

    if (this.eventPipeline) {
      // Process through event pipeline asynchronously or synchronously
      await this.eventPipeline.processEvent(agentEvent).catch(err => {
        console.error(`[WebhookEngine] Pipeline error for event ${eventId}:`, err);
      });
    }

    return {
      statusCode: 200,
      accepted: true,
      message: 'Webhook accepted and queued for processing',
      eventId,
      receiptId
    };
  }

  private verifySignature(secret: string, rawBody: string, signatureHeader: string): boolean {
    let cleanSignature = signatureHeader.trim();
    if (cleanSignature.startsWith('sha256=')) {
      cleanSignature = cleanSignature.substring(7);
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf-8');
    const actualBuf = Buffer.from(cleanSignature, 'utf-8');

    if (expectedBuf.length !== actualBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(expectedBuf, actualBuf);
  }

  private parseTimestamp(val: string): number {
    const num = Number(val);
    if (!isNaN(num)) {
      // Check if unix timestamp in seconds
      if (num < 10000000000) return num * 1000;
      return num;
    }
    return new Date(val).getTime();
  }

  private checkPrivilegeSeparationViolation(payload: any): string | null {
    if (!payload || typeof payload !== 'object') return null;

    const privilegedDirectives = [
      'cmd:exec',
      'executeCommand',
      'shell',
      'terminal',
      'deleteFile',
      'editFile',
      'computerAction',
      'computer_use',
      'shutdown',
      'eval'
    ];

    const checkObj = (obj: any): string | null => {
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') {
          for (const priv of privilegedDirectives) {
            if (v.toLowerCase() === priv.toLowerCase() || (k === 'action' && v.includes(priv))) {
              return priv;
            }
          }
        } else if (v && typeof v === 'object') {
          const res = checkObj(v);
          if (res) return res;
        }
      }
      return null;
    };

    return checkObj(payload);
  }

  private sanitizePayload(payload: any): any {
    if (typeof payload === 'string') {
      const sanitized = this.promptDefense.analyzeAndSanitize(payload);
      return sanitized.sanitizedContent;
    }
    if (Array.isArray(payload)) {
      return payload.map(item => this.sanitizePayload(item));
    }
    if (payload && typeof payload === 'object') {
      const result: Record<string, any> = {};
      for (const [key, val] of Object.entries(payload)) {
        result[key] = this.sanitizePayload(val);
      }
      return result;
    }
    return payload;
  }

  private normalizeHeaders(headers: Record<string, string | undefined>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (v !== undefined) {
        normalized[k.toLowerCase()] = v;
      }
    }
    return normalized;
  }

  private async recordRejection(
    receiptId: string,
    endpointId: string,
    idempotencyKey: string | undefined,
    signature: string | undefined,
    status: any,
    sourceIp: string | undefined
  ): Promise<void> {
    await this.webhookStore.recordReceipt({
      id: receiptId,
      endpointId,
      idempotencyKey,
      signature,
      timestamp: Date.now(),
      status,
      sourceIp,
      createdAt: Date.now()
    });
  }
}
