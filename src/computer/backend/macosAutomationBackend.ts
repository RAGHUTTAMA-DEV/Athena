import { OSAutomationBackend } from './osAutomationBackend.js';
import {
  ScreenDimensions,
  ScreenRect,
  WindowInfo,
  AccessibilityNode,
  Point,
  MouseButton
} from '../computerTypes.js';

export class MacOSAutomationBackend implements OSAutomationBackend {
  getPlatform(): 'win32' | 'darwin' | 'linux' {
    return 'darwin';
  }

  isSupported(): boolean {
    return process.platform === 'darwin';
  }

  getUnsupportedReason(): string | undefined {
    return process.platform === 'darwin'
      ? undefined
      : 'macOS Accessibility & Quartz automation backend is only supported on macOS (Darwin).';
  }

  async getScreenDimensions(): Promise<ScreenDimensions> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
    return { width: 1920, height: 1080 };
  }

  async captureScreen(): Promise<{ savedPath: string; width: number; height: number }> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
    throw new Error('Not implemented on non-darwin host');
  }

  async listWindows(): Promise<WindowInfo[]> {
    if (!this.isSupported()) return [];
    return [];
  }

  async getActiveWindow(): Promise<WindowInfo | null> {
    if (!this.isSupported()) return null;
    return null;
  }

  async focusWindow(): Promise<boolean> {
    if (!this.isSupported()) return false;
    return false;
  }

  async getAccessibilityTree(): Promise<AccessibilityNode> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
    return { name: 'Root', role: 'AXApplication', children: [] };
  }

  async mouseMove(): Promise<void> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
  }

  async mouseClick(): Promise<void> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
  }

  async mouseDrag(): Promise<void> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
  }

  async mouseScroll(): Promise<void> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
  }

  async keyboardType(): Promise<void> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
  }

  async keyboardPress(): Promise<void> {
    if (!this.isSupported()) throw new Error(this.getUnsupportedReason());
  }
}
