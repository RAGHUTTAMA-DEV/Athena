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
  // Map of chatId to Map of taskId to current status string
  private chatStatuses: Map<number, Map<string, string>> = new Map();
  // Map of chatId to active session name
  private chatActiveSessions: Map<number, string> = new Map();

  private getSessionId(chatId: number): string {
    const sessionName = this.chatActiveSessions.get(chatId) || 'default';
    return `telegram_${chatId}_${sessionName}`;
  }

  private getSessionName(sessionId: string, chatId: number): string | null {
    const prefix = `telegram_${chatId}_`;
    if (sessionId.startsWith(prefix)) {
      return sessionId.substring(prefix.length);
    }
    return null;
  }

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
      const sessionId = this.getSessionId(chatId);
      const sessionName = this.chatActiveSessions.get(chatId) || 'default';
      try {
        const agent = new Agent({
          modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
          systemPrompt: DEFAULT_AGENT_PROMPT,
          soulPath: './SOUL.md',
          dbPath: process.env.DATABASE_PATH || './state.db'
        });
        await agent.init();
        await agent.clearHistory(sessionId);
        ctx.reply(`🧹 Chat and database history cleared for session "${sessionName}".`);
      } catch (err: any) {
        ctx.reply(`🧹 Chat history cleared in-memory, but database failed: ${err.message}`);
      }
    });

    // Command /sessions (alias for listing)
    this.bot.command('sessions', async (ctx) => {
      await this.handleSessionCommand(ctx, 'list');
    });

    // Command /switch to switch sessions directly
    this.bot.command('switch', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const sessionName = parts.slice(1).join(' ');
      await this.handleSessionCommand(ctx, 'switch', sessionName);
    });

    // Command /session with subcommands
    this.bot.command('session', async (ctx) => {
      const parts = ctx.message.text.trim().split(/\s+/);
      const sub = parts[1]?.toLowerCase() || 'help';
      const arg = parts.slice(2).join(' ');
      await this.handleSessionCommand(ctx, sub, arg);
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

  private async handleSessionCommand(ctx: any, action: string, arg?: string) {
    const chatId = ctx.chat.id;
    const agent = new Agent({
      modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
      systemPrompt: DEFAULT_AGENT_PROMPT,
      soulPath: './SOUL.md',
      dbPath: process.env.DATABASE_PATH || './state.db'
    });
    await agent.init();

    if (action === 'help') {
      await ctx.reply(
        `💬 *Athena Sessions Help:*\n\n` +
        `• \`/session list\` (or \`/sessions\`) - List all your sessions\n` +
        `• \`/session switch <name>\` (or \`/switch <name>\`) - Switch to or create a session\n` +
        `• \`/session rename <new_name>\` - Rename current session\n` +
        `• \`/session delete <name>\` - Delete a session's history\n` +
        `• \`/session current\` - Show active session name\n` +
        `• \`/session help\` - Show this help message`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    if (action === 'list') {
      try {
        const list = await agent.getSessionsList();
        const activeName = this.chatActiveSessions.get(chatId) || 'default';
        
        const prefix = `telegram_${chatId}_`;
        const mySessions = list
          .filter(s => s.sessionId.startsWith(prefix))
          .map(s => ({
            name: s.sessionId.substring(prefix.length),
            count: s.messageCount,
            lastActive: s.lastActive
          }));

        const formatTime = (ts: number) => {
          const diff = Date.now() - ts;
          const secs = Math.floor(diff / 1000);
          const mins = Math.floor(secs / 60);
          const hrs = Math.floor(mins / 60);
          const days = Math.floor(hrs / 24);
          if (secs < 5) return 'just now';
          if (secs < 60) return `${secs}s ago`;
          if (mins < 60) return `${mins}m ago`;
          if (hrs < 24) return `${hrs}h ago`;
          return `${days}d ago`;
        };

        let msg = `💬 *Your Chat Sessions:*\n\n`;
        if (mySessions.length === 0) {
          msg += `No active sessions found. The default session is \`${activeName}\`.`;
        } else {
          mySessions.forEach(s => {
            const activeMarker = s.name === activeName ? ' 🌟 *(active)*' : '';
            msg += `• \`${s.name}\` (${s.count} messages, active ${formatTime(s.lastActive)})${activeMarker}\n`;
          });
        }
        await ctx.reply(msg, { parse_mode: 'Markdown' });
      } catch (err: any) {
        await ctx.reply(`❌ Failed to list sessions: ${err.message}`);
      }
      return;
    }

    if (action === 'current') {
      const activeName = this.chatActiveSessions.get(chatId) || 'default';
      await ctx.reply(`💬 *Active Session:* \`${activeName}\``, { parse_mode: 'Markdown' });
      return;
    }

    if (action === 'switch' || action === 'create') {
      const sessionName = arg?.trim();
      if (!sessionName) {
        await ctx.reply(`⚠️ Please specify a session name. Example: \`/switch development\``, { parse_mode: 'Markdown' });
        return;
      }

      this.chatActiveSessions.set(chatId, sessionName);
      this.chatHistories.delete(chatId);

      await ctx.reply(`✅ Switched to session: \`${sessionName}\``, { parse_mode: 'Markdown' });

      const sessionId = this.getSessionId(chatId);
      if ((agent as any).memory) {
        try {
          const history = await (agent as any).memory.loadHistory(sessionId, 4);
          if (history.length > 0) {
            let contextMsg = `⏳ *Recent Session Messages:*\n\n`;
            history.forEach((msg: any) => {
              const sender = msg.role === 'user' ? '👤 *You*' : '🤖 *Athena*';
              const text = msg.parts.map((p: any) => p.text).join(' ');
              contextMsg += `${sender}: ${text}\n`;
            });
            await ctx.reply(contextMsg, { parse_mode: 'Markdown' });
          } else {
            await ctx.reply(`✨ Starting a fresh history in this session.`);
          }
        } catch (e: any) {
          console.warn(`[Telegram Session Switch Context Error] ${e.message}`);
        }
      }
      return;
    }

    if (action === 'rename') {
      const newName = arg?.trim();
      if (!newName) {
        await ctx.reply(`⚠️ Please specify a new session name. Example: \`/session rename project_athena\``, { parse_mode: 'Markdown' });
        return;
      }

      try {
        const oldName = this.chatActiveSessions.get(chatId) || 'default';
        const oldSessionId = `telegram_${chatId}_${oldName}`;
        const newSessionId = `telegram_${chatId}_${newName}`;

        await agent.renameSession(oldSessionId, newSessionId);
        this.chatActiveSessions.set(chatId, newName);
        await ctx.reply(`✅ Session renamed from \`${oldName}\` to \`${newName}\` successfully.`, { parse_mode: 'Markdown' });
      } catch (err: any) {
        await ctx.reply(`❌ Failed to rename session: ${err.message}`);
      }
      return;
    }

    if (action === 'delete') {
      const targetName = arg?.trim();
      if (!targetName) {
        await ctx.reply(`⚠️ Please specify a session name to delete. Example: \`/session delete temp_session\``, { parse_mode: 'Markdown' });
        return;
      }

      try {
        const targetSessionId = `telegram_${chatId}_${targetName}`;
        await agent.clearHistory(targetSessionId);
        const currentName = this.chatActiveSessions.get(chatId) || 'default';
        if (targetName === currentName) {
          this.chatHistories.delete(chatId);
        }
        await ctx.reply(`✅ Session \`${targetName}\` history deleted successfully.`, { parse_mode: 'Markdown' });
      } catch (err: any) {
        await ctx.reply(`❌ Failed to delete session: ${err.message}`);
      }
      return;
    }

    await ctx.reply(`❌ Subcommand not recognized. Type \`/session help\` for session commands.`, { parse_mode: 'Markdown' });
  }

  private async runAgentFlow(ctx: any) {
    const chatId = ctx.chat.id;
    const userText = ctx.message.text.trim();

    if (!userText) return;

    const parentTaskId = `parent-${Math.random().toString(36).substring(2, 7)}`;

    // Get or create history
    if (!this.chatHistories.has(chatId)) {
      this.chatHistories.set(chatId, []);
    }
    const history = this.chatHistories.get(chatId)!;

    // Initialize status map for this chat
    if (!this.chatStatuses.has(chatId)) {
      this.chatStatuses.set(chatId, new Map());
    }
    const statuses = this.chatStatuses.get(chatId)!;
    statuses.clear();

    // Instantiate a new agent run
    const agent = new Agent({
      modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
      systemPrompt: DEFAULT_AGENT_PROMPT,
      soulPath: './SOUL.md',
      dbPath: process.env.DATABASE_PATH || './state.db',
      taskId: parentTaskId
    });

    await agent.init();

    // Send initial status message
    const statusMsg = await ctx.reply('🤔 thinking...');

    const updateStatus = async (taskId: string, msg: string) => {
      statuses.set(taskId, msg);

      const lines: string[] = [];
      for (const [tid, text] of statuses.entries()) {
        lines.push(`• **[${tid}]**: ${text}`);
      }
      const combinedMsg = `⏳ *Agent Progress:*\n\n${lines.join('\n')}`;

      try {
        await ctx.telegram.editMessageText(chatId, statusMsg.message_id, undefined, combinedMsg, { parse_mode: 'Markdown' });
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
      await updateStatus(parentTaskId, `⏳ Awaiting confirmation for \`${toolName}\`...`);

      // Wait for resolve
      console.log(`[Telegram Debug] Registering confirmation: ${confirmId} for tool: ${toolName}`);
      return new Promise<boolean>((resolve) => {
        this.pendingConfirmations.set(confirmId, resolve);
      });
    };

    let currentTraceId: string | undefined = undefined;

    try {
      const sessionId = this.getSessionId(chatId);
      const reply = await agent.run(
        userText,
        history,
        (status) => {
          if (!currentTraceId) {
            try {
              currentTraceId = getActiveTraceId();
            } catch (e) {}
          }
          
          let taskId = parentTaskId;
          let cleanMessage = status.message;

          // Try to extract taskId prefix
          const match = status.message.match(/^\[([^\]]+)\]\s*(.*)/);
          if (match) {
            taskId = match[1];
            cleanMessage = match[2];
          }

          let icon = 'ℹ️';
          if (status.type === 'thought') icon = '🧠';
          else if (status.type === 'memory') icon = '💾';
          else if (status.type === 'tool_call') icon = '⚙️';
          else if (status.type === 'tool_response') icon = '📥';
          else if (status.type === 'error') icon = '⚠️';

          updateStatus(taskId, `${icon} ${cleanMessage}`).catch(() => {});
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
        await updateStatus(parentTaskId, `❌ Failed: ${err.message}`);
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
          maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
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
