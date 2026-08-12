import * as dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config();

import './core/instrumentation.js';

import { Agent } from './core/agent.js';
import { Message } from './core/types.js';
import { DEFAULT_AGENT_PROMPT } from './prompts/index.js';
import { TelegramGateway } from './gateway/telegram.js';
import { Scheduler } from './core/scheduler.js';
import { MCPManager } from './core/mcpManager.js';
import { registerDynamicTools } from './tools/index.js';
import * as readline from 'readline';

// ANSI coloring codes for premium styling
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  underscore: '\x1b[4m',
  fgRed: '\x1b[31m',
  fgGreen: '\x1b[32m',
  fgYellow: '\x1b[33m',
  fgBlue: '\x1b[34m',
  fgMagenta: '\x1b[35m',
  fgCyan: '\x1b[36m',
  fgWhite: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgYellow: '\x1b[43m',
  bgGreen: '\x1b[42m',
};

function log(color: string, prefix: string, message: string) {
  console.log(`${COLORS.bright}${color}[${prefix}]${COLORS.reset} ${message}`);
}

let rl: readline.Interface;

const cliConfirm = (toolName: string, args: any): Promise<boolean> => {
  return new Promise((resolve) => {
    console.log(`\n${COLORS.bright}${COLORS.fgYellow}⚠️  [CONFIRMATION REQUIRED]${COLORS.reset}`);
    console.log(`Tool: ${COLORS.bright}${toolName}${COLORS.reset}`);
    console.log(`Arguments: ${JSON.stringify(args, null, 2)}`);
    
    rl.question(`${COLORS.bright}Allow execution? (y/N) > ${COLORS.reset}`, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      const approved = trimmed === 'y' || trimmed === 'yes';
      console.log(approved ? `${COLORS.fgGreen}Execution Approved` : `${COLORS.fgRed}Execution Denied`);
      console.log(COLORS.reset);
      resolve(approved);
    });
  });
};

async function startGateway(type: string) {
  console.log('\n' + '='.repeat(60));
  console.log(`${COLORS.bright}${COLORS.fgCyan} Athena Agent - Gateway Server (${type}) ${COLORS.reset}`);
  console.log('='.repeat(60) + '\n');

  if (type.toLowerCase() === 'telegram') {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
      log(COLORS.fgRed, 'ERROR', 'TELEGRAM_BOT_TOKEN is not defined in .env file!');
      process.exit(1);
    }
    const gateway = new TelegramGateway();
    await gateway.start();
    log(COLORS.fgGreen, 'SYSTEM', 'Telegram Gateway running. Press Ctrl+C to terminate.');
  } else {
    log(COLORS.fgRed, 'ERROR', `Unsupported gateway type: "${type}". Only "telegram" is supported.`);
    process.exit(1);
  }
}

async function startCli() {
  console.log('\n' + '='.repeat(60));
  console.log(`${COLORS.bright}${COLORS.fgCyan} Athena Agent - CLI Client (Phase 1 Real Tools) ${COLORS.reset}`);
  console.log('='.repeat(60) + '\n');

  if (!process.env.GEMINI_API_KEY) {
    log(COLORS.fgRed, 'ERROR', 'GEMINI_API_KEY is not defined in .env file!');
    process.exit(1);
  }

  // Initialize Agent with standard config
  const agent = new Agent({
    modelName: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    maxTurns: 10,
    systemPrompt: DEFAULT_AGENT_PROMPT,
    soulPath: './SOUL.md',
    dbPath: process.env.DATABASE_PATH || './state.db'
  });

  log(COLORS.fgBlue, 'SYSTEM', 'Initializing agent persona (SOUL.md)...');
  await agent.init();
  log(COLORS.fgGreen, 'SYSTEM', 'Agent initialized and ready to receive prompts.');

  // This the for starting the scheduler with the cli 
  if ((agent as any).memory) {
    const scheduler = Scheduler.getInstance();
    scheduler.setMemory((agent as any).memory);
    scheduler.setRunner(async (prompt, sessionId) => {
      const history: Message[] = [];
      return agent.run(prompt, history, undefined, undefined, sessionId);
    });
    scheduler.setNotifier(async (sessionId, result) => {
      console.log(`\n⏰ [Scheduler Notification] [Session: ${sessionId}]\n${result}\n`);
    });
    await scheduler.start();
  }

  let currentSessionId = 'cli';

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

  console.log(`${COLORS.dim}Type "exit" or "quit" to end the session. Type "/session help" for session commands.${COLORS.reset}\n`);

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const chatHistory: Message[] = [];

  const askPrompt = () => {
    rl.question(`${COLORS.bright}${COLORS.fgMagenta}[${currentSessionId}] You > ${COLORS.reset}`, async (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log(`\n${COLORS.fgBlue}[SYSTEM] Goodbye!${COLORS.reset}\n`);
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === 'clear') {
        chatHistory.length = 0;
        try {
          await agent.clearHistory(currentSessionId);
          console.log(`\n${COLORS.fgGreen}[SYSTEM] Chat history for the session '${currentSessionId}' cleared successfully.${COLORS.reset}\n`);
        } catch (err: any) {
          console.log(`\n${COLORS.fgRed}[SYSTEM] Failed to clear chat history: ${err.message}${COLORS.reset}\n`);
        }
        askPrompt();
        return;
      }

      // Check for session commands
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
          if (sub === 'switch' || sub === 'delete' || sub === 'create') {
            arg = parts.slice(2).join(' ');
          } else if (sub === 'rename') {
            arg = parts.slice(2).join(' ');
          }
        }

        if (action === 'help') {
          console.log(`\n${COLORS.bright}${COLORS.fgCyan}Athena Chat Sessions Help:${COLORS.reset}`);
          console.log(`  ${COLORS.bright}/session list${COLORS.reset} (or ${COLORS.bright}/sessions${COLORS.reset})     - List all chat sessions`);
          console.log(`  ${COLORS.bright}/session switch <name>${COLORS.reset} (or ${COLORS.bright}/switch <name>${COLORS.reset}) - Switch to or create a session`);
          console.log(`  ${COLORS.bright}/session rename <new_name>${COLORS.reset} - Rename current session`);
          console.log(`  ${COLORS.bright}/session delete <name>${COLORS.reset}     - Delete a session's history`);
          console.log(`  ${COLORS.bright}/session current${COLORS.reset}           - Print current session name`);
          console.log(`  ${COLORS.bright}/session help${COLORS.reset}              - Show this help message\n`);
          askPrompt();
          return;
        }

        if (action === 'list') {
          try {
            const list = await agent.getSessionsList();
            console.log(`\n${COLORS.bright}${COLORS.fgCyan}--- Athena Chat Sessions ---${COLORS.reset}`);
            if (list.length === 0) {
              console.log(`No active sessions found. The default session is '${currentSessionId}'.`);
            } else {
              list.forEach(s => {
                const activeMarker = s.sessionId === currentSessionId ? `${COLORS.fgGreen}* (active)${COLORS.reset}` : '';
                console.log(`  - ${COLORS.bright}${s.sessionId}${COLORS.reset} (${s.messageCount} messages, active ${formatRelativeTime(s.lastActive)}) ${activeMarker}`);
              });
            }
            console.log('');
          } catch (err: any) {
            console.log(`\n${COLORS.fgRed}[SYSTEM] Failed to list sessions: ${err.message}${COLORS.reset}\n`);
          }
          askPrompt();
          return;
        }

        if (action === 'current') {
          console.log(`\n${COLORS.fgBlue}[SYSTEM] Current session:${COLORS.reset} ${COLORS.bright}${currentSessionId}${COLORS.reset}\n`);
          askPrompt();
          return;
        }

        if (action === 'switch' || action === 'create') {
          const sessionName = arg.trim();
          if (!sessionName) {
            console.log(`\n${COLORS.fgRed}[SYSTEM] Please specify a session name. Example: /session switch development${COLORS.reset}\n`);
            askPrompt();
            return;
          }

          currentSessionId = sessionName;
          chatHistory.length = 0; // Clear memory cache to reload from DB
          
          console.log(`\n${COLORS.fgGreen}[SYSTEM] Switched to session: ${COLORS.bright}${currentSessionId}${COLORS.reset}`);

          if ((agent as any).memory) {
            try {
              const history = await (agent as any).memory.loadHistory(currentSessionId, 6);
              if (history.length > 0) {
                console.log(`\n${COLORS.dim}--- Recent Session Messages ---${COLORS.reset}`);
                history.forEach((msg: any) => {
                  const sender = msg.role === 'user' ? 'You' : 'Athena';
                  const text = msg.parts.map((p: any) => p.text).join(' ');
                  console.log(`${COLORS.dim}${sender} > ${text}${COLORS.reset}`);
                });
                console.log(`${COLORS.dim}-------------------------------${COLORS.reset}`);
              } else {
                console.log(`No previous messages in this session. Starting fresh!`);
              }
            } catch (e: any) {
              console.log(`${COLORS.fgYellow}[SYSTEM] Failed to load session context: ${e.message}${COLORS.reset}`);
            }
          }
          console.log('');
          askPrompt();
          return;
        }

        if (action === 'rename') {
          const newName = arg.trim();
          if (!newName) {
            console.log(`\n${COLORS.fgRed}[SYSTEM] Please specify a new session name. Example: /session rename main_session${COLORS.reset}\n`);
            askPrompt();
            return;
          }

          try {
            const oldName = currentSessionId;
            await agent.renameSession(oldName, newName);
            currentSessionId = newName;
            console.log(`\n${COLORS.fgGreen}[SYSTEM] Session renamed from '${oldName}' to '${newName}' successfully.${COLORS.reset}\n`);
          } catch (err: any) {
            console.log(`\n${COLORS.fgRed}[SYSTEM] Failed to rename session: ${err.message}${COLORS.reset}\n`);
          }
          askPrompt();
          return;
        }

        if (action === 'delete') {
          const targetName = arg.trim();
          if (!targetName) {
            console.log(`\n${COLORS.fgRed}[SYSTEM] Please specify a session name to delete. Example: /session delete old_session${COLORS.reset}\n`);
            askPrompt();
            return;
          }

          try {
            await agent.clearHistory(targetName);
            if (targetName === currentSessionId) {
              chatHistory.length = 0;
            }
            console.log(`\n${COLORS.fgGreen}[SYSTEM] Session '${targetName}' history deleted successfully.${COLORS.reset}\n`);
          } catch (err: any) {
            console.log(`\n${COLORS.fgRed}[SYSTEM] Failed to delete session: ${err.message}${COLORS.reset}\n`);
          }
          askPrompt();
          return;
        }

        console.log(`\n${COLORS.fgRed}[SYSTEM] Subcommand not recognized. Type "/session help" for available commands.${COLORS.reset}\n`);
        askPrompt();
        return;
      }

      if (!trimmed) {
        askPrompt();
        return;
      }

      try {
        console.log(''); // Blank line before agent logs
        const finalAnswer = await agent.run(trimmed, chatHistory, (status) => {
          switch (status.type) {
            case 'thought':
              log(COLORS.fgBlue, 'THOUGHT', status.message);
              break;
            case 'memory':
              log(COLORS.fgCyan, 'MEMORY', status.message);
              break;
            case 'tool_call':
              log(COLORS.fgYellow, 'TOOL CALL', status.message);
              break;
            case 'tool_response':
              log(COLORS.fgGreen, 'TOOL RESPONSE', status.message);
              break;
            case 'error':
              log(COLORS.fgRed, 'WARNING', status.message);
              break;
          }
        }, cliConfirm, currentSessionId);

        console.log(`\n${COLORS.bright}${COLORS.fgCyan}Athena > ${COLORS.reset}${COLORS.fgWhite}${finalAnswer}${COLORS.reset}\n`);
      } catch (err: any) {
        log(COLORS.fgRed, 'ERROR', `Execution failed: ${err.message}`);
        console.log('');
      }

      askPrompt();
    });
  };

  askPrompt();
}

async function main() {
  const mcpManager = new MCPManager();
  const mcpTools = await mcpManager.loadAndInitialize('./mcp_servers.json');
  if (mcpTools.length > 0) {
    registerDynamicTools(mcpTools);
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
    await startGateway('telegram');
  } else {
    await startCli();
  }
}

main().catch(err => {
  log(COLORS.fgRed, 'FATAL', err.message);
  process.exit(1);
});
