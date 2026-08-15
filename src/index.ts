import './core/dnsFix.js';

import * as dotenv from 'dotenv';
dotenv.config();

import './core/instrumentation.js';

import { Agent } from './core/agent.js';
import { Message } from './core/types.js';
import { DEFAULT_AGENT_PROMPT } from './prompts/index.js';
import { TelegramGateway } from './gateway/telegram.js';
import { Scheduler } from './core/scheduler.js';
import { MCPManager } from './core/mcpManager.js';
import { registerDynamicTools } from './tools/index.js';
import { ui } from './cli/ui.js';
import * as readline from 'readline';

const allowAll =
  process.argv.some(a => a.toLowerCase() === '--allow-all') ||
  process.env.ATHENA_ALLOW_ALL === '1';

let rl: readline.Interface;

const cliConfirm = (toolName: string, args: any): Promise<boolean> => {
  if (allowAll) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    ui.confirm(toolName, args);
    rl.question(ui.confirmAsk(), (answer) => {
      const approved = answer.trim().toLowerCase() === 'y' || answer.trim().toLowerCase() === 'yes';
      ui.confirmResult(approved);
      resolve(approved);
    });
  });
};

async function startGateway(type: string, mcpTools = 0) {
  ui.banner({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    session: `gateway:${type}`,
    mcpTools,
    allowAll
  });

  if (type.toLowerCase() === 'telegram') {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      ui.err('TELEGRAM_BOT_TOKEN is not defined in .env');
      process.exit(1);
    }
    const gateway = new TelegramGateway();
    await gateway.start();
    ui.ok('Telegram gateway running. Ctrl+C to stop.');
  } else {
    ui.err(`Unsupported gateway type: "${type}". Only "telegram" is supported.`);
    process.exit(1);
  }
}

async function startCli(mcpTools = 0) {
  if (!process.env.GEMINI_API_KEY) {
    ui.err('GEMINI_API_KEY is not defined in .env');
    process.exit(1);
  }

  const modelName = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  let currentSessionId = 'cli';

  ui.banner({ model: modelName, session: currentSessionId, mcpTools, allowAll });

  const agent = new Agent({
    modelName,
    maxTurns: 10,
    systemPrompt: DEFAULT_AGENT_PROMPT,
    soulPath: './SOUL.md',
    dbPath: process.env.DATABASE_PATH || './state.db'
  });

  ui.sys('loading SOUL.md and memory');
  await agent.init();
  ui.ok('agent online');

  if ((agent as any).memory) {
    const scheduler = Scheduler.getInstance();
    scheduler.setMemory((agent as any).memory);
    scheduler.setRunner(async (prompt, sessionId) => {
      const history: Message[] = [];
      return agent.run(prompt, history, (status) => ui.event(status), undefined, sessionId);
    });
    scheduler.setNotifier(async (sessionId, result) => {
      ui.cron(sessionId, result);
    });
    await scheduler.start();
    ui.sys('scheduler armed');
  }

  function formatRelativeTime(timestamp: number): string {
    const diffMs = Date.now() - timestamp;
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 5) return 'just now';
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHour < 24) return `${diffHour}h ago`;
    return `${diffDay}d ago`;
  }

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const chatHistory: Message[] = [];

  const askPrompt = () => {
    rl.question(ui.prompt(currentSessionId), async (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        ui.sys('farewell');
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === 'clear') {
        chatHistory.length = 0;
        try {
          await agent.clearHistory(currentSessionId);
          ui.ok(`cleared '${currentSessionId}'`);
        } catch (err: any) {
          ui.err(err.message);
        }
        askPrompt();
        return;
      }

      const lowerInput = trimmed.toLowerCase();
      const isSessionCmd = lowerInput.startsWith('/session') || lowerInput.startsWith('/switch') || lowerInput.startsWith('/sessions');
      if (isSessionCmd) {
        const parts = trimmed.split(/\s+/);
        const mainCmd = parts[0].toLowerCase();

        let action = '';
        let arg = '';

        if (mainCmd === '/sessions') {
          action = 'list';
        } else if (mainCmd === '/switch') {
          action = 'switch';
          arg = parts.slice(1).join(' ');
        } else if (mainCmd === '/session') {
          const sub = parts[1]?.toLowerCase() || 'help';
          action = sub;
          if (sub === 'switch' || sub === 'delete' || sub === 'create' || sub === 'rename') {
            arg = parts.slice(2).join(' ');
          }
        }

        if (action === 'help') {
          ui.sessionsHelp();
          askPrompt();
          return;
        }

        if (action === 'list') {
          try {
            const list = await agent.getSessionsList();
            ui.sessionList(list.map(s => ({
              sessionId: s.sessionId,
              messageCount: s.messageCount,
              lastActive: formatRelativeTime(s.lastActive),
              active: s.sessionId === currentSessionId
            })));
          } catch (err: any) {
            ui.err(err.message);
          }
          askPrompt();
          return;
        }

        if (action === 'current') {
          ui.sys(`session ${currentSessionId}`);
          askPrompt();
          return;
        }

        if (action === 'switch' || action === 'create') {
          const sessionName = arg.trim();
          if (!sessionName) {
            ui.err('usage: /session switch <name>');
            askPrompt();
            return;
          }

          currentSessionId = sessionName;
          chatHistory.length = 0;
          ui.ok(`session → ${currentSessionId}`);

          if ((agent as any).memory) {
            try {
              const history = await (agent as any).memory.loadHistory(currentSessionId, 6);
              ui.historyPreview(history.map((msg: any) => ({
                role: msg.role,
                text: (msg.parts || []).map((p: any) => p.text || '').join(' ')
              })));
            } catch (e: any) {
              ui.err(e.message);
            }
          }
          askPrompt();
          return;
        }

        if (action === 'rename') {
          const newName = arg.trim();
          if (!newName) {
            ui.err('usage: /session rename <name>');
            askPrompt();
            return;
          }

          try {
            const oldName = currentSessionId;
            await agent.renameSession(oldName, newName);
            currentSessionId = newName;
            ui.ok(`renamed '${oldName}' → '${newName}'`);
          } catch (err: any) {
            ui.err(err.message);
          }
          askPrompt();
          return;
        }

        if (action === 'delete') {
          const targetName = arg.trim();
          if (!targetName) {
            ui.err('usage: /session delete <name>');
            askPrompt();
            return;
          }

          try {
            await agent.clearHistory(targetName);
            if (targetName === currentSessionId) {
              chatHistory.length = 0;
            }
            ui.ok(`deleted '${targetName}'`);
          } catch (err: any) {
            ui.err(err.message);
          }
          askPrompt();
          return;
        }

        ui.err('unknown session command — /session help');
        askPrompt();
        return;
      }

      if (!trimmed) {
        askPrompt();
        return;
      }

      try {
        console.log('');
        const finalAnswer = await agent.run(
          trimmed,
          chatHistory,
          (status) => ui.event(status),
          cliConfirm,
          currentSessionId
        );
        ui.reply(finalAnswer);
      } catch (err: any) {
        ui.err(`execution failed: ${err.message}`);
        console.log('');
      }

      askPrompt();
    });
  };

  askPrompt();
}

async function main() {
  const mcpManager = new MCPManager();
  let mcpCount = 0;

  try {
    const mcpTools = await mcpManager.loadAndInitialize('./mcp_servers.json');
    if (mcpTools.length > 0) {
      registerDynamicTools(mcpTools);
      mcpCount = mcpTools.length;
    }
  } catch (err: any) {
    ui.err(`MCP: ${err.message}`);
  }

  const cleanup = async () => {
    await mcpManager.closeAll();
  };

  process.on('SIGINT', async () => {
    await cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await cleanup();
    process.exit(0);
  });

  const args = process.argv.map(arg => arg.toLowerCase());

  if (args.includes('telegram')) {
    await startGateway('telegram', mcpCount);
  } else {
    await startCli(mcpCount);
  }
}

main().catch(err => {
  ui.err(err.message);
  process.exit(1);
});
