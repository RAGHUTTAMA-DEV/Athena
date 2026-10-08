import {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  OutboundMessageResult
} from '../../communication/channelTypes.js';

export interface TelegramAdapterConfig {
  botToken?: string;
  allowedUserIds?: string[];
  mockMode?: boolean;
}

export class TelegramChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'telegram';
  readonly name = 'Telegram Bot';

  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private isRunning = false;
  private config: TelegramAdapterConfig;
  public sentMessages: OutboundMessage[] = [];

  constructor(config: TelegramAdapterConfig = {}) {
    this.config = config;
    const allowed = process.env.ALLOWED_TELEGRAM_USERS || process.env.ADMIN_CHAT_IDS;
    if (!this.config.allowedUserIds && allowed) {
      this.config.allowedUserIds = allowed.split(',').map(s => s.trim()).filter(Boolean);
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
   * Helper to chunk messages exceeding 4096 characters per Telegram limits.
   */
  chunkText(text: string, limit = 4096): string[] {
    if (text.length <= limit) return [text];
    const chunks: string[] = [];
    let current = '';
    const lines = text.split('\n');
    for (const line of lines) {
      if ((current + '\n' + line).length > limit) {
        if (current) chunks.push(current);
        if (line.length > limit) {
          for (let i = 0; i < line.length; i += limit) {
            chunks.push(line.substring(i, i + limit));
          }
          current = '';
        } else {
          current = line;
        }
      } else {
        current = current ? current + '\n' + line : line;
      }
    }
    if (current) chunks.push(current);
    return chunks;
  }

  /**
   * Inject message into adapter (used for testing or webhook/polling receipt).
   */
  async injectMessage(
    content: string,
    chatId: string | number,
    userId: string | number,
    displayName = 'Telegram User'
  ): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('No message handler registered for Telegram adapter');
    }
    const strUserId = String(userId);
    const isOwner = this.config.allowedUserIds
      ? this.config.allowedUserIds.includes(strUserId) || this.config.allowedUserIds.includes(String(chatId))
      : true;

    const inbound: InboundMessage = {
      id: `tg_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      channelId: 'telegram_channel',
      channelType: 'telegram',
      conversationId: `tg_chat_${chatId}`,
      externalThreadId: String(chatId),
      sender: {
        id: `part_tg_${strUserId}`,
        conversationId: `tg_chat_${chatId}`,
        externalUserId: strUserId,
        displayName,
        role: isOwner ? 'owner' : 'stranger',
        createdAt: Date.now()
      },
      content,
      timestamp: Date.now()
    };

    await this.messageHandler(inbound);
  }

  async send(message: OutboundMessage): Promise<OutboundMessageResult> {
    if (!this.isRunning) {
      return { success: false, error: 'Telegram adapter is not running' };
    }

    const chunks = this.chunkText(message.content, 4096);
    this.sentMessages.push(message);

    const messageId = `tg_out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      success: true,
      messageId
    };
  }
}
