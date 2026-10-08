import { Tool, ToolContext } from '../runtime/types.js';
import { AgentMailbox } from '../multiagent/agentMailbox.js';
import { AgentMessageType } from '../storage/stores/types.js';

export const agentMessageSendTool: Tool = {
  definition: {
    name: 'agentMessageSend',
    description: 'Send a structured A2A message to another specialized agent mailbox (supports request, response, handoff, question, blocked, status, artifact, approval, cancel).',
    parameters: {
      type: 'OBJECT',
      properties: {
        recipientId: {
          type: 'STRING',
          description: 'Recipient agent ID or role (e.g. "agent_coder", "agent_reviewer", "all").'
        },
        messageType: {
          type: 'STRING',
          description: 'Type of message: "request", "response", "handoff", "question", "blocked", "status", "artifact", "approval", or "cancel".'
        },
        payload: {
          type: 'STRING',
          description: 'Message content or JSON-encoded payload.'
        },
        goalId: {
          type: 'STRING',
          description: 'Optional associated goal ID.'
        },
        taskId: {
          type: 'STRING',
          description: 'Optional associated task ID.'
        },
        replyToId: {
          type: 'STRING',
          description: 'Optional ID of the message being replied to.'
        }
      },
      required: ['recipientId', 'messageType', 'payload']
    }
  },
  execute: async (args: any, context?: ToolContext) => {
    const memory = context?.memory;
    const store = (memory as any)?.getAgentMessageStore ? (memory as any).getAgentMessageStore() : null;
    if (!store) {
      return { success: false, error: 'AgentMessageStore is not available on memory facade.' };
    }

    const mailbox = new AgentMailbox(store);
    let payload = args.payload;
    try {
      if (typeof args.payload === 'string' && (args.payload.startsWith('{') || args.payload.startsWith('['))) {
        payload = JSON.parse(args.payload);
      }
    } catch {}

    const msg = await mailbox.send({
      senderId: context?.runId || 'primary_agent',
      recipientId: args.recipientId,
      messageType: args.messageType as AgentMessageType,
      payload,
      goalId: args.goalId,
      taskId: args.taskId,
      replyToId: args.replyToId
    });

    return {
      success: true,
      messageId: msg.id,
      recipientId: msg.recipientId,
      messageType: msg.messageType,
      status: msg.status
    };
  }
};

export const agentMailboxCheckTool: Tool = {
  definition: {
    name: 'agentMailboxCheck',
    description: 'Check an agent mailbox for pending, unread, or handoff messages.',
    parameters: {
      type: 'OBJECT',
      properties: {
        agentId: {
          type: 'STRING',
          description: 'The agent ID whose mailbox to check (defaults to current agent).'
        },
        goalId: {
          type: 'STRING',
          description: 'Optional filter by goal ID.'
        },
        taskId: {
          type: 'STRING',
          description: 'Optional filter by task ID.'
        },
        limit: {
          type: 'INTEGER',
          description: 'Maximum number of messages to retrieve.'
        }
      }
    }
  },
  execute: async (args: any, context?: ToolContext) => {
    const memory = context?.memory;
    const store = (memory as any)?.getAgentMessageStore ? (memory as any).getAgentMessageStore() : null;
    if (!store) {
      return { success: false, error: 'AgentMessageStore is not available on memory facade.' };
    }

    const mailbox = new AgentMailbox(store);
    const targetAgentId = args.agentId || context?.runId || 'primary_agent';
    const messages = await mailbox.receive(targetAgentId, {
      goalId: args.goalId,
      taskId: args.taskId,
      limit: args.limit || 10
    });

    return {
      success: true,
      agentId: targetAgentId,
      count: messages.length,
      messages: messages.map(m => ({
        id: m.id,
        senderId: m.senderId,
        messageType: m.messageType,
        payload: m.payload,
        status: m.status,
        createdAt: m.createdAt
      }))
    };
  }
};
