import { Tool } from '../runtime/types.js';
import { ComputerController } from '../computer/computerController.js';
import { ComputerActionType, MouseButton, Point } from '../computer/computerTypes.js';

/**
 * Tool: Inspect Computer Desktop / Windows / Accessibility (P4D)
 */
export const computerInspectTool: Tool = {
  definition: {
    name: 'computerInspect',
    description: 'Inspect desktop screen resolution, capture screen screenshot, get active foreground window, list open windows, or inspect the OS Accessibility / UI Automation tree.',
    capabilities: ['computer'],
    tags: ['computer', 'desktop', 'inspect', 'window', 'accessibility'],
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['screen', 'windows', 'activeWindow', 'accessibilityTree'],
          description: 'Inspection action: "screen" for resolution and screenshot, "windows" to list top-level windows, "activeWindow" for focused window, "accessibilityTree" for UIAutomation tree.'
        },
        windowTitle: {
          type: 'STRING',
          description: 'Optional window title for accessibility tree inspection.'
        },
        windowHandle: {
          type: 'NUMBER',
          description: 'Optional native window handle (HWND) for accessibility tree inspection.'
        },
        maxDepth: {
          type: 'NUMBER',
          description: 'Max tree recursion depth for accessibility inspection (default 3).'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: false,
  manifest: {
    name: 'computerInspect',
    version: '1.0.0',
    description: 'Inspect desktop screen, windows, and UI Automation tree',
    riskLevel: 'safe',
    parallelSafe: true,
    timeoutMs: 30000,
    permissions: ['computer'],
    tags: ['computer', 'desktop', 'inspect', 'window', 'accessibility']
  },
  execute: async (args: {
    action?: 'screen' | 'windows' | 'activeWindow' | 'accessibilityTree';
    windowTitle?: string;
    windowHandle?: number;
    maxDepth?: number;
    depth?: number;
    titlePattern?: string | string[];
    title?: string;
  }) => {
    try {
      const controller = ComputerController.getInstance();
      let action = args.action;
      if (!action) {
        if (args.depth !== undefined || args.maxDepth !== undefined) {
          action = 'accessibilityTree';
        } else if (args.titlePattern || args.windowTitle || args.title) {
          action = 'windows';
        } else {
          action = 'screen';
        }
      }

      switch (action) {
        case 'screen': {
          const res = await controller.inspectScreen();
          return {
            success: true,
            dimensions: res.dimensions,
            screenshotPath: res.screenshotPath,
            activeWindow: res.activeWindow
          };
        }
        case 'windows': {
          const windows = await controller.listWindows();
          const pattern = args.titlePattern || args.windowTitle || args.title;
          let filtered = windows;
          if (pattern) {
            const patterns = Array.isArray(pattern) ? pattern : [pattern];
            filtered = windows.filter(w => patterns.some(p => w.title.toLowerCase().includes(p.toLowerCase())));
          }
          return {
            success: true,
            count: filtered.length,
            windows: filtered
          };
        }
        case 'activeWindow': {
          const active = await controller.getBackend().getActiveWindow();
          return {
            success: true,
            activeWindow: active
          };
        }
        case 'accessibilityTree': {
          const effectiveDepth = args.maxDepth ?? args.depth ?? 3;
          const tree = await controller.getAccessibilityTree({
            windowTitle: args.windowTitle || args.title,
            windowHandle: args.windowHandle,
            maxDepth: effectiveDepth
          });
          return {
            success: true,
            accessibilityTree: tree
          };
        }
        default:
          return { success: false, error: `Unknown inspect action: ${action}` };
      }
    } catch (err: any) {
      return { success: false, error: `Computer inspection failed: ${err.message}` };
    }
  }
};

/**
 * Tool: Computer Input Interaction (P4D)
 */
export const computerInteractTool: Tool = {
  definition: {
    name: 'computerInteract',
    description: 'Dispatch OS mouse and keyboard input events (mouseMove, click, doubleClick, rightClick, mouseDrag, scroll, type, pressKey). Subject to permission scoping and audit logging.',
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['click', 'doubleClick', 'rightClick', 'mouseMove', 'mouseDrag', 'scroll', 'type', 'pressKey'],
          description: 'The native input action to perform.'
        },
        point: {
          type: 'OBJECT',
          properties: {
            x: { type: 'NUMBER', description: 'X pixel coordinate.' },
            y: { type: 'NUMBER', description: 'Y pixel coordinate.' }
          },
          description: 'Coordinates for mouse move, click, or start of drag.'
        },
        toPoint: {
          type: 'OBJECT',
          properties: {
            x: { type: 'NUMBER', description: 'Destination X pixel coordinate.' },
            y: { type: 'NUMBER', description: 'Destination Y pixel coordinate.' }
          },
          description: 'Destination coordinates for mouse drag.'
        },
        button: {
          type: 'STRING',
          enum: ['left', 'right', 'middle'],
          description: 'Mouse button to click (default: left).'
        },
        text: {
          type: 'STRING',
          description: 'Text to type into focused element.'
        },
        key: {
          type: 'STRING',
          description: 'Keyboard key to press (e.g. "Enter", "Tab", "Escape", "F5").'
        },
        modifiers: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Modifier keys to hold during key press (e.g. ["Ctrl"], ["Shift", "Alt"]).'
        },
        scrollDelta: {
          type: 'OBJECT',
          properties: {
            x: { type: 'NUMBER' },
            y: { type: 'NUMBER' }
          },
          description: 'Scroll amount in pixels (negative Y scrolls down).'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: true,
  manifest: {
    name: 'computerInteract',
    version: '1.0.0',
    description: 'Dispatch native OS mouse and keyboard events',
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 20000,
    permissions: ['computer'],
    tags: ['computer', 'input', 'interactive', 'mouse', 'keyboard']
  },
  execute: async (args: {
    action: ComputerActionType;
    point?: Point;
    toPoint?: Point;
    button?: MouseButton;
    text?: string;
    key?: string;
    modifiers?: string[];
    scrollDelta?: { x?: number; y?: number };
  }) => {
    try {
      const controller = ComputerController.getInstance();
      const res = await controller.executeAction({
        action: args.action,
        point: args.point,
        toPoint: args.toPoint,
        button: args.button,
        text: args.text,
        key: args.key,
        modifiers: args.modifiers,
        scrollDelta: args.scrollDelta
      });
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, error: `Computer action failed: ${err.message}` };
    }
  }
};

/**
 * Tool: Manage Desktop Windows (P4D)
 */
export const computerManageWindowTool: Tool = {
  definition: {
    name: 'computerManageWindow',
    description: 'Manage desktop application windows (focus, bring to front, or list).',
    capabilities: ['computer'],
    tags: ['computer', 'window', 'focus'],
    parameters: {
      type: 'OBJECT',
      properties: {
        action: {
          type: 'STRING',
          enum: ['focus', 'list'],
          description: 'Window management action.'
        },
        target: {
          type: 'STRING',
          description: 'Window title substring, PID, or handle to focus.'
        }
      },
      required: ['action']
    }
  },
  requiresConfirmation: true,
  manifest: {
    name: 'computerManageWindow',
    version: '1.0.0',
    description: 'Manage desktop windows and application focus',
    riskLevel: 'confirm',
    parallelSafe: false,
    timeoutMs: 15000,
    permissions: ['computer'],
    tags: ['computer', 'window', 'focus']
  },
  execute: async (args: {
    action?: 'focus' | 'list';
    target?: string;
    windowTitle?: string;
    title?: string;
    titlePattern?: string | string[];
    name?: string;
  }) => {
    try {
      const controller = ComputerController.getInstance();
      const action = args.action || 'focus';
      if (action === 'list') {
        const windows = await controller.listWindows();
        return { success: true, windows };
      } else if (action === 'focus') {
        const rawTarget = args.target || args.windowTitle || args.title || args.name || args.titlePattern;
        if (!rawTarget) return { success: false, error: 'target required for focus action' };
        const targetStr = Array.isArray(rawTarget) ? rawTarget[0] : String(rawTarget);
        const focused = await controller.focusWindow(targetStr);
        return { success: focused, target: targetStr };
      }
      return { success: false, error: `Unknown window action: ${action}` };
    } catch (err: any) {
      return { success: false, error: `Window management failed: ${err.message}` };
    }
  }
};
