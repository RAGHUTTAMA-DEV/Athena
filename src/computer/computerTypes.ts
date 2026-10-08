/**
 * Computer Use and Application Control Types (Athena V2 Phase 4D — Spec Sections 18, 22).
 */

export interface Point {
  x: number;
  y: number;
}

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenDimensions {
  width: number;
  height: number;
  scaleFactor?: number;
}

export interface WindowInfo {
  id: string;
  handle: number;
  title: string;
  processName: string;
  processId: number;
  bounds?: ScreenRect;
  isFocused: boolean;
}

export interface AccessibilityNode {
  id?: string;
  name: string;
  role: string;
  className?: string;
  bounds?: ScreenRect;
  isEnabled?: boolean;
  isFocused?: boolean;
  value?: string;
  children?: AccessibilityNode[];
}

export type MouseButton = 'left' | 'right' | 'middle';

export type ComputerActionType =
  | 'click'
  | 'doubleClick'
  | 'rightClick'
  | 'mouseMove'
  | 'mouseDrag'
  | 'scroll'
  | 'type'
  | 'pressKey';

export interface ComputerActionOptions {
  action: ComputerActionType;
  point?: Point;
  toPoint?: Point;
  button?: MouseButton;
  text?: string;
  key?: string;
  modifiers?: string[];
  scrollDelta?: { x?: number; y?: number };
}

export interface ComputerPermissionScope {
  /** If provided, agent may only interact with windows matching these titles (case-insensitive substring or regex pattern) */
  allowedWindowPatterns?: string[];
  /** If provided, agent may only interact with processes matching these names */
  allowedProcesses?: string[];
  /** If true, interactions targeting unlisted apps/windows will be blocked */
  enforceScope?: boolean;
}

export interface ComputerAuditRecord {
  id: string;
  timestamp: number;
  action: string;
  targetWindow?: string;
  processName?: string;
  details: Record<string, any>;
  permitted: boolean;
  reason?: string;
}
