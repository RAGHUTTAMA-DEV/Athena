import {
  Channel,
  ChannelType,
  ChannelStatus,
  Conversation,
  Participant,
  ParticipantRole,
  ChannelMessage,
  ChannelMessageDirection,
  ChannelMessageStatus,
  CalendarEvent,
  CalendarEventStatus
} from '../storage/stores/types.js';

export {
  Channel,
  ChannelType,
  ChannelStatus,
  Conversation,
  Participant,
  ParticipantRole,
  ChannelMessage,
  ChannelMessageDirection,
  ChannelMessageStatus,
  CalendarEvent,
  CalendarEventStatus
};

export interface InboundMessage {
  id: string;
  channelId: string;
  channelType: ChannelType;
  conversationId: string;
  externalThreadId: string;
  sender: Participant;
  content: string;
  attachments?: any[];
  rawPayload?: any;
  timestamp: number;
}

export interface OutboundMessage {
  id?: string;
  channelId?: string;
  channelType?: ChannelType;
  conversationId?: string;
  recipientId?: string;
  externalThreadId?: string;
  content: string;
  attachments?: any[];
  replyToId?: string;
  metadata?: Record<string, any>;
  requiresApproval?: boolean;
}

export interface OutboundMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
  policyBlocked?: boolean;
}

export interface ChannelCapabilities {
  supportsMarkdown: boolean;
  supportsEmbeds: boolean;
  supportsReactions: boolean;
  supportsFiles: boolean;
  supportsButtons: boolean;
  maxMessageLength: number;
}

export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly name: string;
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  send(message: OutboundMessage): Promise<OutboundMessageResult>;
  onMessage(handler: (msg: InboundMessage) => Promise<void>): void;
  getCapabilities(): ChannelCapabilities;
}
