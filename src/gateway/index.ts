export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export * from './telegram.js';
export * from './channelGatewayManager.js';
export * from './adapters/cliAdapter.js';
export * from './adapters/telegramAdapter.js';
export * from './adapters/emailAdapter.js';
export * from './adapters/discordAdapter.js';
export * from './adapters/slackAdapter.js';
export * from './adapters/whatsappAdapter.js';
