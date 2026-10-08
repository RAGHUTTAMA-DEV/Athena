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

  list(): CapabilityEntry[] {
    return Array.from(this.capabilities.values()).sort((a, b) => a.id.localeCompare(b.id));
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
