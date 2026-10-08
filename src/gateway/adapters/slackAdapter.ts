import {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  OutboundMessageResult
} from '../../communication/channelTypes.js';

export interface SlackAdapterConfig {
  botToken?: string;
  allowedUserIds?: string[];
}

export class SlackChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'slack';
  readonly name = 'Slack App';

  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private isRunning = false;
  private config: SlackAdapterConfig;
  public sentMessages: OutboundMessage[] = [];

  constructor(config: SlackAdapterConfig = {}) {
    this.config = config;
    const allowed = process.env.ALLOWED_SLACK_USERS;
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
      maxMessageLength: 40000
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
   * Ingest an inbound Slack event.
   */
  async injectMessage(params: {
    channelId: string;
    userId: string;
    userName: string;
    text: string;
    threadTs?: string;
  }): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('No message handler registered for Slack adapter');
    }

    const isOwner = this.config.allowedUserIds
      ? this.config.allowedUserIds.includes(params.userId)
      : false;

    const threadKey = params.threadTs || params.channelId;

    const inbound: InboundMessage = {
      id: `slack_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      channelId: 'slack_channel',
      channelType: 'slack',
      conversationId: `slack_conv_${threadKey}`,
      externalThreadId: threadKey,
      sender: {
        id: `part_slack_${params.userId}`,
        conversationId: `slack_conv_${threadKey}`,
        externalUserId: params.userId,
        displayName: params.userName,
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
      return { success: false, error: 'Slack adapter is not running' };
    }

    this.sentMessages.push(message);
    const messageId = `slack_out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      success: true,
      messageId
    };
  }
}
