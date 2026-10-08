import {
  ChannelAdapter,
  ChannelType,
  InboundMessage,
  OutboundMessage,
  OutboundMessageResult,
  Participant,
  ParticipantRole
} from '../communication/channelTypes.js';
import { CommunicationStore } from '../storage/stores/types.js';
import { Agent } from '../runtime/agent.js';
import { PromptDefense } from '../security/promptDefense.js';
import { CredentialManager } from '../security/credentialManager.js';

export interface ChannelGatewayConfig {
  ownerIds?: string[];
  ownerEmails?: string[];
  restrictStrangers?: boolean; // Defaults to true
}

export const PRIVILEGED_PATTERNS = [
  /\b(exec|run|execute|bash|sh|cmd|powershell|terminal)\b/i,
  /\b(delete|rm|unlink|remove|overwrite|format|kill|shutdown)\b/i,
  /\b(curl|wget|nc|netcat|invoke-expression|iex)\b/i,
  /\b(computer|mouse|click|type|screen|desktop)\b/i
];

export class ChannelGatewayManager {
  private adapters: Map<ChannelType, ChannelAdapter> = new Map();
  private store: CommunicationStore;
  private agent?: Agent;
  private config: ChannelGatewayConfig;

  constructor(store: CommunicationStore, agent?: Agent, config: ChannelGatewayConfig = {}) {
    this.store = store;
    this.agent = agent;
    this.config = {
      restrictStrangers: true,
      ...config
    };
  }

  setAgent(agent: Agent): void {
    this.agent = agent;
  }

  registerAdapter(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.type, adapter);
    adapter.onMessage(async (msg: InboundMessage) => {
      await this.handleInboundMessage(msg);
    });
  }

  getAdapter(type: ChannelType): ChannelAdapter | undefined {
    return this.adapters.get(type);
  }

  listAdapters(): ChannelAdapter[] {
    return Array.from(this.adapters.values());
  }

  async startAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.initialize();
      await adapter.start();
    }
  }

  async stopAll(): Promise<void> {
    for (const adapter of this.adapters.values()) {
      await adapter.stop();
    }
  }

  /**
   * Determine sender role: owner vs collaborator vs stranger.
   */
  resolveSenderRole(channelType: ChannelType, externalUserId: string, designatedRole?: ParticipantRole): ParticipantRole {
    if (designatedRole) return designatedRole;

    const owners = this.config.ownerIds || [];
    const ownerEmails = this.config.ownerEmails || [];

    if (owners.includes(externalUserId)) {
      return 'owner';
    }

    if (channelType === 'email') {
      const isEmailOwner = ownerEmails.some(e => externalUserId.toLowerCase().includes(e.toLowerCase()));
      if (isEmailOwner) return 'owner';
    }

    return 'stranger';
  }

  /**
   * Main Inbound Pipeline:
   * 1. Persistence & metadata resolution (channel, conversation, participant)
   * 2. Untrusted input boundary (PromptDefense)
   * 3. Privilege separation guard (strangers blocked from privileged actions)
   * 4. Agent reasoning loop execution
   * 5. Secret redaction & outbound delivery
   */
  async handleInboundMessage(msg: InboundMessage): Promise<OutboundMessageResult> {
    const timestamp = Date.now();

    // 1. Ensure channel recorded
    let channel = await this.store.getChannel(msg.channelId);
    if (!channel) {
      channel = await this.store.saveChannel({
        id: msg.channelId,
        type: msg.channelType,
        name: `${msg.channelType.toUpperCase()} Gateway Channel`,
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    // 2. Ensure conversation recorded
    let conversation = await this.store.getConversationByThread(msg.channelId, msg.externalThreadId);
    if (!conversation) {
      conversation = await this.store.saveConversation({
        id: msg.conversationId || `conv_${msg.channelType}_${msg.externalThreadId}`,
        channelId: msg.channelId,
        externalThreadId: msg.externalThreadId,
        title: `Thread ${msg.externalThreadId}`,
        activeSessionId: `${msg.channelType}_${msg.externalThreadId}`,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }

    // 3. Ensure participant recorded with authoritative role
    const role = this.resolveSenderRole(msg.channelType, msg.sender.externalUserId, msg.sender.role);
    let participant = await this.store.getParticipantByExternal(conversation.id, msg.sender.externalUserId);
    if (!participant) {
      participant = await this.store.saveParticipant({
        id: msg.sender.id || `part_${msg.channelType}_${msg.sender.externalUserId}`,
        conversationId: conversation.id,
        externalUserId: msg.sender.externalUserId,
        displayName: msg.sender.displayName || msg.sender.externalUserId,
        role,
        createdAt: timestamp
      });
    } else if (participant.role !== role) {
      participant.role = role;
      await this.store.saveParticipant(participant);
    }

    // 4. Untrusted Input Boundary (PromptDefense)
    const promptDefense = PromptDefense.getInstance();
    const defenseResult = promptDefense.analyzeAndSanitize(msg.content);
    let effectiveContent = msg.content;
    const metadata: Record<string, any> = {
      senderRole: role,
      injectionDetected: defenseResult.hasInjection,
      threats: defenseResult.threats
    };

    if (defenseResult.hasInjection) {
      effectiveContent = defenseResult.sanitizedContent;
    }

    // Save Inbound Message in store
    await this.store.saveMessage({
      id: msg.id,
      channelId: msg.channelId,
      conversationId: conversation.id,
      direction: 'inbound',
      senderId: participant.id,
      content: msg.content,
      attachments: msg.attachments,
      status: 'received',
      metadata,
      timestamp
    });

    // 5. Privilege Separation Guard (Spec Section 26, 27, 58, 66)
    // Strangers cannot trigger privileged or destructive system actions
    if (role === 'stranger' && this.config.restrictStrangers) {
      const isPrivilegedAttempt = PRIVILEGED_PATTERNS.some(p => p.test(msg.content));
      if (isPrivilegedAttempt) {
        const denialText = '⛔ Access Denied: Stranger / unauthorized participant cannot execute privileged or destructive actions on this system.';
        
        await this.store.saveMessage({
          id: `out_denied_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          channelId: msg.channelId,
          conversationId: conversation.id,
          direction: 'outbound',
          recipientId: participant.id,
          content: denialText,
          status: 'blocked_policy',
          replyToId: msg.id,
          metadata: { blockedReason: 'stranger_privilege_violation' },
          timestamp: Date.now()
        });

        const adapter = this.adapters.get(msg.channelType);
        if (adapter) {
          await adapter.send({
            channelId: msg.channelId,
            channelType: msg.channelType,
            conversationId: conversation.id,
            recipientId: participant.externalUserId,
            externalThreadId: msg.externalThreadId,
            content: denialText,
            replyToId: msg.id
          });
        }

        return {
          success: false,
          policyBlocked: true,
          error: 'Stranger privilege violation blocked by policy'
        };
      }
    }

    // 6. Execute Agent Core Reasoning Loop
    let responseText = '';
    if (this.agent) {
      try {
        const sessionId = conversation.activeSessionId || `${msg.channelType}_${msg.externalThreadId}`;
        const runRes = await this.agent.run(effectiveContent, [], { sessionId });
        responseText = (runRes as any)?.output || (runRes as any)?.result || String(runRes || '');
      } catch (err: any) {
        responseText = `An error occurred while processing your request: ${err.message}`;
      }
    } else {
      responseText = `[Athena Core Echo via ${msg.channelType}]: Received: ${effectiveContent}`;
    }

    // 7. Outbound Secret Redaction (CredentialManager)
    const credentialManager = CredentialManager.getInstance();
    const redactedResponse = credentialManager.redactString(responseText);

    // 8. Save Outbound Message in Store
    const outboundMsgId = `out_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    await this.store.saveMessage({
      id: outboundMsgId,
      channelId: msg.channelId,
      conversationId: conversation.id,
      direction: 'outbound',
      recipientId: participant.id,
      content: redactedResponse,
      status: 'sent',
      replyToId: msg.id,
      metadata: { sanitized: true },
      timestamp: Date.now()
    });

    // 9. Send via matching Channel Adapter
    const adapter = this.adapters.get(msg.channelType);
    if (!adapter) {
      return {
        success: false,
        error: `No adapter registered for channel type ${msg.channelType}`
      };
    }

    const sendRes = await adapter.send({
      id: outboundMsgId,
      channelId: msg.channelId,
      channelType: msg.channelType,
      conversationId: conversation.id,
      recipientId: participant.externalUserId,
      externalThreadId: msg.externalThreadId,
      content: redactedResponse,
      replyToId: msg.id
    });

    return sendRes;
  }
}
