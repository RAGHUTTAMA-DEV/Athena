import { Database } from 'sqlite';
import {
  Channel,
  Conversation,
  Participant,
  ChannelMessage,
  CommunicationStore
} from '../types.js';

function rowToChannel(row: any): Channel {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    status: row.status,
    config: row.config ? JSON.parse(row.config) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function rowToConversation(row: any): Conversation {
  return {
    id: row.id,
    channelId: row.channel_id,
    externalThreadId: row.external_thread_id,
    title: row.title || undefined,
    activeSessionId: row.active_session_id || undefined,
    activeGoalId: row.active_goal_id || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

function rowToParticipant(row: any): Participant {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    externalUserId: row.external_user_id,
    displayName: row.display_name || undefined,
    role: row.role,
    permissions: row.permissions ? JSON.parse(row.permissions) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    createdAt: Number(row.created_at)
  };
}

function rowToMessage(row: any): ChannelMessage {
  return {
    id: row.id,
    channelId: row.channel_id,
    conversationId: row.conversation_id,
    direction: row.direction,
    senderId: row.sender_id || undefined,
    recipientId: row.recipient_id || undefined,
    content: row.content,
    attachments: row.attachments ? JSON.parse(row.attachments) : undefined,
    status: row.status,
    replyToId: row.reply_to_id || undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
    timestamp: Number(row.timestamp)
  };
}

export class SqliteCommunicationStore implements CommunicationStore {
  constructor(private db: Database) {}

  async saveChannel(channel: Channel): Promise<Channel> {
    await this.db.run(
      `INSERT INTO channels (id, type, name, status, config, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type,
         name = excluded.name,
         status = excluded.status,
         config = excluded.config,
         updated_at = excluded.updated_at`,
      channel.id,
      channel.type,
      channel.name,
      channel.status,
      channel.config ? JSON.stringify(channel.config) : null,
      channel.createdAt,
      channel.updatedAt
    );
    return channel;
  }

  async getChannel(id: string): Promise<Channel | null> {
    const row = await this.db.get(`SELECT * FROM channels WHERE id = ?`, id);
    return row ? rowToChannel(row) : null;
  }

  async listChannels(): Promise<Channel[]> {
    const rows = await this.db.all(`SELECT * FROM channels ORDER BY created_at ASC`);
    return rows.map(rowToChannel);
  }

  async saveConversation(conversation: Conversation): Promise<Conversation> {
    await this.db.run(
      `INSERT INTO conversations (id, channel_id, external_thread_id, title, active_session_id, active_goal_id, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         active_session_id = excluded.active_session_id,
         active_goal_id = excluded.active_goal_id,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      conversation.id,
      conversation.channelId,
      conversation.externalThreadId,
      conversation.title || null,
      conversation.activeSessionId || null,
      conversation.activeGoalId || null,
      conversation.metadata ? JSON.stringify(conversation.metadata) : null,
      conversation.createdAt,
      conversation.updatedAt
    );
    return conversation;
  }

  async getConversation(id: string): Promise<Conversation | null> {
    const row = await this.db.get(`SELECT * FROM conversations WHERE id = ?`, id);
    return row ? rowToConversation(row) : null;
  }

  async getConversationByThread(channelId: string, externalThreadId: string): Promise<Conversation | null> {
    const row = await this.db.get(
      `SELECT * FROM conversations WHERE channel_id = ? AND external_thread_id = ?`,
      channelId,
      externalThreadId
    );
    return row ? rowToConversation(row) : null;
  }

  async listConversations(channelId?: string): Promise<Conversation[]> {
    if (channelId) {
      const rows = await this.db.all(
        `SELECT * FROM conversations WHERE channel_id = ? ORDER BY updated_at DESC`,
        channelId
      );
      return rows.map(rowToConversation);
    }
    const rows = await this.db.all(`SELECT * FROM conversations ORDER BY updated_at DESC`);
    return rows.map(rowToConversation);
  }

  async saveParticipant(participant: Participant): Promise<Participant> {
    await this.db.run(
      `INSERT INTO participants (id, conversation_id, external_user_id, display_name, role, permissions, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         display_name = excluded.display_name,
         role = excluded.role,
         permissions = excluded.permissions,
         metadata = excluded.metadata`,
      participant.id,
      participant.conversationId,
      participant.externalUserId,
      participant.displayName || null,
      participant.role,
      participant.permissions ? JSON.stringify(participant.permissions) : null,
      participant.metadata ? JSON.stringify(participant.metadata) : null,
      participant.createdAt
    );
    return participant;
  }

  async getParticipant(id: string): Promise<Participant | null> {
    const row = await this.db.get(`SELECT * FROM participants WHERE id = ?`, id);
    return row ? rowToParticipant(row) : null;
  }

  async getParticipantByExternal(conversationId: string, externalUserId: string): Promise<Participant | null> {
    const row = await this.db.get(
      `SELECT * FROM participants WHERE conversation_id = ? AND external_user_id = ?`,
      conversationId,
      externalUserId
    );
    return row ? rowToParticipant(row) : null;
  }

  async listParticipants(conversationId: string): Promise<Participant[]> {
    const rows = await this.db.all(
      `SELECT * FROM participants WHERE conversation_id = ? ORDER BY created_at ASC`,
      conversationId
    );
    return rows.map(rowToParticipant);
  }

  async saveMessage(msg: ChannelMessage): Promise<ChannelMessage> {
    await this.db.run(
      `INSERT INTO channel_messages (
        id, channel_id, conversation_id, direction, sender_id, recipient_id, content, attachments, status, reply_to_id, metadata, timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        metadata = excluded.metadata`,
      msg.id,
      msg.channelId,
      msg.conversationId,
      msg.direction,
      msg.senderId || null,
      msg.recipientId || null,
      msg.content,
      msg.attachments ? JSON.stringify(msg.attachments) : null,
      msg.status,
      msg.replyToId || null,
      msg.metadata ? JSON.stringify(msg.metadata) : null,
      msg.timestamp
    );
    return msg;
  }

  async getMessage(id: string): Promise<ChannelMessage | null> {
    const row = await this.db.get(`SELECT * FROM channel_messages WHERE id = ?`, id);
    return row ? rowToMessage(row) : null;
  }

  async listMessages(conversationId: string, limit = 100): Promise<ChannelMessage[]> {
    const rows = await this.db.all(
      `SELECT * FROM channel_messages WHERE conversation_id = ? ORDER BY timestamp ASC LIMIT ?`,
      conversationId,
      limit
    );
    return rows.map(rowToMessage);
  }
}
