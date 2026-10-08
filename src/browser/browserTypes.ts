/**
/**
 * Browser subsystem type definitions (Athena V2 Phase 4C — Spec Section 19).
 */

export interface BrowserProfile {
  id: string;
  name: string;
  agentId?: string | null;
  taskId?: string | null;
  userDataDir: string;
  isEphemeral?: boolean;
  createdAt: number;
  metadata?: Record<string, any>;
}

export interface BrowserTab {
  id: string;
  index: number;
  url: string;
  title: string;
  isActive: boolean;
}

export interface BrowserInteractiveElement {
  athenaId: string;
  tag: string;
  type?: string;
  role?: string;
  text?: string;
  placeholder?: string;
  ariaLabel?: string;
  href?: string;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
}

export type BrowserActionType =
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'hover'
  | 'type'
  | 'pressKey'
  | 'selectOption'
  | 'check'
  | 'uncheck'
  | 'scroll'
  | 'uploadFile';

export interface BrowserActionOptions {
  action: BrowserActionType;
  selector?: string;
  value?: string | string[];
  scrollDelta?: { x?: number; y?: number };
  profileId?: string;
  tabId?: string;
  timeoutMs?: number;
}

export type BrowserExtractFormat =
  | 'text'
  | 'html'
  | 'markdown'
  | 'accessibilityTree'
  | 'interactiveElements'
  | 'links'
  | 'forms';

export interface BrowserExtractOptions {
  format: BrowserExtractFormat;
  profileId?: string;
  tabId?: string;
  selector?: string;
  maxChars?: number;
}

export interface BrowserDownloadResult {
  id: string;
  filename: string;
  savedPath: string;
  sizeBytes: number;
  url: string;
  mimeType?: string;
  timestamp: number;
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface BrowserNavigateOptions {
  url: string;
  profileId?: string;
  agentId?: string;
  taskId?: string;
  tabId?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
  timeoutMs?: number;
}

export interface BrowserPageSummary {
  title: string;
  url: string;
  tabId: string;
  interactiveElements: BrowserInteractiveElement[];
  sanitizedContent?: string;
  threatsDetected?: string[];
  cookiesCount?: number;
}
