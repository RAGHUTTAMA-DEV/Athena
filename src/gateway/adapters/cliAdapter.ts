import {
  ChannelAdapter,
  ChannelCapabilities,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  OutboundMessageResult
} from '../../communication/channelTypes.js';

export class CliChannelAdapter implements ChannelAdapter {
  readonly type: ChannelType = 'cli';
  readonly name = 'CLI Terminal';

  private messageHandler?: (msg: InboundMessage) => Promise<void>;
  private isRunning = false;

  getCapabilities(): ChannelCapabilities {
    return {
      supportsMarkdown: true,
      supportsEmbeds: false,
      supportsReactions: false,
      supportsFiles: true,
      supportsButtons: false,
      maxMessageLength: 100000
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
   * Inject an inbound CLI message into the gateway.
   */
  async injectMessage(content: string, senderId = 'cli_user', conversationId = 'cli_session'): Promise<void> {
    if (!this.messageHandler) {
      throw new Error('No message handler registered for CLI adapter');
    }
    const inbound: InboundMessage = {
      id: `cli_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      channelId: 'cli_channel',
      channelType: 'cli',
      conversationId,
      externalThreadId: conversationId,
      sender: {
        id: `part_${senderId}`,
        conversationId,
        externalUserId: senderId,
        displayName: 'CLI Operator',
        role: 'owner',
        createdAt: Date.now()
      },
      content,
      timestamp: Date.now()
    };
    await this.messageHandler(inbound);
  }

  async send(message: OutboundMessage): Promise<OutboundMessageResult> {
    if (!this.isRunning) {
      return { success: false, error: 'CLI adapter is not running' };
    }
    const messageId = `cli_out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    return {
      success: true,
      messageId
    };
  }
}
