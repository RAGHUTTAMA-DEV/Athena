import { Response } from 'express';
import { AthenaEventEnvelope } from './eventEnvelope.js';

interface SSEClient {
  id: string;
  runId?: string;
  sessionId?: string;
  res: Response;
  lastEventId?: string;
  connectedAt: number;
}

export class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private eventRingBuffer: AthenaEventEnvelope[] = [];
  private maxBufferSize: number = 500;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(maxBufferSize = 500) {
    this.maxBufferSize = maxBufferSize;
    this.startHeartbeat();
  }

  registerClient(
    clientId: string,
    res: Response,
    options?: { runId?: string; sessionId?: string; lastEventId?: string }
  ): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders?.();

    const client: SSEClient = {
      id: clientId,
      runId: options?.runId,
      sessionId: options?.sessionId,
      res,
      lastEventId: options?.lastEventId,
      connectedAt: Date.now()
    };

    this.clients.set(clientId, client);

    // Initial connection comment
    res.write(`: connected at ${new Date().toISOString()}\n\n`);

    // Replay buffer if lastEventId is provided
    if (options?.lastEventId) {
      this.replayFrom(client, options.lastEventId);
    }

    res.on('close', () => {
      this.clients.delete(clientId);
    });
  }

  broadcast(envelope: AthenaEventEnvelope): void {
    // Append to ring buffer
    this.eventRingBuffer.push(envelope);
    if (this.eventRingBuffer.length > this.maxBufferSize) {
      this.eventRingBuffer.shift();
    }

    const payload = `id: ${envelope.eventId}\nevent: ${envelope.type}\ndata: ${JSON.stringify(envelope)}\n\n`;

    for (const [_, client] of this.clients.entries()) {
      if (client.runId && envelope.runId && client.runId !== envelope.runId) {
        continue;
      }
      if (client.sessionId && envelope.sessionId && client.sessionId !== envelope.sessionId) {
        continue;
      }
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  private replayFrom(client: SSEClient, lastEventId: string): void {
    const lastIndex = this.eventRingBuffer.findIndex(e => e.eventId === lastEventId);
    const toReplay = lastIndex >= 0 ? this.eventRingBuffer.slice(lastIndex + 1) : this.eventRingBuffer;

    for (const envelope of toReplay) {
      if (client.runId && envelope.runId && client.runId !== envelope.runId) continue;
      if (client.sessionId && envelope.sessionId && client.sessionId !== envelope.sessionId) continue;
      const payload = `id: ${envelope.eventId}\nevent: ${envelope.type}\ndata: ${JSON.stringify(envelope)}\n\n`;
      client.res.write(payload);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const ping = `: heartbeat ${Date.now()}\n\n`;
      for (const [id, client] of this.clients.entries()) {
        try {
          client.res.write(ping);
        } catch {
          this.clients.delete(id);
        }
      }
    }, 15000);
  }

  getClientCount(): number {
    return this.clients.size;
  }

  close(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    for (const [_, client] of this.clients.entries()) {
      try {
        client.res.end();
      } catch {}
    }
    this.clients.clear();
  }
}
