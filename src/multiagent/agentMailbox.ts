import { AgentMessage, AgentMessageStatus, AgentMessageStore, AgentMessageType } from '../storage/stores/types.js';

export class AgentMailbox {
  constructor(private store: AgentMessageStore) {}

  /**
   * Send a structured A2A message to a recipient's durable mailbox.
   */
  async send(params: {
    id?: string;
    senderId: string;
    recipientId: string;
    messageType: AgentMessageType;
    payload: Record<string, any> | string;
    goalId?: string;
    taskId?: string;
    runId?: string;
    replyToId?: string;
    status?: AgentMessageStatus;
  }): Promise<AgentMessage> {
    const msgId = params.id || `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const message: AgentMessage = {
      id: msgId,
      senderId: params.senderId,
      recipientId: params.recipientId,
      messageType: params.messageType,
      goalId: params.goalId,
      taskId: params.taskId,
      runId: params.runId,
      payload: params.payload,
      status: params.status || 'sent',
      replyToId: params.replyToId,
      createdAt: Date.now()
    };

    return await this.store.save(message);
  }

  /**
   * Fetch pending or unread messages for an agent.
   */
  async receive(
    recipientId: string,
    filter?: { goalId?: string; taskId?: string; status?: AgentMessageStatus; limit?: number }
  ): Promise<AgentMessage[]> {
    return await this.store.listByRecipient(recipientId, filter);
  }

  /**
   * Fetch full conversation thread by message ID or reply-to chain.
   */
  async getThread(messageIdOrReplyToId: string): Promise<AgentMessage[]> {
    return await this.store.listByThread(messageIdOrReplyToId);
  }

  /**
   * Fetch all messages linked to a specific goal.
   */
  async getGoalMessages(goalId: string): Promise<AgentMessage[]> {
    return await this.store.listByGoal(goalId);
  }

  /**
   * Fetch all messages linked to a specific task.
   */
  async getTaskMessages(taskId: string): Promise<AgentMessage[]> {
    return await this.store.listByTask(taskId);
  }

  /**
   * Mark message as processed.
   */
  async markProcessed(messageId: string): Promise<void> {
    await this.store.updateStatus(messageId, 'processed');
  }

  /**
   * Mark message as read.
   */
  async markRead(messageId: string): Promise<void> {
    await this.store.updateStatus(messageId, 'read');
  }

  /**
   * Reply to an incoming message.
   */
  async reply(
    original: AgentMessage,
    senderId: string,
    payload: Record<string, any> | string,
    messageType: AgentMessageType = 'response'
  ): Promise<AgentMessage> {
    return await this.send({
      senderId,
      recipientId: original.senderId,
      messageType,
      goalId: original.goalId,
      taskId: original.taskId,
      replyToId: original.id,
      payload
    });
  }

  /**
   * Broadcast a message to all agents on a goal/task.
   */
  async broadcast(
    senderId: string,
    messageType: AgentMessageType,
    payload: Record<string, any> | string,
    goalId?: string,
    taskId?: string
  ): Promise<AgentMessage> {
    return await this.send({
      senderId,
      recipientId: 'all',
      messageType,
      goalId,
      taskId,
      payload
    });
  }
}
