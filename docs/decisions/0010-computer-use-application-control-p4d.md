# ADR-0010: Computer Use and Application Control (P4D)

- Status: Accepted
- Date: 2026-10-08
- Phase: V2 P4D (Computer Use and Application Control — spec sections 18, 22)

## Context

Athena V1 and sub-phases P4A–P4C operated strictly within sandboxes, shells, and web browsers. To achieve true general-purpose autonomy (Spec Sections 18, 22), Athena requires the ability to observe and operate real desktop operating systems:
1. Screen inspection and desktop capture.
2. OS-level accessibility tree navigation (UI Automation / Accessibility APIs).
3. Window enumeration, discovery, and window focus management.
4. Native mouse and keyboard input injection.
5. Strict permission scoping (restricting actions to allowed application windows/processes).
6. Immutable audit logging of all desktop actions.
7. **Hard rule (Spec Section 71)**: No simulated or faked capabilities with screenshots + text hallucination. Unsupported operating systems must be reported as `unsupported` in the `CapabilityRegistry` with explicit reasons.

## Decision

1. **`OSAutomationBackend` Interface** (`src/computer/backend/osAutomationBackend.ts`):
   - Contract for platform automation: `getScreenDimensions()`, `captureScreen()`, `listWindows()`, `getActiveWindow()`, `focusWindow()`, `getAccessibilityTree()`, `mouseMove()`, `mouseClick()`, `mouseDrag()`, `mouseScroll()`, `keyboardType()`, `keyboardPress()`.

2. **Native Platform Backends**:
   - **`WindowsAutomationBackend`** (`src/computer/backend/windowsAutomationBackend.ts`):
     - Uses PowerShell, .NET (`System.Windows.Forms`, `System.Drawing`, `System.Windows.Automation`), and Win32 (`user32.dll` APIs: `SetCursorPos`, `mouse_event`, `SetForegroundWindow`, `GetForegroundWindow`, `GetWindowText`).
     - Extracts accessibility nodes via .NET UIAutomationClient (`AutomationElement`).
     - Dispatches mouse and keyboard events via native Windows APIs.
   - **`MacOSAutomationBackend`** (`src/computer/backend/macosAutomationBackend.ts`):
     - Reports `isSupported() === false` on non-Darwin platforms with reason `"macOS Accessibility backend is only supported on macOS (Darwin)."`.
   - **`LinuxAutomationBackend`** (`src/computer/backend/linuxAutomationBackend.ts`):
     - Reports `isSupported() === false` on non-Linux platforms with reason `"Linux AT-SPI backend is only supported on Linux OS."`.

3. **`ComputerController`** (`src/computer/computerController.ts`):
   - Resolves active backend based on `process.platform`.
   - **Permission Boundary**: Enforces `allowedWindowPatterns` and `allowedProcesses`. Destructive or unauthorized application interactions are blocked immediately with `Permission Denied`.
   - **Audit Logger**: Records all inspections, window activations, mouse clicks, and keystrokes with timestamps and permission verdict.

4. **Capability Registry (`seedP4DCapabilities`)** (`src/tools/capabilityRegistry.ts`):
   - Registers 5 capabilities:
     - `computer.windows`: `real` on `win32`, `unsupported` on others.
     - `computer.macos`: `real` on `darwin`, `unsupported` on others.
     - `computer.linux`: `real` on `linux`, `unsupported` on others.
     - `computer.accessibility`: `real` on Windows (UIAutomation).
     - `computer.input`: `real` on Windows (native input).

5. **Tool Suite** (`src/tools/computerTools.ts`):
   - `computerInspect`: screen resolution, desktop capture, active window, window list, accessibility tree.
   - `computerInteract`: mouse and keyboard input events.
   - `computerManageWindow`: window listing and application focus.
   - Manifests with permission `computer`, risk `confirm` for input/window operations, `safe` for inspect.
   - Registered in `SearchableToolRegistry`.

## Consequences

- **Authentic desktop automation**: Screen dimensions, windows, accessibility nodes, and input events run against real OS backends.
- **Honest capability reporting**: No faking with screenshots; non-host operating systems report `unsupported` honestly.
- **Safety**: Permission scoping blocks interactions with unauthorized desktop apps (e.g. banking/finance apps).
- **Auditability**: Complete audit trail preserved for all desktop operations.
- **Zero regressions**: Full V2 (P1, P2, P3, P4A, P4B, P4C) and V1 suites green.
