import {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  OutboundMessageResult
} from '../../communication/channelTypes.js';

export interface DiscordAdapterConfig {
  botToken?: string;
  allowedUserIds?: string[];
  guildId?: string;
}

export class DiscordChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'discord';
  readonly name = 'Discord Gateway';

  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private isRunning = false;
  private config: DiscordAdapterConfig;
  public sentMessages: OutboundMessage[] = [];

  constructor(config: DiscordAdapterConfig = {}) {
    this.config = config;
    const allowed = process.env.ALLOWED_DISCORD_USERS;
    if (!this.config.allowedUserIds && allowed) {
      this.config.allowedUserIds = allowed.split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  getCapabilities(): ChannelCapabilities {
    return {
      supportsMarkdown: true,
      supportsEmbeds: true,
      supportsReactions: true,
      supportsFiles: true,
      supportsButtons: true,
      maxMessageLength: 2000
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
   * Ingest an inbound Discord message.
   */
  async injectMessage(params: {
    channelId: string;
    authorId: string;
    authorName: string;
    content: string;
    isBot?: boolean;
  }): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('No message handler registered for Discord adapter');
    }

    const isOwner = this.config.allowedUserIds
      ? this.config.allowedUserIds.includes(params.authorId)
      : false;

    const inbound: InboundMessage = {
      id: `discord_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      channelId: 'discord_channel',
      channelType: 'discord',
      conversationId: `discord_ch_${params.channelId}`,
      externalThreadId: params.channelId,
      sender: {
        id: `part_discord_${params.authorId}`,
        conversationId: `discord_ch_${params.channelId}`,
        externalUserId: params.authorId,
        displayName: params.authorName,
        role: isOwner ? 'owner' : 'stranger',
        createdAt: Date.now()
      },
      content: params.content,
      rawPayload: params,
      timestamp: Date.now()
    };

    await this.messageHandler(inbound);
  }

  async send(message: OutboundMessage): Promise<OutboundMessageResult> {
    if (!this.isRunning) {
      return { success: false, error: 'Discord adapter is not running' };
    }

    this.sentMessages.push(message);
    const messageId = `discord_out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      success: true,
      messageId
    };
  }
}
