import { Tool } from '../runtime/types.js';
import { BrowserEngine } from '../browser/browserEngine.js';
import { BrowserActionType, BrowserExtractFormat } from '../browser/browserTypes.js';

/**
 * Tool: Navigate Browser (P4C)
 */
export const browserNavigateTool: Tool = {
  definition: {
    name: 'browserNavigate',
    description: 'Navigate the browser to a URL and return a summary of interactive elements and page content (sanitized via PromptDefense). Supports isolated profiles and tab selection.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: {
          type: 'STRING',
          description: 'The URL to go to, e.g. "https://example.com"'
        },
        profileId: {
          type: 'STRING',
          description: 'Optional isolated profile ID. Defaults to the active agent/task profile.'
        },
        tabId: {
          type: 'STRING',
          description: 'Optional target tab ID. If omitted, uses active tab.'
        },
        waitUntil: {
          type: 'STRING',
          enum: ['domcontentloaded', 'load', 'networkidle'],
          description: 'When to consider navigation successful (default: domcontentloaded).'
        }
      },
      required: ['url']
    }
  },
  requiresConfirmation: false,
  manifest: {
    name: 'browserNavigate',
    version: '2.0.0',
    description: 'Navigate browser page with isolated profile and PromptDefense boundary',
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 45000,
    permissions: ['browser', 'net:http'],
    tags: ['browser', 'web']
  },
  execute: async (args: {
    url: string;
    profileId?: string;
    tabId?: string;
    waitUntil?: 'domcontentloaded' | 'load' | 'networkidle';
  }) => {
    try {
      const engine = BrowserEngine.getInstance();
      const result = await engine.navigate({
        url: args.url,
        profileId: args.profileId,
        tabId: args.tabId,
        waitUntil: args.waitUntil
      });
      return {
        success: true,
        title: result.title,
        currentUrl: result.url,
        tabId: result.tabId,
        interactiveElements: result.interactiveElements,
        content: result.sanitizedContent,
        threatsDetected: result.threatsDetected,
        cookiesCount: result.cookiesCount
      };
    } catch (err: any) {
      return { success: false, error: `Failed to navigate to ${args.url}: ${err.message}` };
    }
  }
};

/**
 * Tool: Interactive Action (P4C)
 */
export const browserActionTool: Tool = {
  definition: {
    name: 'browserAction',
    description: 'Perform an interactive action on a page element (click, doubleClick, rightClick, type, pressKey, selectOption, check, uncheck, hover, scroll, uploadFile).',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['click', 'doubleClick', 'rightClick', 'hover', 'type', 'pressKey', 'selectOption', 'check', 'uncheck', 'scroll', 'uploadFile'],
          description: 'The browser interaction to execute.'
        },
        selector: {
          type: 'STRING',
          description: 'The target element selector: "id=N" (using athenaId), CSS selector, or text matcher.'
        },
        value: {
          type: 'STRING',
          description: 'Text to type, key to press, select option value, or file path to upload.'
        },
        profileId: {
          type: 'STRING',
          description: 'Optional isolated profile ID.'
        },
        tabId: {
          type: 'STRING',
          description: 'Optional target tab ID.'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: true,
  manifest: {
    name: 'browserAction',
    version: '2.0.0',
    description: 'Execute browser interaction or form action',
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 30000,
    permissions: ['browser'],
    tags: ['browser']
  },
  execute: async (args: {
    action: BrowserActionType;
    selector?: string;
    value?: string;
    profileId?: string;
    tabId?: string;
  }) => {
    try {
      const engine = BrowserEngine.getInstance();
      const result = await engine.executeAction({
        action: args.action,
        selector: args.selector,
        value: args.value,
        profileId: args.profileId,
        tabId: args.tabId
      });
      return {
        success: true,
        title: result.title,
        currentUrl: result.url,
        tabId: result.tabId,
        interactiveElements: result.interactiveElements
      };
    } catch (err: any) {
      return { success: false, error: `Browser action ${args.action} failed: ${err.message}` };
    }
  }
};

/**
 * Tool: Tab Management (P4C)
 */
export const browserTabManageTool: Tool = {
  definition: {
    name: 'browserTabManage',
    description: 'Manage browser tabs (list, new, switch, close).',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['list', 'new', 'switch', 'close'],
          description: 'The tab operation to perform.'
        },
        tabId: {
          type: 'STRING',
          description: 'Target tab ID (required for switch and close).'
        },
        url: {
          type: 'STRING',
          description: 'Optional URL to navigate to when creating a new tab.'
        },
        profileId: {
          type: 'STRING',
          description: 'Optional isolated profile ID.'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: false,
  manifest: {
    name: 'browserTabManage',
    version: '2.0.0',
    description: 'Manage multi-tab browser lifecycle',
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['browser'],
    tags: ['browser', 'tabs']
  },
  execute: async (args: {
    action: 'list' | 'new' | 'switch' | 'close';
    tabId?: string;
    url?: string;
    profileId?: string;
  }) => {
    try {
      const engine = BrowserEngine.getInstance();
      if (args.action === 'list') {
        const tabs = await engine.listTabs({ profileId: args.profileId });
        return { success: true, tabs };
      } else if (args.action === 'new') {
        const tab = await engine.newTab({ url: args.url, profileId: args.profileId });
        return { success: true, tab };
      } else if (args.action === 'switch') {
        if (!args.tabId) return { success: false, error: 'tabId is required to switch tabs' };
        const tab = await engine.switchTab(args.tabId, { profileId: args.profileId });
        return { success: true, tab };
      } else if (args.action === 'close') {
        if (!args.tabId) return { success: false, error: 'tabId is required to close a tab' };
        const closed = await engine.closeTab(args.tabId, { profileId: args.profileId });
        return { success: closed, closedTabId: args.tabId };
      }
      return { success: false, error: `Unknown tab action: ${args.action}` };
    } catch (err: any) {
      return { success: false, error: `Tab operation failed: ${err.message}` };
    }
  }
};

/**
 * Tool: Browser Session & Profile Management (P4C)
 */
export const browserSessionManageTool: Tool = {
  definition: {
    name: 'browserSessionManage',
    description: 'Manage browser sessions, cookies, and persistent profiles (getCookies, clearCookies, listProfiles, deleteProfile).',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['getCookies', 'clearCookies', 'listProfiles', 'deleteProfile'],
          description: 'The session operation to perform.'
        },
        profileId: {
          type: 'STRING',
          description: 'Optional profile ID.'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: false,
  manifest: {
    name: 'browserSessionManage',
    version: '2.0.0',
    description: 'Inspect and manage browser cookies and profile isolation',
    riskLevel: 'safe',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['browser'],
    tags: ['browser', 'session']
  },
  execute: async (args: {
    action: 'getCookies' | 'clearCookies' | 'listProfiles' | 'deleteProfile';
    profileId?: string;
  }) => {
    try {
      const engine = BrowserEngine.getInstance();
      if (args.action === 'getCookies') {
        const cookies = await engine.getCookies({ profileId: args.profileId });
        return { success: true, count: cookies.length, cookies };
      } else if (args.action === 'clearCookies') {
        await engine.clearCookies({ profileId: args.profileId });
        return { success: true, message: 'Cookies cleared successfully.' };
      } else if (args.action === 'listProfiles') {
        const profiles = await engine.getProfileManager().listProfiles();
        return { success: true, profiles };
      } else if (args.action === 'deleteProfile') {
        if (!args.profileId) return { success: false, error: 'profileId required for deleteProfile' };
        await engine.closeProfileContext(args.profileId);
        const deleted = await engine.getProfileManager().deleteProfile(args.profileId);
        return { success: deleted, deletedProfileId: args.profileId };
      }
      return { success: false, error: `Unknown session action: ${args.action}` };
    } catch (err: any) {
      return { success: false, error: `Session operation failed: ${err.message}` };
    }
  }
};

/**
 * Tool: Browser Extract (P4C)
 */
export const browserExtractTool: Tool = {
  definition: {
    name: 'browserExtract',
    description: 'Extract structured content from the active browser page (text, markdown, html, accessibilityTree, interactiveElements, links, forms). All extracted content passes through PromptDefense.',
    parameters: {
      type: 'OBJECT',
      properties: {
        format: {
          type: 'STRING',
          enum: ['text', 'markdown', 'html', 'accessibilityTree', 'interactiveElements', 'links', 'forms'],
          description: 'The extraction format.'
        },
        selector: {
          type: 'STRING',
          description: 'Optional CSS selector to scope extraction to a sub-element.'
        },
        maxChars: {
          type: 'NUMBER',
          description: 'Maximum character length of returned text (default 16000).'
        },
        profileId: {
          type: 'STRING',
          description: 'Optional profile ID.'
        },
        tabId: {
          type: 'STRING',
          description: 'Optional tab ID.'
        }
      },
      required: ['format']
    }
  },
  requiresConfirmation: false,
  manifest: {
    name: 'browserExtract',
    version: '2.0.0',
    description: 'Extract page content with PromptDefense neutralization',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['browser'],
    tags: ['browser', 'extract']
  },
  execute: async (args: {
    format: BrowserExtractFormat;
    selector?: string;
    maxChars?: number;
    profileId?: string;
    tabId?: string;
  }) => {
    try {
      const engine = BrowserEngine.getInstance();
      const extracted = await engine.extractContent({
        format: args.format,
        selector: args.selector,
        maxChars: args.maxChars,
        profileId: args.profileId,
        tabId: args.tabId
      });
      return {
        success: true,
        format: extracted.format,
        url: extracted.url,
        title: extracted.title,
        content: extracted.content,
        sanitized: extracted.sanitized,
        threats: extracted.threats
      };
    } catch (err: any) {
      return { success: false, error: `Content extraction failed: ${err.message}` };
    }
  }
};

/**
 * Tool: Browser Screenshot (P4C)
 */
export const browserScreenshotTool: Tool = {
  definition: {
    name: 'browserScreenshot',
    description: 'Capture a screenshot of the browser page (or navigate to a URL and take a screenshot). Saves image locally for verification.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: {
          type: 'STRING',
          description: 'Optional URL to navigate to before capturing screenshot.'
        },
        path: {
          type: 'STRING',
          description: 'Optional destination file path (defaults to scratch/screenshots/...).'
        },
        fullPage: {
          type: 'BOOLEAN',
          description: 'Whether to capture full scrollable page height (default false).'
        },
        profileId: {
          type: 'STRING',
          description: 'Optional profile ID.'
        },
        tabId: {
          type: 'STRING',
          description: 'Optional tab ID.'
        }
      }
    }
  },
  requiresConfirmation: false,
  manifest: {
    name: 'browserScreenshot',
    version: '2.0.0',
    description: 'Capture screenshot of active or navigated page',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['browser'],
    tags: ['browser', 'screenshot']
  },
  execute: async (args: {
    url?: string;
    path?: string;
    fullPage?: boolean;
    profileId?: string;
    tabId?: string;
  }) => {
    try {
      const engine = BrowserEngine.getInstance();
      const res = await engine.captureScreenshot({
        url: args.url,
        path: args.path,
        fullPage: args.fullPage,
        profileId: args.profileId,
        tabId: args.tabId
      });
      return {
        success: true,
        title: res.title,
        currentUrl: res.url,
        savedPath: res.savedPath,
        message: `Screenshot captured successfully and saved to ${res.savedPath}.`
      };
    } catch (err: any) {
      return { success: false, error: `Failed to capture screenshot: ${err.message}` };
    }
  }
};
