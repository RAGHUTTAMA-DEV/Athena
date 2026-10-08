import { OSAutomationBackend } from './backend/osAutomationBackend.js';
import { WindowsAutomationBackend } from './backend/windowsAutomationBackend.js';
import { MacOSAutomationBackend } from './backend/macosAutomationBackend.js';
import { LinuxAutomationBackend } from './backend/linuxAutomationBackend.js';
import {
  ScreenDimensions,
  WindowInfo,
  AccessibilityNode,
  ComputerActionOptions,
  ComputerPermissionScope,
  ComputerAuditRecord
} from './computerTypes.js';

export class ComputerController {
  private static instance: ComputerController;
  private backend: OSAutomationBackend;
  private permissionScope: ComputerPermissionScope = { enforceScope: false };
  private auditLogs: ComputerAuditRecord[] = [];

  constructor(customBackend?: OSAutomationBackend) {
    if (customBackend) {
      this.backend = customBackend;
    } else {
      switch (process.platform) {
        case 'win32':
          this.backend = new WindowsAutomationBackend();
          break;
        case 'darwin':
          this.backend = new MacOSAutomationBackend();
          break;
        case 'linux':
          this.backend = new LinuxAutomationBackend();
          break;
        default:
          this.backend = new WindowsAutomationBackend();
      }
    }
  }

  static getInstance(): ComputerController {
    if (!ComputerController.instance) {
      ComputerController.instance = new ComputerController();
    }
    return ComputerController.instance;
  }

  getBackend(): OSAutomationBackend {
    return this.backend;
  }

  setBackend(backend: OSAutomationBackend): void {
    this.backend = backend;
  }

  setPermissionScope(scope: ComputerPermissionScope): void {
    this.permissionScope = { ...scope };
  }

  getPermissionScope(): ComputerPermissionScope {
    return { ...this.permissionScope };
  }

  getAuditLogs(): ComputerAuditRecord[] {
    return [...this.auditLogs];
  }

  clearAuditLogs(): void {
    this.auditLogs = [];
  }

  /**
   * Validates whether interacting with a given window or process is allowed
   * by the active permission scope.
   */
  checkPermission(targetWindow?: string, processName?: string): { allowed: boolean; reason?: string } {
    if (!this.permissionScope.enforceScope) {
      return { allowed: true };
    }

    // Check allowed windows
    if (this.permissionScope.allowedWindowPatterns && targetWindow) {
      const match = this.permissionScope.allowedWindowPatterns.some(pattern => {
        try {
          return new RegExp(pattern, 'i').test(targetWindow);
        } catch {
          return targetWindow.toLowerCase().includes(pattern.toLowerCase());
        }
      });
      if (!match) {
        return {
          allowed: false,
          reason: `Window "${targetWindow}" is not in the allowed window patterns.`
        };
      }
    }

    // Check allowed processes
    if (this.permissionScope.allowedProcesses && processName) {
      const match = this.permissionScope.allowedProcesses.some(
        proc => proc.toLowerCase() === processName.toLowerCase()
      );
      if (!match) {
        return {
          allowed: false,
          reason: `Process "${processName}" is not in the allowed processes list.`
        };
      }
    }

    return { allowed: true };
  }

  private recordAudit(
    action: string,
    details: Record<string, any>,
    permitted: boolean,
    targetWindow?: string,
    processName?: string,
    reason?: string
  ): void {
    const record: ComputerAuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      action,
      details,
      permitted,
      targetWindow,
      processName,
      reason
    };
    this.auditLogs.push(record);
  }

  async inspectScreen(): Promise<{
    dimensions: ScreenDimensions;
    screenshotPath?: string;
    activeWindow?: WindowInfo | null;
  }> {
    if (!this.backend.isSupported()) {
      throw new Error(`Computer Use is unsupported: ${this.backend.getUnsupportedReason()}`);
    }

    const dimensions = await this.backend.getScreenDimensions();
    const screenshot = await this.backend.captureScreen().catch(() => undefined);
    const activeWindow = await this.backend.getActiveWindow().catch(() => null);

    this.recordAudit('inspectScreen', { dimensions }, true, activeWindow?.title, activeWindow?.processName);

    return {
      dimensions,
      screenshotPath: screenshot?.savedPath,
      activeWindow
    };
  }

  async listWindows(): Promise<WindowInfo[]> {
    if (!this.backend.isSupported()) {
      throw new Error(`Computer Use is unsupported: ${this.backend.getUnsupportedReason()}`);
    }
    const windows = await this.backend.listWindows();
    this.recordAudit('listWindows', { count: windows.length }, true);
    return windows;
  }

  async focusWindow(windowIdOrTitle: string): Promise<boolean> {
    if (!this.backend.isSupported()) {
      throw new Error(`Computer Use is unsupported: ${this.backend.getUnsupportedReason()}`);
    }

    // Permission check
    const perm = this.checkPermission(windowIdOrTitle);
    if (!perm.allowed) {
      this.recordAudit('focusWindow', { target: windowIdOrTitle }, false, windowIdOrTitle, undefined, perm.reason);
      throw new Error(`Permission Denied: ${perm.reason}`);
    }

    const focused = await this.backend.focusWindow(windowIdOrTitle);
    this.recordAudit('focusWindow', { target: windowIdOrTitle, focused }, true, windowIdOrTitle);
    return focused;
  }

  async getAccessibilityTree(options?: {
    windowTitle?: string;
    windowHandle?: number;
    maxDepth?: number;
  }): Promise<AccessibilityNode> {
    if (!this.backend.isSupported()) {
      throw new Error(`Computer Use is unsupported: ${this.backend.getUnsupportedReason()}`);
    }

    if (options?.windowTitle) {
      const perm = this.checkPermission(options.windowTitle);
      if (!perm.allowed) {
        this.recordAudit('getAccessibilityTree', options, false, options.windowTitle, undefined, perm.reason);
        throw new Error(`Permission Denied: ${perm.reason}`);
      }
    }

    const tree = await this.backend.getAccessibilityTree(options);
    this.recordAudit('getAccessibilityTree', options || {}, true, options?.windowTitle);
    return tree;
  }

  async executeAction(options: ComputerActionOptions): Promise<{ success: boolean; message: string }> {
    if (!this.backend.isSupported()) {
      throw new Error(`Computer Use is unsupported: ${this.backend.getUnsupportedReason()}`);
    }

    // Check currently active window for permission containment
    const active = await this.backend.getActiveWindow().catch(() => null);
    if (active) {
      const perm = this.checkPermission(active.title, active.processName);
      if (!perm.allowed) {
        this.recordAudit('executeAction', options, false, active.title, active.processName, perm.reason);
        throw new Error(`Permission Denied: Target application "${active.title}" (${active.processName}) is not authorized.`);
      }
    }

    switch (options.action) {
      case 'mouseMove':
        if (!options.point) throw new Error('point {x, y} required for mouseMove');
        await this.backend.mouseMove(options.point.x, options.point.y);
        break;

      case 'click':
        if (options.point) {
          await this.backend.mouseMove(options.point.x, options.point.y);
        }
        await this.backend.mouseClick(options.button || 'left', 1);
        break;

      case 'doubleClick':
        if (options.point) {
          await this.backend.mouseMove(options.point.x, options.point.y);
        }
        await this.backend.mouseClick(options.button || 'left', 2);
        break;

      case 'rightClick':
        if (options.point) {
          await this.backend.mouseMove(options.point.x, options.point.y);
        }
        await this.backend.mouseClick('right', 1);
        break;

      case 'mouseDrag':
        if (!options.point || !options.toPoint) {
          throw new Error('point and toPoint required for mouseDrag');
        }
        await this.backend.mouseDrag(options.point, options.toPoint);
        break;

      case 'scroll':
        await this.backend.mouseScroll(options.scrollDelta?.x || 0, options.scrollDelta?.y || 120);
        break;

      case 'type':
        if (!options.text) throw new Error('text required for type action');
        await this.backend.keyboardType(options.text);
        break;

      case 'pressKey':
        if (!options.key) throw new Error('key required for pressKey action');
        await this.backend.keyboardPress(options.key, options.modifiers || []);
        break;

      default:
        throw new Error(`Unsupported computer action: ${(options as any).action}`);
    }

    this.recordAudit('executeAction', options, true, active?.title, active?.processName);

    return {
      success: true,
      message: `Executed computer action: ${options.action}`
    };
  }
}
