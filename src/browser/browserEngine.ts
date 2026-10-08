import { chromium, BrowserContext, Page, ElementHandle } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';
import { PromptDefense } from '../security/promptDefense.js';
import { BrowserProfileManager } from './browserProfileManager.js';
import {
  BrowserProfile,
  BrowserTab,
  BrowserInteractiveElement,
  BrowserActionOptions,
  BrowserExtractOptions,
  BrowserDownloadResult,
  BrowserCookie,
  BrowserNavigateOptions,
  BrowserPageSummary
} from './browserTypes.js';

interface ManagedContext {
  profile: BrowserProfile;
  context: BrowserContext;
  tabs: Map<string, Page>;
  activeTabId: string;
  downloads: BrowserDownloadResult[];
  tabCounter: number;
}

export class BrowserEngine {
  private static instance: BrowserEngine;
  private profileManager: BrowserProfileManager;
  private contexts: Map<string, ManagedContext> = new Map();
  private promptDefense: PromptDefense;
  private downloadsBaseDir: string;

  constructor(options?: {
    profileManager?: BrowserProfileManager;
    promptDefense?: PromptDefense;
    downloadsDir?: string;
  }) {
    this.profileManager = options?.profileManager || new BrowserProfileManager();
    this.promptDefense = options?.promptDefense || PromptDefense.getInstance();
    this.downloadsBaseDir = options?.downloadsDir
      ? path.resolve(options.downloadsDir)
      : path.resolve(process.cwd(), 'scratch', 'downloads');
  }

  static getInstance(): BrowserEngine {
    if (!BrowserEngine.instance) {
      BrowserEngine.instance = new BrowserEngine();
    }
    return BrowserEngine.instance;
  }

  getProfileManager(): BrowserProfileManager {
    return this.profileManager;
  }

  /**
   * Acquire or launch an isolated persistent browser context for the given profile.
   */
  async getContext(profileOptions?: {
    profileId?: string;
    name?: string;
    agentId?: string;
    taskId?: string;
  }): Promise<ManagedContext> {
    const profile = await this.profileManager.getOrCreateProfile(profileOptions);
    const existing = this.contexts.get(profile.id);

    if (existing) {
      try {
        // Test context liveness
        const pages = existing.context.pages();
        if (pages.length > 0 && !pages[0].isClosed()) {
          return existing;
        }
      } catch {
        this.contexts.delete(profile.id);
      }
    }

    // Launch Playwright persistent context isolated in this profile's directory
    const context = await chromium.launchPersistentContext(profile.userDataDir, {
      headless: process.env.BROWSER_HEADLESS !== 'false',
      viewport: { width: 1280, height: 800 },
      locale: 'en-US',
      timezoneId: 'UTC',
      acceptDownloads: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    const managed: ManagedContext = {
      profile,
      context,
      tabs: new Map(),
      activeTabId: '',
      downloads: [],
      tabCounter: 1
    };

    // Setup download directory for this profile
    const profileDownloadDir = path.join(this.downloadsBaseDir, profile.id);
    await fs.mkdir(profileDownloadDir, { recursive: true });

    // Track pages and downloads
    const setupPage = (page: Page, id?: string): string => {
      const tabId = id || `tab_${managed.tabCounter++}`;
      managed.tabs.set(tabId, page);
      if (!managed.activeTabId) {
        managed.activeTabId = tabId;
      }

      page.on('download', async (download) => {
        try {
          const suggestedFilename = download.suggestedFilename();
          const targetPath = path.join(profileDownloadDir, `${Date.now()}_${suggestedFilename}`);
          await download.saveAs(targetPath);
          const stat = await fs.stat(targetPath);
          const record: BrowserDownloadResult = {
            id: `dl_${Date.now()}`,
            filename: suggestedFilename,
            savedPath: targetPath,
            sizeBytes: stat.size,
            url: download.url(),
            timestamp: Date.now()
          };
          managed.downloads.push(record);
        } catch (err: any) {
          console.warn(`[BrowserEngine] Download error: ${err.message}`);
        }
      });

      page.on('close', () => {
        managed.tabs.delete(tabId);
        if (managed.activeTabId === tabId) {
          const remaining = Array.from(managed.tabs.keys());
          managed.activeTabId = remaining[0] || '';
        }
      });

      return tabId;
    };

    const initialPages = context.pages();
    if (initialPages.length > 0) {
      setupPage(initialPages[0]);
    } else {
      const newP = await context.newPage();
      setupPage(newP);
    }

    this.contexts.set(profile.id, managed);
    return managed;
  }

  /**
   * Get the active or specified page/tab for a profile context.
   */
  async getPage(options?: {
    profileId?: string;
    agentId?: string;
    taskId?: string;
    tabId?: string;
  }): Promise<{ page: Page; tabId: string; managed: ManagedContext }> {
    const managed = await this.getContext(options);

    let tabId = options?.tabId || managed.activeTabId;
    let page = tabId ? managed.tabs.get(tabId) : undefined;

    if (!page || page.isClosed()) {
      // Re-acquire active tab or spawn new one
      const openTabs = Array.from(managed.tabs.entries()).filter(([_, p]) => !p.isClosed());
      if (openTabs.length > 0) {
        tabId = openTabs[0][0];
        page = openTabs[0][1];
        managed.activeTabId = tabId;
      } else {
        page = await managed.context.newPage();
        tabId = `tab_${managed.tabCounter++}`;
        managed.tabs.set(tabId, page);
        managed.activeTabId = tabId;
      }
    }

    return { page, tabId, managed };
  }

  // --- TAB MANAGEMENT ---

  async newTab(options?: {
    url?: string;
    profileId?: string;
    agentId?: string;
    taskId?: string;
  }): Promise<BrowserTab> {
    const managed = await this.getContext(options);
    const page = await managed.context.newPage();
    const tabId = `tab_${managed.tabCounter++}`;
    managed.tabs.set(tabId, page);
    managed.activeTabId = tabId;

    if (options?.url) {
      await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    }

    return {
      id: tabId,
      index: managed.tabs.size,
      url: page.url(),
      title: await page.title(),
      isActive: true
    };
  }

  async listTabs(options?: { profileId?: string; agentId?: string; taskId?: string }): Promise<BrowserTab[]> {
    const managed = await this.getContext(options);
    const result: BrowserTab[] = [];
    let idx = 1;

    for (const [id, page] of managed.tabs.entries()) {
      if (!page.isClosed()) {
        result.push({
          id,
          index: idx++,
          url: page.url(),
          title: await page.title().catch(() => ''),
          isActive: id === managed.activeTabId
        });
      }
    }
    return result;
  }

  async switchTab(tabId: string, options?: { profileId?: string; agentId?: string; taskId?: string }): Promise<BrowserTab> {
    const managed = await this.getContext(options);
    const page = managed.tabs.get(tabId);
    if (!page || page.isClosed()) {
      throw new Error(`Tab ${tabId} not found in profile ${managed.profile.id}`);
    }
    await page.bringToFront();
    managed.activeTabId = tabId;

    return {
      id: tabId,
      index: Array.from(managed.tabs.keys()).indexOf(tabId) + 1,
      url: page.url(),
      title: await page.title().catch(() => ''),
      isActive: true
    };
  }

  async closeTab(tabId: string, options?: { profileId?: string; agentId?: string; taskId?: string }): Promise<boolean> {
    const managed = await this.getContext(options);
    const page = managed.tabs.get(tabId);
    if (!page) return false;

    await page.close().catch(() => {});
    managed.tabs.delete(tabId);
    if (managed.activeTabId === tabId) {
      const remaining = Array.from(managed.tabs.keys());
      managed.activeTabId = remaining[0] || '';
    }
    return true;
  }

  // --- NAVIGATION ---

  async navigate(options: BrowserNavigateOptions): Promise<BrowserPageSummary> {
    const { page, tabId, managed } = await this.getPage(options);
    const timeout = options.timeoutMs ?? 30000;
    const waitUntil = options.waitUntil ?? 'domcontentloaded';

    await page.goto(options.url, { waitUntil, timeout });
    await page.waitForTimeout(1000); // Allow brief render transition

    return await this.getPageSummary(page, tabId, managed);
  }

  // --- INTERACTION & FORM ACTIONS ---

  async executeAction(options: BrowserActionOptions): Promise<BrowserPageSummary> {
    const { page, tabId, managed } = await this.getPage(options);
    const timeout = options.timeoutMs ?? 10000;

    // Resolve target selector (supports "id=N" or direct CSS/text selector)
    let selector = options.selector;
    if (selector && selector.startsWith('id=')) {
      const athenaId = selector.split('=')[1];
      selector = `[data-athena-id="${athenaId}"]`;
    }

    switch (options.action) {
      case 'click': {
        if (!selector) throw new Error('Selector is required for click action');
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`Element not found: ${options.selector}`);
        await el.click();
        await page.waitForTimeout(1000);
        break;
      }

      case 'doubleClick': {
        if (!selector) throw new Error('Selector is required for doubleClick action');
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`Element not found: ${options.selector}`);
        await el.dblclick();
        await page.waitForTimeout(1000);
        break;
      }

      case 'rightClick': {
        if (!selector) throw new Error('Selector is required for rightClick action');
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`Element not found: ${options.selector}`);
        await el.click({ button: 'right' });
        await page.waitForTimeout(1000);
        break;
      }

      case 'hover': {
        if (!selector) throw new Error('Selector is required for hover action');
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`Element not found: ${options.selector}`);
        await el.hover();
        await page.waitForTimeout(500);
        break;
      }

      case 'type': {
        if (!selector) throw new Error('Selector is required for type action');
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`Element not found: ${options.selector}`);
        const textToType = typeof options.value === 'string' ? options.value : (Array.isArray(options.value) ? options.value.join('') : '');
        await el.fill('');
        await el.type(textToType, { delay: 30 });
        await page.waitForTimeout(500);
        break;
      }

      case 'pressKey': {
        const key = typeof options.value === 'string' ? options.value : 'Enter';
        if (selector) {
          const el = await page.waitForSelector(selector, { timeout });
          if (el) await el.press(key);
          else await page.keyboard.press(key);
        } else {
          await page.keyboard.press(key);
        }
        await page.waitForTimeout(1000);
        break;
      }

      case 'selectOption': {
        if (!selector) throw new Error('Selector is required for selectOption action');
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`Element not found: ${options.selector}`);
        const optValue = options.value;
        if (typeof optValue === 'string') {
          await page.selectOption(selector, optValue);
        } else if (Array.isArray(optValue)) {
          await page.selectOption(selector, optValue);
        }
        await page.waitForTimeout(500);
        break;
      }

      case 'check': {
        if (!selector) throw new Error('Selector is required for check action');
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`Element not found: ${options.selector}`);
        await el.check();
        await page.waitForTimeout(500);
        break;
      }

      case 'uncheck': {
        if (!selector) throw new Error('Selector is required for uncheck action');
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`Element not found: ${options.selector}`);
        await el.uncheck();
        await page.waitForTimeout(500);
        break;
      }

      case 'scroll': {
        if (selector) {
          const el = await page.waitForSelector(selector, { timeout });
          if (el) await el.scrollIntoViewIfNeeded();
        } else if (options.scrollDelta) {
          await page.mouse.wheel(options.scrollDelta.x || 0, options.scrollDelta.y || 500);
        } else {
          await page.evaluate(() => window.scrollBy(0, 500));
        }
        await page.waitForTimeout(500);
        break;
      }

      case 'uploadFile': {
        if (!selector) throw new Error('Selector is required for uploadFile action');
        if (!options.value || typeof options.value !== 'string') {
          throw new Error('File path (value) is required for uploadFile action');
        }
        const resolvedPath = path.resolve(options.value);
        await fs.access(resolvedPath); // Validate file exists
        const el = await page.waitForSelector(selector, { timeout });
        if (!el) throw new Error(`File input element not found: ${options.selector}`);
        await el.setInputFiles(resolvedPath);
        await page.waitForTimeout(1000);
        break;
      }

      default:
        throw new Error(`Unsupported browser action: ${options.action}`);
    }

    return await this.getPageSummary(page, tabId, managed);
  }

  // --- CONTENT EXTRACTION & PROMPT DEFENSE ---

  async extractContent(options: BrowserExtractOptions): Promise<{
    format: string;
    url: string;
    title: string;
    content: string;
    sanitized: boolean;
    threats: string[];
  }> {
    const { page } = await this.getPage(options);
    const maxChars = options.maxChars ?? 16000;
    let rawContent = '';

    switch (options.format) {
      case 'text': {
        rawContent = await page.evaluate(() => {
          return document.body ? document.body.innerText : '';
        });
        break;
      }

      case 'html': {
        rawContent = options.selector
          ? await page.$eval(options.selector, (el) => el.outerHTML).catch(() => '')
          : await page.content();
        break;
      }

      case 'markdown': {
        rawContent = await page.evaluate(() => {
          // Lightweight in-page markdown extraction
          const clone = document.body.cloneNode(true) as HTMLElement;
          const scripts = clone.querySelectorAll('script, style, noscript');
          scripts.forEach((s) => s.remove());

          let text = '';
          const headings = clone.querySelectorAll('h1, h2, h3, h4, h5, h6');
          headings.forEach((h) => {
            const level = '#'.repeat(parseInt(h.tagName.substring(1), 10));
            h.textContent = `\n\n${level} ${h.textContent?.trim()}\n\n`;
          });
          const links = clone.querySelectorAll('a[href]');
          links.forEach((a) => {
            const href = a.getAttribute('href');
            a.textContent = `[${a.textContent?.trim()}](${href})`;
          });
          return clone.innerText || clone.textContent || '';
        });
        break;
      }

      case 'accessibilityTree': {
        let snapshot: any = null;
        try {
          if (typeof page.locator('body').ariaSnapshot === 'function') {
            snapshot = await page.locator('body').ariaSnapshot();
          } else if ((page as any).accessibility?.snapshot) {
            snapshot = await (page as any).accessibility.snapshot();
          }
        } catch {
          snapshot = null;
        }
        rawContent = typeof snapshot === 'string'
          ? snapshot
          : (snapshot ? JSON.stringify(snapshot, null, 2) : 'No accessibility tree available.');
        break;
      }

      case 'interactiveElements': {
        const summary = await this.getPageElementsSummary(page);
        rawContent = JSON.stringify(summary, null, 2);
        break;
      }

      case 'links': {
        const links = await page.evaluate(() => {
          const list: Array<{ text: string; href: string }> = [];
          document.querySelectorAll('a[href]').forEach((a) => {
            const href = a.getAttribute('href') || '';
            const text = a.textContent?.trim() || '';
            if (href && (text || href.startsWith('http'))) {
              list.push({ text: text.slice(0, 80), href: href.slice(0, 200) });
            }
          });
          return list.slice(0, 100);
        });
        rawContent = JSON.stringify(links, null, 2);
        break;
      }

      case 'forms': {
        const forms = await page.evaluate(() => {
          const formList: any[] = [];
          document.querySelectorAll('form').forEach((f, idx) => {
            const inputs: any[] = [];
            f.querySelectorAll('input, select, textarea, button').forEach((el: any) => {
              inputs.push({
                tag: el.tagName.toLowerCase(),
                name: el.name || undefined,
                type: el.type || undefined,
                placeholder: el.placeholder || undefined,
                value: el.value ? String(el.value).slice(0, 50) : undefined
              });
            });
            formList.push({
              formIndex: idx + 1,
              action: f.action || undefined,
              method: f.method || 'GET',
              elements: inputs
            });
          });
          return formList;
        });
        rawContent = JSON.stringify(forms, null, 2);
        break;
      }

      default:
        rawContent = await page.evaluate(() => document.body?.innerText || '');
    }

    const title = await page.title().catch(() => '');
    const url = page.url();

    // Section 19 & Phase 4C Rule: ALL page content passes through PromptDefense
    const defenseAnalysis = this.promptDefense.analyzeAndSanitize(rawContent.slice(0, maxChars));
    const wrappedContent = this.promptDefense.wrapUntrustedData(defenseAnalysis.sanitizedContent, {
      source: 'web',
      origin: url
    });

    return {
      format: options.format,
      url,
      title,
      content: wrappedContent,
      sanitized: defenseAnalysis.hasInjection,
      threats: defenseAnalysis.threats
    };
  }

  // --- COOKIES & SESSIONS ---

  async getCookies(options?: { profileId?: string; agentId?: string; taskId?: string }): Promise<BrowserCookie[]> {
    const managed = await this.getContext(options);
    const rawCookies = await managed.context.cookies();
    return rawCookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      expires: c.expires,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite as any
    }));
  }

  async setCookies(
    cookies: BrowserCookie[],
    options?: { profileId?: string; agentId?: string; taskId?: string }
  ): Promise<void> {
    const managed = await this.getContext(options);
    await managed.context.addCookies(
      cookies.map((c) => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires,
        httpOnly: c.httpOnly,
        secure: c.secure,
        sameSite: c.sameSite
      }))
    );
  }

  async clearCookies(options?: { profileId?: string; agentId?: string; taskId?: string }): Promise<void> {
    const managed = await this.getContext(options);
    await managed.context.clearCookies();
  }

  async saveStorageState(filePath: string, options?: { profileId?: string; agentId?: string; taskId?: string }): Promise<string> {
    const managed = await this.getContext(options);
    const resolvedPath = path.resolve(filePath);
    await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
    await managed.context.storageState({ path: resolvedPath });
    return resolvedPath;
  }

  // --- SCREENSHOTS ---

  async captureScreenshot(options?: {
    url?: string;
    path?: string;
    fullPage?: boolean;
    profileId?: string;
    agentId?: string;
    taskId?: string;
    tabId?: string;
  }): Promise<{ savedPath: string; url: string; title: string }> {
    const { page } = await this.getPage(options);

    if (options?.url) {
      await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
    }

    const saveDir = path.resolve(process.cwd(), 'scratch', 'screenshots');
    await fs.mkdir(saveDir, { recursive: true });

    const filename = options?.path
      ? path.resolve(options.path)
      : path.join(saveDir, `screenshot_${Date.now()}.png`);

    await fs.mkdir(path.dirname(filename), { recursive: true });
    await page.screenshot({ path: filename, fullPage: options?.fullPage === true });

    const title = await page.title().catch(() => '');
    const relativePath = path.relative(process.cwd(), filename).replace(/\\/g, '/');

    return {
      savedPath: relativePath,
      url: page.url(),
      title
    };
  }

  // --- DOWNLOADS ---

  getDownloads(options?: { profileId?: string; agentId?: string; taskId?: string }): BrowserDownloadResult[] {
    const profileId = this.profileManager.resolveProfileId(options);
    const managed = this.contexts.get(profileId);
    return managed ? [...managed.downloads] : [];
  }

  // --- CLEANUP ---

  async closeAll(): Promise<void> {
    for (const [id, managed] of this.contexts.entries()) {
      try {
        await managed.context.close();
      } catch {
        // Ignore
      }
    }
    this.contexts.clear();
  }

  async closeProfileContext(profileId: string): Promise<void> {
    const managed = this.contexts.get(profileId);
    if (managed) {
      try {
        await managed.context.close();
      } catch {
        // Ignore
      }
      this.contexts.delete(profileId);
    }
  }

  // --- INTERNAL DOM HELPER ---

  private async getPageSummary(page: Page, tabId: string, managed: ManagedContext): Promise<BrowserPageSummary> {
    const title = await page.title().catch(() => '');
    const url = page.url();
    const interactiveElements = await this.getPageElementsSummary(page);

    // Extract quick body text and sanitize via PromptDefense
    const bodyText = await page.evaluate(() => document.body?.innerText?.slice(0, 4000) || '');
    const defense = this.promptDefense.analyzeAndSanitize(bodyText);
    const cookies = await managed.context.cookies().catch(() => []);

    return {
      title,
      url,
      tabId,
      interactiveElements,
      sanitizedContent: this.promptDefense.wrapUntrustedData(defense.sanitizedContent, {
        source: 'web',
        origin: url
      }),
      threatsDetected: defense.threats,
      cookiesCount: cookies.length
    };
  }

  private async getPageElementsSummary(page: Page): Promise<BrowserInteractiveElement[]> {
    // Inject data-athena-id on interactive nodes
    await page.evaluate(() => {
      let idCounter = 1;
      const clickables = document.querySelectorAll(
        'button, input, select, textarea, a, [role="button"], [role="link"], [role="checkbox"], [role="option"], [class*="button"]'
      );
      clickables.forEach((el) => {
        el.removeAttribute('data-athena-id');
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none') {
          el.setAttribute('data-athena-id', String(idCounter++));
        }
      });
    });

    // Extract element data
    return await page.evaluate(() => {
      const data: any[] = [];
      const elementsWithId = document.querySelectorAll('[data-athena-id]');
      elementsWithId.forEach((el) => {
        const id = el.getAttribute('data-athena-id');
        const tagName = el.tagName.toLowerCase();
        const text = el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100) || '';
        const type = (el as any).type || '';
        const role = el.getAttribute('role') || '';
        const placeholder = (el as any).placeholder || '';
        const ariaLabel = el.getAttribute('aria-label') || '';
        const href = el.getAttribute('href') || '';
        const checked = (el as any).checked || undefined;
        const disabled = (el as any).disabled || undefined;
        const val = (el as any).value ? String((el as any).value).slice(0, 50) : undefined;

        data.push({
          athenaId: id,
          tag: tagName,
          type: type || undefined,
          role: role || undefined,
          text: text || undefined,
          placeholder: placeholder || undefined,
          ariaLabel: ariaLabel || undefined,
          href: href ? href.slice(0, 80) : undefined,
          checked,
          disabled,
          value: val
        });
      });
      return data.slice(0, 150);
    });
  }
}
