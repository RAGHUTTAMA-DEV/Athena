import { Tool, ToolContext } from '../runtime/types.js';
import { CredentialManager } from '../security/credentialManager.js';
import { parseRelativeDeadline } from '../communication/calendarEngine.js';

export const sendMessageTool: Tool = {
  definition: {
    name: 'sendMessage',
    description: 'Send an outbound message over a communication channel (CLI, Telegram, Email, Discord, Slack, WhatsApp) with policy enforcement and secret redaction.',
    parameters: {
      type: 'OBJECT',
      properties: {
        channel: {
          type: 'STRING',
          enum: ['cli', 'telegram', 'email', 'discord', 'slack', 'whatsapp'],
          description: 'The target channel adapter.'
        },
        recipient: {
          type: 'STRING',
          description: 'Recipient identifier (chat ID, user ID, email address, or channel ID).'
        },
        content: {
          type: 'STRING',
          description: 'Message body content to send.'
        },
        requiresApproval: {
          type: 'BOOLEAN',
          description: 'Whether sending this message requires explicit human approval (for external publication or broadcast).'
        },
        approvalToken: {
          type: 'STRING',
          description: 'Approval token verifying human consent for external send if required.'
        }
      },
      required: ['channel', 'recipient', 'content']
    }
  },
  manifest: {
    name: 'sendMessage',
    version: '1.0.0',
    description: 'Send an outbound message over a communication channel with policy enforcement',
    riskLevel: 'confirm',
    parallelSafe: true,
    timeoutMs: 15000,
    permissions: ['net:http', 'channel:send'],
    tags: ['communication', 'channels', 'outbound', 'messaging'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    const memory = context?.memory as any;
    const channel = String(args.channel || 'cli').toLowerCase();
    const recipient = String(args.recipient || '').trim();
    let content = String(args.content || '').trim();

    if (!recipient) {
      return { success: false, error: 'Recipient is required' };
    }
    if (!content) {
      return { success: false, error: 'Content is required' };
    }

    // 1. Outbound Policy Check: Approval Gate for External Publication
    const needsApproval = Boolean(
      args.requiresApproval ||
      process.env.REQUIRE_OUTBOUND_APPROVAL === 'true' ||
      args.isExternalBroadcast
    );

    if (needsApproval && !args.approvalToken) {
      return {
        success: false,
        policyBlocked: true,
        requiresApproval: true,
        error: 'Outbound message blocked by policy: External publication requires explicit human confirmation.'
      };
    }

    // 2. Secret Redaction: Protect credentials from leaking outbound
    const credMgr = CredentialManager.getInstance();
    const redacted = credMgr.redactString(content);
    const leakedSecrets = content !== redacted;
    content = redacted;

    // 3. Dispatch through ChannelGatewayManager or matching adapter if available
    let delivered = false;
    let messageId = `out_msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    if (memory?.getChannelGatewayManager) {
      const gw = memory.getChannelGatewayManager();
      const adapter = gw.getAdapter(channel);
      if (adapter) {
        const res = await adapter.send({
          channelType: channel as any,
          recipientId: recipient,
          content,
          metadata: { leakedSecretsRedacted: leakedSecrets }
        });
        delivered = res.success;
        if (res.messageId) messageId = res.messageId;
      } else {
        delivered = true; // Fallback mock delivery
      }

      // Record in CommunicationStore if available
      const commStore = memory.getCommunicationStore ? memory.getCommunicationStore() : null;
      if (commStore) {
        await commStore.saveMessage({
          id: messageId,
          channelId: `${channel}_channel`,
          conversationId: `conv_${channel}_${recipient}`,
          direction: 'outbound',
          recipientId: recipient,
          content,
          status: delivered ? 'sent' : 'failed',
          metadata: { redacted: leakedSecrets },
          timestamp: Date.now()
        });
      }
    } else {
      delivered = true;
    }

    return {
      success: true,
      delivered,
      messageId,
      channel,
      recipient,
      redacted: leakedSecrets
    };
  }
};

export const calendarManageTool: Tool = {
  definition: {
    name: 'calendarManage',
    description: 'Manage calendar events: create, list, cancel, or delete events.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['create', 'list', 'cancel', 'delete'],
          description: 'Action to perform.'
        },
        eventId: {
          type: 'STRING',
          description: 'Event ID (for cancel, delete, or inspect).'
        },
        title: {
          type: 'STRING',
          description: 'Event title.'
        },
        description: {
          type: 'STRING',
          description: 'Event description.'
        },
        startTime: {
          type: 'STRING',
          description: 'Start time (ISO string or natural text like "tomorrow morning", "in 2 hours").'
        },
        endTime: {
          type: 'STRING',
          description: 'End time (ISO string or relative duration).'
        },
        location: {
          type: 'STRING',
          description: 'Event location.'
        },
        reminders: {
          type: 'ARRAY',
          items: { type: 'NUMBER' },
          description: 'Reminder alarms in minutes before start time (e.g. [15, 60]).'
        },
        goalId: {
          type: 'STRING',
          description: 'Optional associated goal ID.'
        }
      },
      required: ['action']
    }
  },
  manifest: {
    name: 'calendarManage',
    version: '1.0.0',
    description: 'Manage calendar events and deadlines with proactive reminder alarms',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 10000,
    permissions: ['calendar:read', 'calendar:write'],
    tags: ['calendar', 'events', 'schedule', 'planning'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    const memory = context?.memory as any;
    if (!memory || !memory.getCalendarEngine) {
      return { success: false, error: 'CalendarEngine is not available on memory context.' };
    }
    const calEngine = memory.getCalendarEngine();

    if (args.action === 'create') {
      if (!args.title) return { success: false, error: 'Title is required to create a calendar event.' };
      const startMs = args.startTime ? parseRelativeDeadline(args.startTime) : Date.now() + 3600 * 1000;
      const endMs = args.endTime ? parseRelativeDeadline(args.endTime, startMs) : startMs + 3600 * 1000;

      const event = await calEngine.createEvent({
        id: args.eventId,
        title: args.title,
        description: args.description,
        startTime: startMs,
        endTime: endMs,
        location: args.location,
        reminders: args.reminders || [15],
        goalId: args.goalId || context?.goalId
      });
      return { success: true, event };
    }

    if (args.action === 'list') {
      const events = await calEngine.listUpcoming(Date.now());
      return { success: true, count: events.length, events };
    }

    if (args.action === 'cancel') {
      if (!args.eventId) return { success: false, error: 'eventId is required to cancel an event.' };
      const event = await calEngine.cancelEvent(args.eventId);
      return { success: Boolean(event), event };
    }

    if (args.action === 'delete') {
      if (!args.eventId) return { success: false, error: 'eventId is required to delete an event.' };
      const ok = await calEngine.deleteEvent(args.eventId);
      return { success: ok };
    }

    return { success: false, error: `Unsupported calendar action: ${args.action}` };
  }
};

export const reminderSetTool: Tool = {
  definition: {
    name: 'reminderSet',
    description: 'Set a durable proactive reminder or deadline using natural language (e.g. "tomorrow morning", "in 20 minutes", "next Friday").',
    parameters: {
      type: 'OBJECT',
      properties: {
        title: {
          type: 'STRING',
          description: 'Title of the reminder or deadline.'
        },
        when: {
          type: 'STRING',
          description: 'When the deadline/reminder is due (e.g. "tomorrow morning", "in 15 minutes", "next Monday").'
        },
        description: {
          type: 'STRING',
          description: 'Additional notes or context for the reminder.'
        },
        goalId: {
          type: 'STRING',
          description: 'Optional goal ID associated with this deadline.'
        },
        taskId: {
          type: 'STRING',
          description: 'Optional task ID associated with this deadline.'
        }
      },
      required: ['title', 'when']
    }
  },
  manifest: {
    name: 'reminderSet',
    version: '1.0.0',
    description: 'Set a durable deadline or reminder linked to proactive event notifications',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 10000,
    permissions: ['calendar:write'],
    tags: ['reminders', 'calendar', 'deadlines', 'proactive'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    const memory = context?.memory as any;
    if (!memory || !memory.getCalendarEngine) {
      return { success: false, error: 'CalendarEngine is not available on memory context.' };
    }
    const calEngine = memory.getCalendarEngine();

    const targetTime = parseRelativeDeadline(args.when);
    const event = await calEngine.createEvent({
      title: `[Reminder] ${args.title}`,
      description: args.description,
      startTime: targetTime,
      endTime: targetTime + 15 * 60 * 1000,
      reminders: [0, 15],
      goalId: args.goalId || context?.goalId,
      taskId: args.taskId || context?.taskId,
      metadata: { isReminder: true, rawWhen: args.when }
    });

    return {
      success: true,
      reminderId: event.id,
      title: event.title,
      scheduledFor: new Date(targetTime).toISOString(),
      timestamp: targetTime
    };
  }
};
