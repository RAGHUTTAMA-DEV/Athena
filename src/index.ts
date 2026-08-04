import * as dotenv from 'dotenv';
// Load environment variables from .env file
dotenv.config();

import './core/instrumentation.js';

import { Agent } from './core/agent.js';
import { Message } from './core/types.js';
import { DEFAULT_AGENT_PROMPT } from './prompts/index.js';
import { TelegramGateway } from './gateway/telegram.js';
import { Scheduler } from './core/scheduler.js';
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

  // Wire up and start Scheduler for CLI
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

  console.log(`${COLORS.dim}Type "exit" or "quit" to end the session.${COLORS.reset}\n`);

  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const chatHistory: Message[] = [];

  const askPrompt = () => {
    rl.question(`${COLORS.bright}${COLORS.fgMagenta}You > ${COLORS.reset}`, async (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        console.log(`\n${COLORS.fgBlue}[SYSTEM] Goodbye!${COLORS.reset}\n`);
        rl.close();
        process.exit(0);
      }

      if (trimmed.toLowerCase() === 'clear') {
        chatHistory.length = 0;
        try {
          await agent.clearHistory('cli');
          console.log(`\n${COLORS.fgGreen}[SYSTEM] Chat history for the CLI session cleared successfully.${COLORS.reset}\n`);
        } catch (err: any) {
          console.log(`\n${COLORS.fgRed}[SYSTEM] Failed to clear chat history: ${err.message}${COLORS.reset}\n`);
        }
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
        }, cliConfirm, 'cli');

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
