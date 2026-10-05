import './core/dnsFix.js';

import * as dotenv from 'dotenv';
dotenv.config();

import './core/instrumentation.js';

import { Agent } from './core/agent.js';
import { Message, ProviderType } from './core/types.js';
import { DEFAULT_AGENT_PROMPT } from './prompts/index.js';
import { TelegramGateway } from './gateway/telegram.js';
import { Scheduler } from './core/scheduler.js';
import { MCPManager } from './core/mcpManager.js';
import { registerDynamicTools } from './tools/index.js';
import { ui } from './cli/ui.js';
import { CancellationTokenSource } from './core/cancellation.js';
import { TrajectoryReplayer } from './core/replayDebugger.js';
import * as readline from 'readline';

let currentActiveCts: CancellationTokenSource | null = null;

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
  let currentProvider: ProviderType = (process.env.LLM_PROVIDER as ProviderType) || 'gemini';
  let currentModelName = currentProvider === 'nvidia'
    ? (process.env.NVIDIA_MODEL || 'z-ai/glm-5.2')
    : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');

  let currentSessionId = 'cli';

  ui.banner({
    model: currentModelName,
    provider: currentProvider,
    session: currentSessionId,
    mcpTools,
    allowAll
  });

  let agent = new Agent({
    provider: currentProvider,
    modelName: currentModelName,
    maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
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
      if (lowerInput.startsWith('/provider')) {
        const parts = trimmed.split(/\s+/);
        const targetProvider = parts[1]?.toLowerCase();
        const targetModel = parts.slice(2).join(' ');

        if (!targetProvider) {
          ui.sys(`Current provider: ${currentProvider} | Model: ${currentModelName}`);
          ui.sys(`Usage: /provider <gemini|nvidia> [model_name]`);
          askPrompt();
          return;
        }

        if (targetProvider !== 'gemini' && targetProvider !== 'nvidia') {
          ui.err(`Invalid provider "${targetProvider}". Supported providers: gemini, nvidia`);
          askPrompt();
          return;
        }

        currentProvider = targetProvider as ProviderType;
        if (targetModel) {
          currentModelName = targetModel;
        } else {
          currentModelName = currentProvider === 'nvidia' ? (process.env.NVIDIA_MODEL || 'z-ai/glm-5.2') : (process.env.GEMINI_MODEL || 'gemini-2.5-flash');
        }

        try {
          agent = new Agent({
            provider: currentProvider,
            modelName: currentModelName,
            maxTurns: parseInt(process.env.MAX_TURNS || process.env.MAX_ITERATIONS || '20', 10),
            systemPrompt: DEFAULT_AGENT_PROMPT,
            soulPath: './SOUL.md',
            dbPath: process.env.DATABASE_PATH || './state.db'
          });
          await agent.init();
          ui.ok(`Switched to provider '${currentProvider}' with model '${currentModelName}'`);
        } catch (err: any) {
          ui.err(`Failed to switch provider: ${err.message}`);
        }

        askPrompt();
        return;
      }

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

      if (lowerInput.startsWith('/runs')) {
        const parts = trimmed.split(/\s+/);
        const sub = parts[1]?.toLowerCase();
        if (sub === 'help') {
          ui.runsHelp();
          askPrompt();
          return;
        }

        const targetSession = sub === 'all' ? undefined : (parts[1] || currentSessionId);
        try {
          const runs = await agent.listRuns(targetSession, 20);
          ui.runList(runs.map(r => ({
            runId: r.runId,
            status: r.status,
            turns: r.currentTurn,
            task: r.task,
            terminationReason: r.terminationReason
          })));
        } catch (err: any) {
          ui.err(`Failed to list runs: ${err.message}`);
        }
        askPrompt();
        return;
      }

      if (lowerInput.startsWith('/resume')) {
        const parts = trimmed.split(/\s+/);
        const targetRunId = parts[1]?.trim();
        if (!targetRunId) {
          ui.err('usage: /resume <runId>');
          askPrompt();
          return;
        }

        try {
          ui.sys(`resuming run "${targetRunId}"...`);
          console.log('');
          currentActiveCts = new CancellationTokenSource();
          const resumedAnswer = await agent.resumeRun(targetRunId, {
            cancellationToken: currentActiveCts.token,
            onUpdate: (status) => ui.event(status),
            confirm: cliConfirm
          });
          ui.reply(resumedAnswer);
        } catch (err: any) {
          if (err.name === 'CancellationError' || err.message.includes('cancelled')) {
            ui.err('Run cancelled by user.');
          } else {
            ui.err(`resume failed: ${err.message}`);
          }
          console.log('');
        } finally {
          currentActiveCts = null;
        }
        askPrompt();
        return;
      }

      if (lowerInput.startsWith('/replay')) {
        const parts = trimmed.split(/\s+/);
        const sub = parts[1]?.toLowerCase();

        if (!sub || sub === 'help') {
          ui.replayHelp();
          askPrompt();
          return;
        }

        const runId = parts[1];
        try {
          const replayer = agent.getReplayer();
          const trajectory = await replayer.loadTrajectory(runId);

          if (trimmed.includes('--diff')) {
            const diffIdx = parts.indexOf('--diff');
            const targetRunId = parts[diffIdx + 1];
            if (!targetRunId) {
              ui.err('usage: /replay <runId> --diff <otherRunId>');
              askPrompt();
              return;
            }
            const targetTrajectory = await replayer.loadTrajectory(targetRunId);
            const diff = TrajectoryReplayer.diffTrajectories(trajectory, targetTrajectory);
            ui.replayDiffView(diff);
          } else if (trimmed.includes('--export')) {
            const exportIdx = parts.indexOf('--export');
            const targetPath = parts[exportIdx + 1] || `scratch/run_${runId}_replay.md`;
            const saved = await replayer.exportToFile(targetPath, 'markdown');
            ui.ok(`Trajectory post-mortem exported to: ${saved}`);
          } else {
            ui.replayTrajectoryView(trajectory);
          }
        } catch (err: any) {
          ui.err(`Replay error: ${err.message}`);
        }
        askPrompt();
        return;
      }

      if (lowerInput.startsWith('/memory')) {
        const parts = trimmed.split(/\s+/);
        const sub = parts[1]?.toLowerCase() || 'help';

        if (sub === 'help') {
          ui.memoryHelp();
          askPrompt();
          return;
        }

        if (sub === 'scopes') {
          ui.sys('Available memory scopes:\n  • global    - user-wide knowledge across all workspaces\n  • user      - user preferences, profile facts\n  • workspace - repo architecture, file patterns\n  • project   - project goals, conventions, roadmap\n  • session   - conversational context\n  • task      - short-lived task slice');
          askPrompt();
          return;
        }

        if (sub === 'inspect') {
          const query = parts.slice(2).join(' ') || undefined;
          const memory = agent.getMemory();
          if (!memory) {
            ui.err('Database memory not initialized.');
          } else {
            try {
              const facts = await memory.inspectMemory(query);
              ui.memoryList(facts.map(f => ({
                id: f.id,
                scope: f.scope,
                fact: f.fact,
                confidence: f.confidence,
                lifecycle: f.lifecycle,
                source: f.provenance.source
              })));
            } catch (err: any) {
              ui.err(`inspect failed: ${err.message}`);
            }
          }
          askPrompt();
          return;
        }

        if (sub === 'forget') {
          const id = parseInt(parts[2], 10);
          if (isNaN(id)) {
            ui.err('usage: /memory forget <id>');
            askPrompt();
            return;
          }
          const memory = agent.getMemory();
          if (!memory) {
            ui.err('Database memory not initialized.');
          } else {
            try {
              await memory.deleteScopedMemory(id);
              ui.ok(`Memory fact #${id} marked deleted.`);
            } catch (err: any) {
              ui.err(`forget failed: ${err.message}`);
            }
          }
          askPrompt();
          return;
        }

        if (sub === 'purge') {
          const targetScope = parts[2]?.toLowerCase() as any;
          if (!targetScope) {
            ui.err('usage: /memory purge <global|user|workspace|project|session|task>');
            askPrompt();
            return;
          }
          const memory = agent.getMemory();
          if (!memory) {
            ui.err('Database memory not initialized.');
          } else {
            try {
              const purged = await memory.purgeScope(targetScope);
              ui.ok(`Purged ${purged} facts from [${targetScope}] scope.`);
            } catch (err: any) {
              ui.err(`purge failed: ${err.message}`);
            }
          }
          askPrompt();
          return;
        }

        ui.err('unknown memory command — /memory help');
        askPrompt();
        return;
      }

      if (!trimmed) {
        askPrompt();
        return;
      }

      try {
        console.log('');
        currentActiveCts = new CancellationTokenSource();
        const finalAnswer = await agent.run(
          trimmed,
          chatHistory,
          {
            sessionId: currentSessionId,
            cancellationToken: currentActiveCts.token,
            onUpdate: (status) => ui.event(status),
            confirm: cliConfirm
          }
        );
        ui.reply(finalAnswer);
      } catch (err: any) {
        if (err.name === 'CancellationError' || err.message.includes('cancelled')) {
          ui.err('Run cancelled by user.');
        } else {
          ui.err(`execution failed: ${err.message}`);
        }
        console.log('');
      } finally {
        currentActiveCts = null;
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
    if (currentActiveCts) {
      ui.sys('cancelling active run...');
      currentActiveCts.cancel('User cancelled with Ctrl+C');
      currentActiveCts = null;
      return;
    }
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
