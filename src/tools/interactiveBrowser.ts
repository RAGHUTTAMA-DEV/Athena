import { Tool } from '../core/types.js';
import { chromium, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs/promises';

// Global session state to persist the browser session across tool calls
let activeBrowser: { context: BrowserContext; page: Page } | null = null;

// Initialize or reuse browser context
async function getBrowserSession() {
  if (activeBrowser) {
    try {
      // Check if context/page are still alive/active
      if (activeBrowser.page && !activeBrowser.page.isClosed()) {
        return activeBrowser;
      }
    } catch {
      // If error occurs, reset context
      activeBrowser = null;
    }
  }

  // Use a persistent context to preserve cookies/login/cart info
  const userDataDir = path.resolve('./.browser-session-data');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: process.env.BROWSER_HEADLESS !== 'false', // Headless by default, set BROWSER_HEADLESS=false to watch
    viewport: { width: 1280, height: 800 },
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
    permissions: ['geolocation'],
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled' // Helps bypass basic bot checks
    ]
  });

  const page = context.pages()[0] || (await context.newPage());
  
  // Set user agent language to en-IN/en-US
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'en-IN,en-US,en;q=0.9',
  });

  activeBrowser = { context, page };
  return activeBrowser;
}

/**
 * Tool: Navigate Browser
 */
export const browserNavigateTool: Tool = {
  definition: {
    name: 'browserNavigate',
    description: 'Navigate the active browser to a URL and return a summary of interactive elements.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { 
          type: 'STRING', 
          description: 'The URL to go to, e.g. "https://www.amazon.com"' 
        }
      },
      required: ['url']
    }
  },
  requiresConfirmation: false,
  execute: async (args: { url: string }) => {
    try {
      const { page } = await getBrowserSession();
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Extra short wait for elements to load
      await page.waitForTimeout(2000);
      return await getPageElementsSummary(page);
    } catch (err: any) {
      return { success: false, error: `Failed to navigate to ${args.url}: ${err.message}` };
    }
  }
};

/**
 * Tool: Interactive Action (Click, Type, Press Key)
 */
export const browserActionTool: Tool = {
  definition: {
    name: 'browserAction',
    description: 'Perform an action (click, type, or pressKey) on a page element.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: { 
          type: 'STRING', 
          description: 'The action to perform: "click" to click an element, "type" to enter text, "pressKey" to press a keyboard key (like "Enter").'
        },
        selector: { 
          type: 'STRING', 
          description: 'The target element selector. Use "id=N" where N is the athenaId returned in the interactiveElements list, or a standard CSS selector.' 
        },
        value: { 
          type: 'STRING', 
          description: 'The text to enter (if action is "type") or the key name to press (if action is "pressKey", e.g., "Enter").' 
        }
      },
      required: ['action', 'selector']
    }
  },
  requiresConfirmation: true, // Safeguard for automated actions
  execute: async (args: { action: 'click' | 'type' | 'pressKey'; selector: string; value?: string }) => {
    try {
      const { page } = await getBrowserSession();
      
      // Map custom ID selector or standard selector
      const selector = args.selector.startsWith('id=') 
        ? `[data-athena-id="${args.selector.split('=')[1]}"]` 
        : args.selector;

      const element = await page.waitForSelector(selector, { timeout: 10000 });
      if (!element) {
        return { success: false, error: `Element not found: ${args.selector}` };
      }

      if (args.action === 'click') {
        await element.click();
        await page.waitForTimeout(3000); // Wait for transitions/loads
      } else if (args.action === 'type') {
        await element.fill(''); // Clear existing text
        await element.type(args.value || '', { delay: 50 }); // Natural type speed
      } else if (args.action === 'pressKey') {
        await page.keyboard.press(args.value || 'Enter');
        await page.waitForTimeout(3000);
      }

      return await getPageElementsSummary(page);
    } catch (err: any) {
      return { success: false, error: `Action failed: ${err.message}` };
    }
  }
};

/**
 * Helper to tag elements and return interactive elements summary
 */
async function getPageElementsSummary(page: Page) {
  // Inject tags on interactive nodes in the DOM
  await page.evaluate(() => {
    let idCounter = 1;
    const clickables = document.querySelectorAll('button, input, select, textarea, a, [role="button"], [class*="button"]');
    clickables.forEach((el) => {
      // Remove any pre-existing tags
      el.removeAttribute('data-athena-id');
      
      const rect = el.getBoundingClientRect();
      // Only tag visible elements with dimensions
      if (rect.width > 0 && rect.height > 0 && window.getComputedStyle(el).display !== 'none') {
        el.setAttribute('data-athena-id', String(idCounter++));
      }
    });
  });

  // Extract relevant info from tagged nodes
  const elements = await page.evaluate(() => {
    const data: any[] = [];
    const elementsWithId = document.querySelectorAll('[data-athena-id]');
    elementsWithId.forEach((el) => {
      const id = el.getAttribute('data-athena-id');
      const tagName = el.tagName.toLowerCase();
      const text = el.textContent?.replace(/\s+/g, ' ').trim().slice(0, 100) || '';
      const type = (el as any).type || '';
      const placeholder = (el as any).placeholder || '';
      const ariaLabel = el.getAttribute('aria-label') || '';
      const href = el.getAttribute('href') || '';

      data.push({
        athenaId: id,
        tag: tagName,
        type: type || undefined,
        text: text || undefined,
        placeholder: placeholder || undefined,
        ariaLabel: ariaLabel || undefined,
        href: href ? href.slice(0, 80) : undefined
      });
    });
    return data;
  });

  const title = await page.title();
  
  return {
    success: true,
    title,
    currentUrl: page.url(),
    // Return up to 150 interactive elements to manage token size
    interactiveElements: elements.slice(0, 150)
  };
}

/**
 * Tool: Capture Browser Screenshot
 */
export const browserScreenshotTool: Tool = {
  definition: {
    name: 'browserScreenshot',
    description: 'Capture a screenshot of the currently active browser page (or navigate to a URL and take a screenshot). Saves the image locally for visual verification.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: {
          type: 'STRING',
          description: 'Optional URL to navigate to before capturing screenshot. If omitted, captures current active page.'
        },
        path: {
          type: 'STRING',
          description: 'Optional file path where screenshot should be saved (defaults to "scratch/screenshots/screenshot_<timestamp>.png").'
        },
        fullPage: {
          type: 'BOOLEAN',
          description: 'Whether to capture full scrollable page height (defaults to false).'
        }
      }
    }
  },
  requiresConfirmation: false,
  execute: async (args: { url?: string; path?: string; fullPage?: boolean }) => {
    try {
      const { page } = await getBrowserSession();

      if (args.url) {
        await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(1500);
      }

      const saveDir = path.resolve(process.cwd(), 'scratch/screenshots');
      await fs.mkdir(saveDir, { recursive: true });

      const filename = args.path
        ? path.resolve(process.cwd(), args.path)
        : path.join(saveDir, `screenshot_${Date.now()}.png`);

      await fs.mkdir(path.dirname(filename), { recursive: true });
      await page.screenshot({ path: filename, fullPage: args.fullPage === true });

      const title = await page.title();
      const relativePath = path.relative(process.cwd(), filename);

      return {
        success: true,
        title,
        currentUrl: page.url(),
        savedPath: relativePath.replace(/\\/g, '/'),
        message: `Screenshot captured successfully and saved to ${relativePath}.`
      };
    } catch (err: any) {
      return { success: false, error: `Failed to capture screenshot: ${err.message}` };
    }
  }
};
