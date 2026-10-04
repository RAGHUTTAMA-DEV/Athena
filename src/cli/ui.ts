const esc = (n: string) => `\x1b[${n}m`;

export const ink = {
  reset: esc('0'),
  bold: esc('1'),
  dim: esc('2'),
  gold: esc('38;5;178'),
  flare: esc('38;5;220'),
  amber: esc('38;5;214'),
  ivory: esc('38;5;230'),
  cream: esc('38;5;223'),
  teal: esc('38;5;73'),
  sage: esc('38;5;108'),
  sky: esc('38;5;81'),
  rose: esc('38;5;168'),
  red: esc('38;5;167'),
  stone: esc('38;5;245'),
  night: esc('38;5;240'),
};

type Kind =
  | 'System'
  | 'Ready'
  | 'Memory'
  | 'Skill'
  | 'Browser'
  | 'Coding'
  | 'Sub-agent'
  | 'MCP'
  | 'Scheduler'
  | 'Tool'
  | 'Thinking'
  | 'Warning';

const KIND_COLOR: Record<Kind, string> = {
  System: ink.gold,
  Ready: ink.sage,
  Memory: ink.sky,
  Skill: ink.sage,
  Browser: ink.teal,
  Coding: ink.gold,
  'Sub-agent': ink.amber,
  MCP: ink.gold,
  Scheduler: ink.rose,
  Tool: ink.amber,
  Thinking: ink.stone,
  Warning: ink.rose,
};

const LABEL_W = 11;

function termCols(): number {
  return Math.max(48, process.stdout.columns || 80);
}

function vis(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, '').length;
}

function pad(s: string, width: number): string {
  const n = vis(s);
  if (n >= width) return s;
  return s + ' '.repeat(width - n);
}

function clip(s: string, max: number): string {
  if (vis(s) <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

function stripMd(s: string): string {
  return s
    .replace(/\r\n/g, '\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/(^|[^\w])\*(.+?)\*(?!\*)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ');
}

function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph.trim()) {
      out.push('');
      continue;
    }
    let rest = paragraph.trimEnd();
    while (vis(rest) > width) {
      let cut = rest.lastIndexOf(' ', width);
      if (cut < Math.floor(width * 0.4)) cut = width;
      out.push(rest.slice(0, cut).trimEnd());
      rest = rest.slice(cut).trimStart();
    }
    out.push(rest);
  }
  return out;
}

function hugInner(lines: string[]): number {
  const longest = lines.reduce((m, l) => Math.max(m, vis(l)), 10);
  const cap = termCols() - 4;
  return Math.min(cap, Math.max(50, longest + 4));
}

function frame(lines: string[], color: string, inner: number, title = false) {
  const textW = Math.max(8, inner - 4);
  console.log(`${color}╔${'═'.repeat(inner)}╗${ink.reset}`);
  for (let i = 0; i < lines.length; i++) {
    const fitted = pad(clip(lines[i], textW), textW);
    const fg = title && i === 0 ? `${ink.bold}${color}` : ink.ivory;
    console.log(`${color}║${ink.reset}  ${fg}${fitted}${ink.reset}  ${color}║${ink.reset}`);
  }
  console.log(`${color}╚${'═'.repeat(inner)}╝${ink.reset}`);
}

function center(text: string, width: number): string {
  const n = vis(text);
  const left = Math.max(0, Math.floor((width - n) / 2));
  return ' '.repeat(left) + text + ' '.repeat(Math.max(0, width - n - left));
}

function compact(value: unknown): string {
  const max = Math.max(24, termCols() - 24);
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    try {
      return clip(JSON.stringify(JSON.parse(raw)), max);
    } catch {
      return clip(raw, max);
    }
  } catch {
    return clip(String(value), max);
  }
}

function kindOf(name: string): Kind {
  const n = name.toLowerCase();
  if (n.includes('skill')) return 'Skill';
  if (n.includes('semantic') || n.includes('memory')) return 'Memory';
  if (n.includes('cron')) return 'Scheduler';
  if (n === 'delegate_task') return 'Sub-agent';
  if (n.includes('coding')) return 'Coding';
  if (n.includes('browser') || n.includes('browse') || n.includes('search')) return 'Browser';
  if (/^(gmail|calendar|notion|excalidraw|filesystem)_/.test(n)) return 'MCP';
  return 'Tool';
}

function splitChild(message: string): { child: string; rest: string } {
  const m = message.match(/^\[(sub-agent-[^\]]+)\]\s*(.*)$/s);
  return m ? { child: m[1], rest: m[2] } : { child: '', rest: message };
}

function rail(kind: Kind, title: string, body: string[] = []) {
  const color = KIND_COLOR[kind];
  const label = pad(kind, LABEL_W);
  const max = Math.max(24, termCols() - 22);
  console.log(`  ${color}◆${ink.reset} ${ink.bold}${color}${label}${ink.reset} ${ink.ivory}${clip(title, max)}${ink.reset}`);
  for (const line of body) {
    console.log(`    ${color}│${ink.reset} ${ink.stone}${clip(line, max)}${ink.reset}`);
  }
}

function centerBlock(rows: string[], width: number, color: string): string[] {
  const max = Math.max(...rows.map(r => vis(r)));
  return rows.map(r => center(`${ink.bold}${color}${pad(r, max)}${ink.reset}`, width));
}

const MARK = [
  ' █████╗ ████████╗██╗  ██╗███████╗███╗   ██╗ █████╗ ',
  '██╔══██╗╚══██╔══╝██║  ██║██╔════╝████╗  ██║██╔══██╗',
  '███████║   ██║   ███████║█████╗  ██╔██╗ ██║███████║',
  '██╔══██║   ██║   ██╔══██║██╔══╝  ██║╚██╗██║██╔══██║',
  '██║  ██║   ██║   ██║  ██║███████╗██║ ╚████║██║  ██║',
  '╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═╝  ╚═╝',
];

export const ui = {
  ink,

  banner(opts: { model: string; session: string; mcpTools: number; allowAll?: boolean; provider?: string }) {
    const markW = Math.max(...MARK.map(l => vis(l)));
    const inner = hugInner([' '.repeat(markW)]);
    const textW = inner - 4;
    const row = (content: string) => {
      console.log(`${ink.gold}║${ink.reset}  ${pad(content, textW)}  ${ink.gold}║${ink.reset}`);
    };

    console.log('');
    console.log(`${ink.gold}╔${'═'.repeat(inner)}╗${ink.reset}`);
    row('');
    for (const line of centerBlock(MARK, textW, ink.flare)) {
      row(line);
    }
    row('');
    row(center(`${ink.cream}Temple of memory · skills · tools${ink.reset}`, textW));
    const providerStr = opts.provider ? ` provider:${opts.provider}` : '';
    row(center(
      `${ink.stone}${opts.model}${providerStr}  ·  ${opts.session}  ·  ${opts.mcpTools} mcp tools${opts.allowAll ? `  ·  ${ink.amber}auto-allow${ink.reset}` : ''}${ink.reset}`,
      textW
    ));
    console.log(`${ink.gold}╚${'═'.repeat(inner)}╝${ink.reset}`);
    console.log(`${ink.night}  exit   clear   /runs   /resume   /provider   /session help${ink.reset}\n`);
  },

  sys(msg: string) {
    rail('System', msg);
  },

  ok(msg: string) {
    rail('Ready', msg);
  },

  err(msg: string) {
    rail('Warning', msg);
  },

  event(status: { type: string; message: string }) {
    const { child, rest } = splitChild(status.message);
    const childBit = child ? `${child}  ` : '';

    if (status.type === 'thought') {
      rail('Thinking', childBit + rest);
      return;
    }
    if (status.type === 'error') {
      rail('Warning', childBit + rest);
      return;
    }
    if (status.type === 'memory') {
      const epi = rest.match(/Episodic:\s*(.+)/i)?.[1]?.trim() || '—';
      const sem = rest.match(/Semantic:\s*(.+)/i)?.[1]?.trim() || '—';
      const skill = rest.match(/Procedural:\s*(.+)/i)?.[1]?.trim() || '—';
      rail('Memory', 'retrieved from the archive', [
        `Episodic    ${epi}`,
        `Semantic    ${sem}`,
        `Skills      ${skill}`,
      ]);
      return;
    }
    if (status.type === 'tool_call') {
      const parsed = rest.match(/Calling tool:\s+(\S+)\s+with args:\s*(.*)$/s);
      if (parsed) {
        rail(kindOf(parsed[1]), `${childBit}${parsed[1]}`, [compact(parsed[2])]);
        return;
      }
      rail('Tool', childBit + rest);
      return;
    }
    if (status.type === 'tool_response') {
      const parsed = rest.match(/Tool\s+(\S+)\s+returned:\s*(.*)$/s);
      if (parsed) {
        rail(kindOf(parsed[1]), `${childBit}returned  ${parsed[1]}`, [compact(parsed[2])]);
        return;
      }
      rail('Tool', childBit + rest);
    }
  },

  confirm(toolName: string, args: unknown) {
    const kind = kindOf(toolName);
    const lines = [
      `Confirmation required  ·  ${toolName}`,
      '',
      compact(args),
      '',
      'y allow     n deny',
    ];
    console.log('');
    frame(lines, ink.rose, hugInner(lines), true);
  },

  confirmAsk(): string {
    return `${ink.bold}${ink.rose}  Allow?${ink.reset} ${ink.stone}(y/N)${ink.reset} ${ink.gold}❯${ink.reset} `;
  },

  confirmResult(ok: boolean) {
    rail(ok ? 'Ready' : 'Warning', ok ? 'Allowed' : 'Denied');
    console.log('');
  },

  cron(sessionId: string, result: string) {
    const cap = termCols() - 8;
    const lines = [
      `Scheduler  ·  ${sessionId}`,
      '',
      ...wrap(stripMd(result.trim() || '(empty)'), cap).slice(0, 8),
    ];
    console.log('');
    frame(lines, ink.rose, hugInner(lines), true);
    console.log('');
  },

  reply(text: string) {
    const cap = termCols() - 8;
    const body = wrap(stripMd(text.trim() || '(empty)'), cap);
    const lines = ['Athena', '', ...body];
    console.log('');
    frame(lines, ink.teal, hugInner(lines), true);
    console.log('');
  },

  prompt(sessionId: string): string {
    return `${ink.bold}${ink.gold}  You${ink.reset} ${ink.night}· ${sessionId}${ink.reset} ${ink.gold}❯${ink.reset} `;
  },

  sessionsHelp() {
    const lines = [
      'Sessions',
      '',
      '/session list              list chats',
      '/session switch <name>    switch or create',
      '/session rename <name>    rename current',
      '/session delete <name>    delete history',
      '/session current           print name',
    ];
    console.log('');
    frame(lines, ink.gold, hugInner(lines), true);
    console.log('');
  },

  sessionList(rows: { sessionId: string; messageCount: number; lastActive: string; active: boolean }[]) {
    const lines = ['Sessions', ''];
    if (rows.length === 0) {
      lines.push('none yet');
    } else {
      for (const r of rows) {
        lines.push(`${r.sessionId}  ${r.messageCount} msgs · ${r.lastActive}${r.active ? '  ●' : ''}`);
      }
    }
    console.log('');
    frame(lines, ink.gold, hugInner(lines), true);
    console.log('');
  },

  historyPreview(messages: { role: string; text: string }[]) {
    if (messages.length === 0) {
      rail('Memory', 'No prior turns');
      console.log('');
      return;
    }
    rail(
      'Memory',
      'Recent turns',
      messages.slice(-4).map(m => `${m.role === 'user' ? 'You' : 'Athena'}  ${m.text}`)
    );
    console.log('');
  },

  runsHelp() {
    const lines = [
      'Runs (Phase 1 Runtime)',
      '',
      '/runs                      list runs in current session',
      '/runs all                  list runs across all sessions',
      '/runs <sessionId>          list runs for specific session',
      '/resume <runId>            resume an interrupted or prior run',
    ];
    console.log('');
    frame(lines, ink.gold, hugInner(lines), true);
    console.log('');
  },

  runList(rows: { runId: string; status: string; turns: number; task: string; terminationReason?: string }[]) {
    const lines = ['Runs', ''];
    if (rows.length === 0) {
      lines.push('no runs recorded');
    } else {
      for (const r of rows) {
        const reason = r.terminationReason ? ` (${r.terminationReason})` : '';
        const preview = r.task.length > 40 ? r.task.substring(0, 40) + '…' : r.task;
        lines.push(`${r.runId}  ·  [${r.status}${reason}]  turn ${r.turns}  ·  "${preview}"`);
      }
    }
    console.log('');
    frame(lines, ink.gold, hugInner(lines), true);
    console.log('');
  },
};
