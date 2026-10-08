import {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  OutboundMessageResult
} from '../../communication/channelTypes.js';

export interface EmailAdapterConfig {
  ownerEmail?: string;
  smtpHost?: string;
  imapHost?: string;
}

export class EmailChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'email';
  readonly name = 'Email (SMTP/IMAP)';

  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private isRunning = false;
  private config: EmailAdapterConfig;
  public sentEmails: OutboundMessage[] = [];

  constructor(config: EmailAdapterConfig = {}) {
    this.config = config;
    if (!this.config.ownerEmail && process.env.OWNER_EMAIL) {
      this.config.ownerEmail = process.env.OWNER_EMAIL;
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      supportsMarkdown: true,
      supportsEmbeds: false,
      supportsReactions: false,
      supportsFiles: true,
      supportsButtons: false,
      maxMessageLength: 1000000
    };
  }

  async initialize(): Promise<void> {}

  async start(): Promise<void> {
    this.isRunning = true;
  }

  async stop(): Promise<void> {
    this.isRunning = false;
  }

  onMessage(handler: (msg: InboundMessage) => Promise<void>): void {
    this.messageHandler = handler;
  }

  /**
   * Ingest an inbound email into the adapter.
   */
  async injectEmail(params: {
    from: string;
    to: string;
    subject: string;
    body: string;
    messageId?: string;
    threadId?: string;
  }): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('No message handler registered for Email adapter');
    }

    const isOwner = Boolean(
      this.config.ownerEmail && params.from.toLowerCase().includes(this.config.ownerEmail.toLowerCase())
    );
    const thread = params.threadId || params.subject.replace(/^(Re:\s*|Fwd:\s*)+/i, '').trim();

    const inbound: InboundMessage = {
      id: params.messageId || `email_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      channelId: 'email_channel',
      channelType: 'email',
      conversationId: `email_thread_${thread.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      externalThreadId: thread,
      sender: {
        id: `part_email_${params.from}`,
        conversationId: `email_thread_${thread}`,
        externalUserId: params.from,
        displayName: params.from,
        role: isOwner ? 'owner' : 'stranger',
        createdAt: Date.now()
      },
      content: `Subject: ${params.subject}\n\n${params.body}`,
      rawPayload: params,
      timestamp: Date.now()
    };

    await this.messageHandler(inbound);
  }

  async send(message: OutboundMessage): Promise<OutboundMessageResult> {
    if (!this.isRunning) {
      return { success: false, error: 'Email adapter is not running' };
    }

    this.sentEmails.push(message);
    const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2, 7)}@athena.local>`;
    return {
      success: true,
      messageId
    };
  }
}
