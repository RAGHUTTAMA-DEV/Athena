import { Telegraf, Markup } from 'telegraf';
import { Gateway } from './index.js';
import { Agent } from '../core/agent.js';
import { Message } from '../core/types.js';
import { DEFAULT_AGENT_PROMPT } from '../prompts/agentPrompt.js';
import { Scheduler } from '../core/scheduler.js';
import { EpisodicMemory } from '../core/memory.js';
import { getActiveTraceId } from '@langfuse/tracing';
import { Langfuse } from 'langfuse';


export class TelegramGateway implements Gateway {
  private bot: Telegraf;
  private chatHistories: Map<number, Message[]> = new Map();
  // Map of unique confirmation ID to its resolve callback
  private pendingConfirmations: Map<string, (approved: boolean) => void> = new Map();

  constructor() {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token || token === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
      throw new Error('TELEGRAM_BOT_TOKEN is not configured. Please set your bot token in the .env file.');
    }
    this.bot = new Telegraf(token);
    this.bot.catch((err: any, ctx) => {
      console.error(`[Telegram Bot Catch] Error for ${ctx.updateType}:`, err.message || err);
    });
    this.setupHandlers();
  }

  private setupHandlers() {
    // Command /start
    this.bot.start((ctx) => {
      ctx.reply(
        '👋 Welcome to Athena local agent!\n\n' +
        'Send me any message to interact with the agent. ' +
        'If the agent requests a risky tool execution (like executing terminal commands or modifying files), ' +
        'you will be asked to confirm via interactive buttons.'
      );
    });

    // Command /clear to reset history
    this.bot.command('clear', async (ctx) => {
      const chatId = ctx.chat.id;
      this.chatHistories.delete(chatId);
      const sessionId = `telegram_${chatId}`;
      try {
        const agent = new Agent({
          modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          maxTurns: 10,
          systemPrompt: DEFAULT_AGENT_PROMPT,
          soulPath: './SOUL.md',
          dbPath: process.env.DATABASE_PATH || './state.db'
        });
        await agent.init();
        await agent.clearHistory(sessionId);
        ctx.reply('🧹 Chat and database history cleared for this session.');
      } catch (err: any) {
        ctx.reply(`🧹 Chat history cleared in-memory, but database failed: ${err.message}`);
      }
    });

    // Handle button clicks for approvals
    this.bot.on('callback_query', async (ctx) => {
      const callbackData = (ctx.callbackQuery as any).data;
      if (!callbackData) return;

      console.log(`[Telegram Debug] callback_query received: ${callbackData}`);

      // Handle user feedback callbacks
      if (callbackData.startsWith('like_') || callbackData.startsWith('dislike_')) {
        const parts = callbackData.split('_');
        const action = parts[0];
        const traceId = parts.slice(1).join('_');

        try {
          await ctx.answerCbQuery('Thank you for your feedback!');
        } catch (e) {}

        try {
          const langfuse = new Langfuse({
            publicKey: process.env.LANGFUSE_PUBLIC_KEY,
            secretKey: process.env.LANGFUSE_SECRET_KEY,
            baseUrl: process.env.LANGFUSE_BASE_URL,
          });

          await langfuse.score({
            traceId,
            name: 'user-feedback',
            value: action === 'like' ? 1 : 0,
            dataType: 'NUMERIC',
          });

          await langfuse.flushAsync();

          const originalText = (ctx.callbackQuery.message as any).text || '';
          await ctx.editMessageText(
            `${originalText}\n\n_${action === 'like' ? '👍 Liked' : '👎 Disliked'} (feedback submitted)_`
          );
        } catch (err: any) {
          console.error('[Telegram Feedback Error]', err.message);
        }
        return;
      }

      const [action, confirmId] = callbackData.split('_');
      if (!action || !confirmId) return;

      // Always answer the callback query to clear the loading spinner
      try {
        await ctx.answerCbQuery();
      } catch (e) {}

      const resolveFn = this.pendingConfirmations.get(confirmId);
      console.log(`[Telegram Debug] resolveFn for ${confirmId} found: ${!!resolveFn}`);
      if (resolveFn) {
        this.pendingConfirmations.delete(confirmId);
        
        const approved = action === 'allow';
        resolveFn(approved);

        // Edit the message to show result and remove inline buttons
        const originalText = (ctx.callbackQuery.message as any).text || '';
        const statusText = approved ? '🟢 Approved ✅' : '🔴 Denied ❌';
        
        try {
          await ctx.editMessageText(
            `${originalText}\n\n**Status: ${statusText}**`,
            { parse_mode: 'Markdown' }
          );
        } catch (e: any) {
          console.warn(`[Telegram Warning] Could not edit confirmation message: ${e.message}`);
        }
      }
    });

    // Handle normal text messages
    this.bot.on('text', (ctx) => {
      this.runAgentFlow(ctx).catch(err => {
        console.error('[Telegram Handler Error]', err);
      });
    });
  }

  private async runAgentFlow(ctx: any) {
    const chatId = ctx.chat.id;
    const userText = ctx.message.text.trim();

    if (!userText) return;

    // Get or create history
    if (!this.chatHistories.has(chatId)) {
      this.chatHistories.set(chatId, []);
    }
    const history = this.chatHistories.get(chatId)!;

    // Instantiate a new agent run
    const agent = new Agent({
      modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxTurns: 10,
      systemPrompt: DEFAULT_AGENT_PROMPT,
      soulPath: './SOUL.md',
      dbPath: process.env.DATABASE_PATH || './state.db'
    });

    await agent.init();

    // Send initial status message
    const statusMsg = await ctx.reply('🤔 thinking...');

    const updateStatus = async (msg: string) => {
      try {
        await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, msg, { parse_mode: 'Markdown' });
      } catch (e) {
        // Avoid logging spam errors if text is identical
      }
    };

    // Confirm callback
    const confirmCallback = async (toolName: string, args: any): Promise<boolean> => {
      const confirmId = Math.random().toString(36).substring(2, 8);
      
      const messageText = 
        `⚠️ *Risky action requested!*\n\n` +
        `*Tool:* \`${toolName}\`\n` +
        `*Arguments:*\n\`\`\`json\n${JSON.stringify(args, null, 2)}\n\`\`\``;

      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback('Allow ✅', `allow_${confirmId}`),
        Markup.button.callback('Deny ❌', `deny_${confirmId}`)
      ]);

      await ctx.reply(messageText, { parse_mode: 'Markdown', reply_markup: keyboard.reply_markup });

      // Update main thinking message to note we are waiting for permission
      await updateStatus(`⏳ Awaiting confirmation for \`${toolName}\`...`);

      // Wait for resolve
      console.log(`[Telegram Debug] Registering confirmation: ${confirmId} for tool: ${toolName}`);
      return new Promise<boolean>((resolve) => {
        this.pendingConfirmations.set(confirmId, resolve);
      });
    };

    let currentTraceId: string | undefined = undefined;

    try {
      const sessionId = `telegram_${chatId}`;
      const reply = await agent.run(
        userText,
        history,
        (status) => {
          if (!currentTraceId) {
            try {
              currentTraceId = getActiveTraceId();
            } catch (e) {}
          }
          if (status.type === 'thought') {
            updateStatus(`🧠 ${status.message}`).catch(() => {});
          } else if (status.type === 'memory') {
            updateStatus(`💾 ${status.message}`).catch(() => {});
          } else if (status.type === 'tool_call') {
            updateStatus(`⚙️ ${status.message}`).catch(() => {});
          } else if (status.type === 'tool_response') {
            updateStatus(`📥 ${status.message}`).catch(() => {});
          } else if (status.type === 'error') {
            updateStatus(`⚠️ ${status.message}`).catch(() => {});
          }
        },
        confirmCallback,
        sessionId
      );

      // Delete the typing/status message and send final answer
      try {
        await ctx.telegram.deleteMessage(chatId, statusMsg.message_id);
      } catch (e) {}

      const finalReply = (reply && reply.trim() !== '') ? reply : '✅ Operation completed successfully.';
      
      let keyboard = undefined;
      if (currentTraceId) {
        keyboard = Markup.inlineKeyboard([
          Markup.button.callback('👍 Like', `like_${currentTraceId}`),
          Markup.button.callback('👎 Dislike', `dislike_${currentTraceId}`)
        ]);
      }

      await ctx.reply(finalReply, keyboard);
    } catch (err: any) {
      console.error('[Telegram Error]', err);
      try {
        await updateStatus(`❌ Failed: ${err.message}`);
      } catch (e) {
        await ctx.reply(`❌ Failed: ${err.message}`);
      }
    }
  }

  async start(): Promise<void> {
    console.log('[Telegram Gateway] Starting Telegram Bot polling...');
    
    // Wire up and start Scheduler for Telegram Gateway mode
    try {
      const dbPath = process.env.DATABASE_PATH || './state.db';
      const memory = new EpisodicMemory(dbPath);
      await memory.init();

      const scheduler = Scheduler.getInstance();
      scheduler.setMemory(memory);
      
      scheduler.setRunner(async (prompt, sessionId) => {
        const agent = new Agent({
          modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          maxTurns: 10,
          systemPrompt: DEFAULT_AGENT_PROMPT,
          soulPath: './SOUL.md',
          dbPath: dbPath
        });
        await agent.init();
        const history: Message[] = [];
        return agent.run(prompt, history, undefined, undefined, sessionId);
      });

      scheduler.setNotifier(async (sessionId, result) => {
        if (sessionId.startsWith('telegram_')) {
          const chatId = parseInt(sessionId.split('_')[1], 10);
          try {
            await this.bot.telegram.sendMessage(chatId, `⏰ *[Scheduled task triggered]*\n\n${result}`, { parse_mode: 'Markdown' });
          } catch (err: any) {
            console.error(`[Scheduler Telegram Notification Error] Failed to send to chat ${chatId}:`, err.message);
          }
        } else {
          console.log(`\n⏰ [Scheduler Notification] [Session: ${sessionId}]\n${result}\n`);
        }
      });

      await scheduler.start();
      console.log('[Telegram Gateway] Scheduler started successfully.');
    } catch (err: any) {
      console.error('[Telegram Gateway] Failed to start Scheduler:', err.message);
    }

    const launchBot = async () => {
      try {
        await this.bot.launch();
        console.log('[Telegram Gateway] Bot successfully launched.');
      } catch (err: any) {
        console.error('[Telegram Gateway] Failed to launch bot. Retrying in 5 seconds...', err.message || err);
        setTimeout(launchBot, 5000);
      }
    };

    launchBot();
  }

  async stop(): Promise<void> {
    console.log('[Telegram Gateway] Stopping Telegram Bot and Scheduler...');
    const scheduler = Scheduler.getInstance();
    await scheduler.stop();
    this.bot.stop();
  }
}
