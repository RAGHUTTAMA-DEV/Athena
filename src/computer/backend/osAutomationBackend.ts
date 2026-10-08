import {
  ScreenDimensions,
  ScreenRect,
  WindowInfo,
  AccessibilityNode,
  Point,
  MouseButton
} from '../computerTypes.js';

export interface OSAutomationBackend {
  /** The platform identifier: 'win32' | 'darwin' | 'linux' */
  getPlatform(): 'win32' | 'darwin' | 'linux';

  /** Whether this backend is supported and operational on the current system */
  isSupported(): boolean;

  /** If unsupported, the honest reason why */
  getUnsupportedReason(): string | undefined;

  /** Get primary display dimensions */
  getScreenDimensions(): Promise<ScreenDimensions>;

  /** Capture a screenshot of the display or specific rectangle */
  captureScreen(options?: { bounds?: ScreenRect; destinationPath?: string }): Promise<{
    savedPath: string;
    width: number;
    height: number;
  }>;

  /** Enumerate visible top-level desktop application windows */
  listWindows(): Promise<WindowInfo[]>;

  /** Get the currently focused foreground window */
  getActiveWindow(): Promise<WindowInfo | null>;

  /** Focus / bring to front a specific window by handle, PID, or title */
  focusWindow(windowIdOrTitle: string): Promise<boolean>;

  /** Inspect the UI Automation / Accessibility tree of a target window or desktop */
  getAccessibilityTree(options?: {
    windowTitle?: string;
    windowHandle?: number;
    maxDepth?: number;
  }): Promise<AccessibilityNode>;

  /** Mouse input */
  mouseMove(x: number, y: number): Promise<void>;
  mouseClick(button?: MouseButton, count?: number): Promise<void>;
  mouseDrag(from: Point, to: Point): Promise<void>;
  mouseScroll(deltaX: number, deltaY: number): Promise<void>;

  /** Keyboard input */
  keyboardType(text: string): Promise<void>;
  keyboardPress(key: string, modifiers?: string[]): Promise<void>;
}
