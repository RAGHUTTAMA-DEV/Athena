import {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  OutboundMessageResult
} from '../../communication/channelTypes.js';

export interface WhatsAppAdapterConfig {
  phoneNumberId?: string;
  accessToken?: string;
  allowedPhoneNumbers?: string[];
}

/**
 * WhatsApp Business Platform Cloud API adapter.
 * Marked 'experimental' in CapabilityRegistry per Build Plan P8.
 */
export class WhatsAppChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'whatsapp';
  readonly name = 'WhatsApp Business Cloud API (Experimental)';

  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private isRunning = false;
  private config: WhatsAppAdapterConfig;
  public sentMessages: OutboundMessage[] = [];

  constructor(config: WhatsAppAdapterConfig = {}) {
    this.config = config;
    const allowed = process.env.ALLOWED_WHATSAPP_NUMBERS;
    if (!this.config.allowedPhoneNumbers && allowed) {
      this.config.allowedPhoneNumbers = allowed.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      supportsMarkdown: true,
      supportsEmbeds: false,
      supportsReactions: true,
      supportsFiles: true,
      supportsButtons: true,
      maxMessageLength: 4096
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
   * Ingest an inbound WhatsApp webhook notification.
   */
  async injectWebhookPayload(params: {
    fromNumber: string;
    senderName?: string;
    text: string;
    messageId?: string;
  }): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('No message handler registered for WhatsApp adapter');
    }

    const isOwner = this.config.allowedPhoneNumbers
      ? this.config.allowedPhoneNumbers.includes(params.fromNumber)
      : false;

    const inbound: InboundMessage = {
      id: params.messageId || `wa_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      channelId: 'whatsapp_channel',
      channelType: 'whatsapp',
      conversationId: `wa_chat_${params.fromNumber}`,
      externalThreadId: params.fromNumber,
      sender: {
        id: `part_wa_${params.fromNumber}`,
        conversationId: `wa_chat_${params.fromNumber}`,
        externalUserId: params.fromNumber,
        displayName: params.senderName || params.fromNumber,
        role: isOwner ? 'owner' : 'stranger',
        createdAt: Date.now()
      },
      content: params.text,
      rawPayload: params,
      timestamp: Date.now()
    };

    await this.messageHandler(inbound);
  }

  async send(message: OutboundMessage): Promise<OutboundMessageResult> {
    if (!this.isRunning) {
      return { success: false, error: 'WhatsApp adapter is not running' };
    }

    this.sentMessages.push(message);
    const messageId = `wamid.HBgL${Date.now()}`;
    return {
      success: true,
      messageId
    };
  }
}
