import { chromium } from 'playwright';

/**
 * P4B Capability Registry (spec section 71 — "no fake capabilities").
 *
 * Every capability the agent exposes is registered here with an honest
 * status: `real`, `experimental`, or `unsupported` (with a reason). A
 * capability is NEVER advertised beyond its true runtime state — e.g. the
 * RAG reranker reports `unsupported` when its cross-encoder model cannot
 * load, and the RAG pipeline then skips reranking instead of silently
 * substituting a lexical heuristic.
 */

export type CapabilityStatus = 'real' | 'experimental' | 'unsupported';

export interface CapabilityEntry {
  /** Stable dotted id, e.g. "rag.rerank". */
  id: string;
  name: string;
  status: CapabilityStatus;
  /** Required for experimental/unsupported: why it is not fully real. */
  reason?: string;
  /** Phase that introduced the capability. */
  phase?: string;
  updatedAt: number;
}

export class CapabilityRegistry {
  private static instance: CapabilityRegistry;
  private capabilities: Map<string, CapabilityEntry> = new Map();

  static getInstance(): CapabilityRegistry {
    if (!CapabilityRegistry.instance) {
      CapabilityRegistry.instance = new CapabilityRegistry();
    }
    return CapabilityRegistry.instance;
  }

  register(entry: Omit<CapabilityEntry, 'updatedAt'> & { updatedAt?: number }): CapabilityEntry {
    const stored: CapabilityEntry = {
      ...entry,
      updatedAt: entry.updatedAt || Date.now()
    };
    this.capabilities.set(entry.id, stored);
    return stored;
  }

  setStatus(id: string, status: CapabilityStatus, reason?: string): CapabilityEntry | null {
    const entry = this.capabilities.get(id);
    if (!entry) return null;
    entry.status = status;
    entry.reason = reason;
    entry.updatedAt = Date.now();
    return entry;
  }

  get(id: string): CapabilityEntry | null {
    return this.capabilities.get(id) || null;
  }

  list(phase?: string): CapabilityEntry[] {
    const all = Array.from(this.capabilities.values());
    const filtered = phase ? all.filter(c => c.phase === phase) : all;
    return filtered.sort((a, b) => a.id.localeCompare(b.id));
  }

  reset(): void {
    this.capabilities.clear();
  }
}

/**
 * Seed the P4B capability set. Idempotent; safe to call at agent boot and
 * again whenever a backend's real status changes.
 */
export function seedP4BCapabilities(registry: CapabilityRegistry): void {
  registry.register({
    id: 'web.search',
    name: 'Web search (DuckDuckGo with Yahoo fallback)',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'research.pipeline',
    name: 'Research pipeline (search → retrieve → extract → cross-check → synthesize → cite)',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'documents.pdf',
    name: 'PDF text extraction',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'documents.docx',
    name: 'DOCX text extraction',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'documents.xlsx',
    name: 'XLSX text extraction (per-sheet CSV rendering)',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'documents.csv',
    name: 'CSV parsing',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'documents.html',
    name: 'HTML text extraction',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'documents.markdown',
    name: 'Markdown/plain text reading',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'documents.ocr',
    name: 'OCR for scanned documents and images (tesseract.js)',
    status: 'experimental',
    reason: 'Tesseract OCR works on clean text images but accuracy varies with layout and scan quality; treated as experimental until evaluated against a scanned-document corpus.',
    phase: 'P4B'
  });
  registry.register({
    id: 'rag.ingest',
    name: 'RAG ingest (parse → chunk → embed → store)',
    status: 'real',
    phase: 'P4B'
  });
  registry.register({
    id: 'rag.rerank',
    name: 'RAG reranking (local cross-encoder scoring (query, passage) pairs)',
    status: 'unsupported',
    reason: 'Cross-encoder model not loaded yet.',
    phase: 'P4B'
  });
}

/**
 * Seed the P4C browser capability set (spec section 19 / 71).
 */
export function seedP4CCapabilities(registry: CapabilityRegistry): void {
  let playwrightStatus: CapabilityStatus = 'real';
  let playwrightReason: string | undefined;

  try {
    const execPath = chromium.executablePath();
    if (!execPath) {
      playwrightStatus = 'unsupported';
      playwrightReason = 'Playwright browser executable not found. Run "npx playwright install" to install browsers.';
    }
  } catch (err: any) {
    playwrightStatus = 'unsupported';
    playwrightReason = `Playwright runtime error: ${err.message}`;
  }

  registry.register({
    id: 'browser.playwright',
    name: 'Playwright browser automation (Chromium)',
    status: playwrightStatus,
    reason: playwrightReason,
    phase: 'P4C'
  });

  registry.register({
    id: 'browser.profiles',
    name: 'Persistent isolated browser profiles (per agent/task)',
    status: 'real',
    phase: 'P4C'
  });

  registry.register({
    id: 'browser.tabs',
    name: 'Multi-tab and window management',
    status: 'real',
    phase: 'P4C'
  });

  registry.register({
    id: 'browser.interactive',
    name: 'Interactive browser actions (click, type, forms, upload, hover, scroll)',
    status: 'real',
    phase: 'P4C'
  });

  registry.register({
    id: 'browser.accessibility',
    name: 'Accessibility tree snapshots & semantic element extraction',
    status: 'real',
    phase: 'P4C'
  });

  registry.register({
    id: 'browser.downloads',
    name: 'Managed downloads and scoped file persistence',
    status: 'real',
    phase: 'P4C'
  });
}

/**
 * Seed the P4D Computer Use capability set (spec sections 18, 22, 71).
 * Reflects true per-OS status: Windows is real on win32; macOS and Linux
 * are unsupported on win32 with explicit reasons — never faked.
 */
export function seedP4DCapabilities(registry: CapabilityRegistry): void {
  const isWindows = process.platform === 'win32';
  const isDarwin = process.platform === 'darwin';
  const isLinux = process.platform === 'linux';

  registry.register({
    id: 'computer.windows',
    name: 'Windows Desktop Automation (Win32 / .NET UIAutomation)',
    status: isWindows ? 'real' : 'unsupported',
    reason: isWindows ? undefined : 'Windows automation backend requires Windows OS (win32).',
    phase: 'P4D'
  });

  registry.register({
    id: 'computer.macos',
    name: 'macOS Desktop Automation (Accessibility API / Quartz)',
    status: isDarwin ? 'real' : 'unsupported',
    reason: isDarwin ? undefined : 'macOS Accessibility backend is only supported on macOS (Darwin).',
    phase: 'P4D'
  });

  registry.register({
    id: 'computer.linux',
    name: 'Linux Desktop Automation (AT-SPI / X11 / Wayland)',
    status: isLinux ? 'real' : 'unsupported',
    reason: isLinux ? undefined : 'Linux AT-SPI backend is only supported on Linux OS.',
    phase: 'P4D'
  });

  registry.register({
    id: 'computer.accessibility',
    name: 'OS Desktop Accessibility Tree Inspection (UI Automation / AT-SPI)',
    status: isWindows ? 'real' : (isDarwin ? 'real' : 'unsupported'),
    reason: (!isWindows && !isDarwin) ? 'Accessibility tree extraction unsupported on this platform.' : undefined,
    phase: 'P4D'
  });

  registry.register({
    id: 'computer.input',
    name: 'Native Input Event Injection (Mouse / Keyboard)',
    status: isWindows ? 'real' : 'unsupported',
    reason: !isWindows ? 'Input injection backend unsupported on this platform.' : undefined,
    phase: 'P4D'
  });
}

/**
 * Seed the P5 Learning capability set (spec sections 29, 30, 31, 71).
 */
export function seedP5Capabilities(registry: CapabilityRegistry): void {
  registry.register({
    id: 'learning.progressive_skills',
    name: 'Progressive Disclosure Skills (Lightweight Metadata & On-Demand Body)',
    status: 'real',
    phase: 'P5'
  });

  registry.register({
    id: 'learning.skill_lifecycle',
    name: 'Skill Review Lifecycle (Proposed -> Reviewed -> Active with Telemetry)',
    status: 'real',
    phase: 'P5'
  });

  registry.register({
    id: 'learning.routines',
    name: 'Autonomous Standing Routines (EventBus & Schedule Triggers)',
    status: 'real',
    phase: 'P5'
  });

  registry.register({
    id: 'learning.learned_workflows',
    name: 'Distilled Learned Workflows from Successful Runs',
    status: 'real',
    phase: 'P5'
  });
}

/**
 * Seed the P6 Multi-Agent capability set (spec sections 32, 33, 34, 71).
 */
export function seedP6Capabilities(registry: CapabilityRegistry): void {
  registry.register({
    id: 'multiagent.specialized_profiles',
    name: 'Specialized Agent Profiles (Researcher, Coder, Reviewer, Planner, Browser, Data)',
    status: 'real',
    phase: 'P6'
  });

  registry.register({
    id: 'multiagent.delegation_contract',
    name: 'Formal Delegation Contract with Tool Scoping Guard & Depth Limits',
    status: 'real',
    phase: 'P6'
  });

  registry.register({
    id: 'multiagent.a2a_mailbox',
    name: 'Durable A2A Mailbox Supporting 9 Message Types and SQLite Persistence',
    status: 'real',
    phase: 'P6'
  });

  registry.register({
    id: 'multiagent.handoff_engine',
    name: 'Crash-Safe Multi-Agent Handoff Pipeline Surviving Restarts',
    status: 'real',
    phase: 'P6'
  });

  registry.register({
    id: 'multiagent.teams',
    name: 'Multi-Agent Teams with Mandatory Specialization Justification Rule',
    status: 'real',
    phase: 'P6'
  });
}

/**
 * Seed the P7 Proactive Agent capability set (spec sections 35, 36, 37, 38, 66, 71).
 */
export function seedP7Capabilities(registry: CapabilityRegistry): void {
  registry.register({
    id: 'proactive.event_pipeline',
    name: 'Multi-Stage Event Pipeline (Filter -> Relevance -> Wake -> Reason -> Action) with Cost Controls',
    status: 'real',
    phase: 'P7'
  });

  registry.register({
    id: 'proactive.heartbeat',
    name: 'Event-Aware, Throttled, Budget-Capped Proactive Heartbeat Engine',
    status: 'real',
    phase: 'P7'
  });

  registry.register({
    id: 'proactive.durable_events',
    name: 'Durable AgentEvent Persistence, Deduplication, Retries, and Replay',
    status: 'real',
    phase: 'P7'
  });

  registry.register({
    id: 'proactive.webhooks',
    name: 'Secure Webhook Ingestion with HMAC-SHA256, Replay Protection, and Privilege Separation Guard',
    status: 'real',
    phase: 'P7'
  });

  registry.register({
    id: 'proactive.monitoring',
    name: 'Autonomous Monitoring Triggers and Stalled-Goal Wake Detection',
    status: 'real',
    phase: 'P7'
  });
}

/**
 * Seed the P8 Communication capability set (spec sections 26, 27, 28, 58, 71).
 */
export function seedP8Capabilities(registry: CapabilityRegistry): void {
  registry.register({
    id: 'communication.gateway',
    name: 'Unified Channel Gateway Routing All Inbound Channels into One Athena Core',
    status: 'real',
    phase: 'P8'
  });

  registry.register({
    id: 'communication.telegram',
    name: 'Telegram Channel Adapter with Markdown Chunking and Interactive Approvals',
    status: 'real',
    phase: 'P8'
  });

  registry.register({
    id: 'communication.email',
    name: 'Email Channel Adapter with RFC822 Threading and Recipient Parsing',
    status: 'real',
    phase: 'P8'
  });

  registry.register({
    id: 'communication.discord',
    name: 'Discord Channel Adapter with Markdown and Embed Formatting',
    status: 'real',
    phase: 'P8'
  });

  registry.register({
    id: 'communication.slack',
    name: 'Slack Channel Adapter with Blocks and Thread Routing',
    status: 'real',
    phase: 'P8'
  });

  registry.register({
    id: 'communication.whatsapp',
    name: 'WhatsApp Business Platform Cloud API Adapter (Experimental)',
    status: 'experimental',
    reason: 'Requires official WhatsApp Business Account registration and Cloud API webhooks',
    phase: 'P8'
  });

  registry.register({
    id: 'communication.policy_guard',
    name: 'Sender Identity Authorization and Stranger Privilege Separation Guard',
    status: 'real',
    phase: 'P8'
  });

  registry.register({
    id: 'communication.calendar',
    name: 'Calendar Engine with Natural Language Deadlines and Proactive Reminders',
    status: 'real',
    phase: 'P8'
  });
}

/**
 * Seed the P9 Multimodal & Voice capability set (spec sections 46, 47).
 */
export function seedP9Capabilities(registry: CapabilityRegistry): void {
  registry.register({
    id: 'multimodal.vision',
    name: 'Vision Analysis with UI Element Detection and OCR Text Extraction',
    status: 'real',
    phase: 'P9'
  });

  registry.register({
    id: 'multimodal.stt',
    name: 'Speech-to-Text Audio Transcription with Language and Timestamp Support',
    status: 'real',
    phase: 'P9'
  });

  registry.register({
    id: 'multimodal.tts',
    name: 'Text-to-Speech Audio Synthesis with PCM WAV Generation',
    status: 'real',
    phase: 'P9'
  });

  registry.register({
    id: 'multimodal.image_generation',
    name: 'Image Generation and Multimodal Artifact Persistence',
    status: 'real',
    phase: 'P9'
  });

  registry.register({
    id: 'multimodal.voice_goal_routing',
    name: 'Voice Request to Persistent Goal and Planned Task Routing via Core Agent',
    status: 'real',
    phase: 'P9'
  });

  registry.register({
    id: 'multimodal.screenshot_browser_loop',
    name: 'Closed-Loop Screenshot Vision Analysis, Browser Action, and Verification',
    status: 'real',
    phase: 'P9'
  });

  registry.register({
    id: 'multimodal.realtime_voice_duplex',
    name: 'Real-time Full Duplex Voice Conversational Stream (Experimental)',
    status: 'experimental',
    reason: 'Requires WebRTC or bidirectional low-latency audio stream server setup',
    phase: 'P9'
  });

  registry.register({
    id: 'multimodal.video_streaming',
    name: 'Continuous Camera Video Stream Analysis (Unsupported)',
    status: 'unsupported',
    reason: 'Requires hardware camera capture and continuous video processing pipeline',
    phase: 'P9'
  });
}

