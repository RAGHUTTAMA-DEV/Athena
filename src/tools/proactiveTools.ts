import { Tool, ToolContext } from '../runtime/types.js';

export const proactiveHeartbeatConfigTool: Tool = {
  definition: {
    name: 'proactiveHeartbeatConfig',
    description: 'Inspect proactive heartbeat status and cost metrics, or update heartbeat interval and cost budget caps.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['status', 'update', 'cost_summary'],
          description: 'Action to perform: status (view engine config), update (change intervals/budget), cost_summary (view tokens & spend)'
        },
        intervalMs: {
          type: 'NUMBER',
          description: 'Heartbeat interval in milliseconds (e.g. 300000 for 5 minutes)'
        },
        costCapPerHourUsd: {
          type: 'NUMBER',
          description: 'Maximum allowable heartbeat reasoning cost per hour in USD (e.g. 0.50)'
        },
        maxDailyCostUsd: {
          type: 'NUMBER',
          description: 'Maximum daily heartbeat spend cap in USD'
        },
        sinceMs: {
          type: 'NUMBER',
          description: 'Time window in ms for cost_summary (defaults to last 1 hour)'
        }
      },
      required: ['action']
    }
  },
  manifest: {
    name: 'proactiveHeartbeatConfig',
    version: '1.0.0',
    description: 'Inspect and configure proactive heartbeat engine and spend budget caps',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 10000,
    permissions: ['system:state'],
    tags: ['proactive', 'heartbeat', 'autonomy', 'background'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    const memory = context?.memory as any;
    if (!memory || !memory.getHeartbeatEngine) {
      return { success: false, error: 'Memory context or HeartbeatEngine unavailable' };
    }

    const hbEngine = memory.getHeartbeatEngine();
    const hbStore = memory.getHeartbeatStore ? memory.getHeartbeatStore() : null;

    if (args.action === 'status') {
      const status = hbEngine.getStatus();
      return { success: true, ...status };
    }

    if (args.action === 'update') {
      const updates: any = {};
      if (typeof args.intervalMs === 'number') updates.intervalMs = args.intervalMs;
      if (typeof args.costCapPerHourUsd === 'number') updates.costCapPerHourUsd = args.costCapPerHourUsd;
      if (typeof args.maxDailyCostUsd === 'number') updates.maxDailyCostUsd = args.maxDailyCostUsd;

      hbEngine.updateConfig(updates);
      return { success: true, message: 'Heartbeat configuration updated', config: hbEngine.getConfig() };
    }

    if (args.action === 'cost_summary') {
      if (!hbStore) return { success: false, error: 'Heartbeat store unavailable' };
      const windowMs = args.sinceMs || 3600000;
      const since = Date.now() - windowMs;
      const summary = await hbStore.getCostSummary(since);
      return { success: true, since, windowMs, summary };
    }

    return { success: false, error: `Unknown action "${args.action}"` };
  }
};

export const webhookManageTool: Tool = {
  definition: {
    name: 'webhookManage',
    description: 'Manage secure webhook endpoints (register, list, delete) and inspect delivery receipts.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['register', 'list', 'delete', 'receipts'],
          description: 'Action to perform'
        },
        endpointId: {
          type: 'STRING',
          description: 'Unique endpoint identifier (e.g. "github_ci", "pagerduty")'
        },
        name: {
          type: 'STRING',
          description: 'Friendly name for the webhook endpoint'
        },
        secret: {
          type: 'STRING',
          description: 'Secret token or HMAC key for signature validation'
        },
        allowedTopics: {
          type: 'ARRAY',
          description: 'Allowed topic patterns (e.g. ["github:*"])'
        },
        requireSignature: {
          type: 'BOOLEAN',
          description: 'Whether incoming requests must provide valid HMAC-SHA256 signature'
        },
        limit: {
          type: 'NUMBER',
          description: 'Maximum receipts to return'
        }
      },
      required: ['action']
    }
  },
  manifest: {
    name: 'webhookManage',
    version: '1.0.0',
    description: 'Manage webhook endpoints and audit receipts',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 15000,
    permissions: ['system:state', 'net:http'],
    tags: ['proactive', 'webhook', 'security', 'events'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    const memory = context?.memory as any;
    if (!memory || !memory.getWebhookStore) return { success: false, error: 'Memory context unavailable' };
    const whStore = memory.getWebhookStore();
    if (!whStore) return { success: false, error: 'Webhook store unavailable' };

    if (args.action === 'list') {
      const endpoints = await whStore.listEndpoints();
      return { success: true, count: endpoints.length, endpoints };
    }

    if (args.action === 'register') {
      if (!args.endpointId || !args.secret) {
        return { success: false, error: 'endpointId and secret are required to register an endpoint' };
      }
      const now = Date.now();
      const endpoint = await whStore.saveEndpoint({
        id: args.endpointId,
        name: args.name || args.endpointId,
        secret: args.secret,
        allowedTopics: args.allowedTopics,
        isActive: true,
        requireSignature: args.requireSignature ?? true,
        createdAt: now,
        updatedAt: now
      });
      return { success: true, endpoint };
    }

    if (args.action === 'delete') {
      if (!args.endpointId) return { success: false, error: 'endpointId is required' };
      const deleted = await whStore.deleteEndpoint(args.endpointId);
      return { success: deleted, deletedEndpointId: args.endpointId };
    }

    if (args.action === 'receipts') {
      const receipts = await whStore.listReceipts(args.endpointId, args.limit || 20);
      return { success: true, count: receipts.length, receipts };
    }

    return { success: false, error: `Unknown action "${args.action}"` };
  }
};

export const eventReplayTool: Tool = {
  definition: {
    name: 'eventReplay',
    description: 'Query historical durable agent events and execute deterministic replays through the event pipeline.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['query', 'replay'],
          description: 'Action: "query" to list past events or "replay" to re-process events'
        },
        topic: {
          type: 'STRING',
          description: 'Exact topic to match'
        },
        topicPrefix: {
          type: 'STRING',
          description: 'Topic prefix (e.g. "webhook:", "monitor:")'
        },
        goalId: {
          type: 'STRING',
          description: 'Filter events bound to a specific goal'
        },
        status: {
          type: 'STRING',
          description: 'Filter by event status (e.g. pending, processed, dead_letter)'
        },
        limit: {
          type: 'NUMBER',
          description: 'Maximum events to process or return'
        }
      },
      required: ['action']
    }
  },
  manifest: {
    name: 'eventReplay',
    version: '1.0.0',
    description: 'Query historical durable events and trigger deterministic replays',
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 30000,
    permissions: ['system:state'],
    tags: ['proactive', 'events', 'replay', 'audit'],
    maxOutputBytes: 16384
  },
  execute: async (args: any, context?: ToolContext) => {
    const memory = context?.memory as any;
    if (!memory || !memory.getDurableAgentEventStore) return { success: false, error: 'Memory context unavailable' };
    const eventStore = memory.getDurableAgentEventStore();
    const pipeline = memory.getEventPipeline ? memory.getEventPipeline() : null;
    if (!eventStore) return { success: false, error: 'Event store unavailable' };

    const filter = {
      topic: args.topic,
      topicPrefix: args.topicPrefix,
      goalId: args.goalId,
      status: args.status,
      limit: args.limit || 50
    };

    if (args.action === 'query') {
      const events = await eventStore.list(filter);
      return { success: true, count: events.length, events };
    }

    if (args.action === 'replay') {
      if (!pipeline) return { success: false, error: 'Event pipeline unavailable' };
      const replayResult = await pipeline.replayEvents(filter);
      return { success: true, ...replayResult };
    }

    return { success: false, error: `Unknown action "${args.action}"` };
  }
};
