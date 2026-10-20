# Athena Frontend Design Brief — V2

> Status: proposed direction for discussion. This document defines the initial visual and interaction baseline before page-by-page implementation; values may change after a visual prototype review.

## 1. Product framing

Athena is a local-first, desktop-first autonomous agent workspace and control plane, not merely a chat interface. The frontend should let the user assign work, understand real runtime activity, intervene safely, and inspect outcomes. It should feel premium, calm, precise, and native to a developer's machine.

Core principles:
- Clarity over decoration.
- Runtime truth over simulated progress.
- Progressive disclosure: clean summaries first, details on demand.
- Human control for risky or destructive actions.
- Useful density without visual clutter.
- Accessible, keyboard-first interaction.
- The frontend must never bypass runtime policy or expose provider secrets.

## 2. Recommended visual direction

**Working name: Athena / Obsidian**

Combine a restrained graphite interface with the editorial clarity of minimalist productivity software. Avoid generic neon AI-dashboard styling, excessive glassmorphism, oversaturated gradients, decorative charts, and giant KPI cards without a decision-making purpose.

Proposed initial tokens (not existing repository values; validate in prototype):
- Canvas: `#111318`
- Primary surface: `#191C23`
- Elevated surface: `#20242C`
- Border: `#292D37`
- Primary text: `#F4F5F8`
- Secondary text: `#9CA3AF`
- Accent / focus: `#A5B4FC`
- Success: muted green
- Warning: amber
- Failure / destructive: red

Typography:
- Inter or Geist Sans for interface text; choose one after checking available project setup/licensing.
- Monospace only for commands, paths, identifiers, code, and technical metadata.
- Use clear hierarchy, comfortable line-height, consistent numeric alignment, and avoid oversized headings on dense screens.

Shape and spacing:
- 4 px base spacing scale.
- Generally 8–12 px radius for controls and panels.
- Thin separators and restrained shadows.
- Consistent icon family (Lucide-style line icons) and accessible labels/tooltips for icon-only controls.
- Dark mode first; do not build a second theme until the core token system is stable.

## 3. App shell

Recommended desktop layout:
1. Persistent left navigation rail/sidebar.
2. Central content/work area.
3. Optional contextual right panel for run/agent/tool details.
4. Compact global header for current context, search/command palette, and relevant activity/approval indicators.

Proposed primary navigation:
- Workspace — task entry, conversational work, session context.
- Runs — active and historical executions, statuses, failures, resume/cancel.
- Schedules — scheduled work, triggers, history/outcomes.
- Memory — scoped memory inspection, provenance, lifecycle and safe controls.
- Tools & Connections — built-in tools, MCP integrations, connection/permission health.
- Settings — provider/model config, runtime options, safety and preferences.

Observability and trajectory replay should initially live in run detail / Inspect rather than becoming separate top-level navigation items. Surface approvals and active runs in the global shell with meaningful indicators, not extra permanent navigation sections.

## 4. Interaction principles

- All statuses must reflect actual runtime state/events. Never make up percentages or animate fake progress.
- Show a concise activity summary by default; expand to inspect planning steps, delegated agents, tool calls and verification outcomes.
- Use contextual detail panels for run, agent, tool, artifact and event details to avoid needless navigation.
- Risky actions need explicit approval surfaces that describe the target, effect, and consequence; approve/reject controls must be unambiguous.
- Provide deliberate states for queued, running, waiting-for-approval, verifying, completed, failed, cancelled, and interrupted/resumable runs. Align labels to actual backend enums.
- Handle streaming disconnections, reconnecting, stale data and failed requests explicitly; recover from authoritative runtime state.
- Keyboard-first: command palette, global search, focus management, visible focus rings, and shortcuts with discoverable labels.
- Every major component must support loading, empty, error, disabled, and success states.
- Follow accessibility practices for contrast, keyboard navigation, reduced motion, semantic labels and screen-reader announcements.

## 5. Micro-interactions to validate

1. Live run status transitions and event stream.
2. Expand/collapse plan and delegated-agent tree.
3. Tool-call disclosure with inputs/result/status/duration and safely redacted content.
4. Approval dialog for sensitive actions.
5. Run cancel/resume controls with clear pending/confirmed/error feedback.
6. Command palette with keyboard navigation.
7. Context side-panel open/close and retained selection.
8. Toasts for transient outcomes; persistent banners for blocking errors.
9. Reduced-motion behavior and non-color-only status communication.

Use motion sparingly (typically short transitions) and never let animations obscure status changes, keyboard focus or content.

## 6. Page sequence

Implement in this order:
1. Design tokens and primitive components.
2. App shell and responsive behavior.
3. Workspace — composer, conversation, context selection, active-run summary and detail panel.
4. Runs list and run detail / Inspect-Replay.
5. Schedules and job detail.
6. Memory search/detail and safe edit/delete flows.
7. Tools & Connections.
8. Settings.
9. Cross-cutting approvals, notifications, keyboard navigation, accessibility and responsive polish.

The Workspace is the vertical slice that validates the design system and live runtime contract before adding breadth.

## 7. Suggested component inventory

- AppShell, Sidebar, PageHeader, Breadcrumbs, CommandPalette
- Button, IconButton, TextField, TextArea, Select, Tabs, Menu
- Badge/StatusIndicator, Tooltip, Dialog/ConfirmDialog, Toast, Banner
- EmptyState, Skeleton, ErrorState, ConnectionIndicator
- RunComposer, ConversationThread, RunStatusTimeline, PlanTree
- AgentTree, ToolCallRow/Detail, ApprovalCard, ArtifactList
- RunList, RunFilters, RunDetailPanel, EventTimeline
- ScheduleList, ScheduleEditor, MemoryTable/Inspector, MCPConnectionCard

Primitives must be reusable and token-driven. Domain components should not directly contain page-level navigation or transport assumptions.

## 8. Runtime integration boundary

The current repository is primarily a Node/TypeScript agent runtime and CLI. The frontend should communicate through a defined runtime API and typed event stream rather than importing CLI internals or accessing SQLite directly from UI code.

Proposed contracts to map against actual core types:
- create run; list/get run; cancel/resume run
- stream events / reconnect / retrieve events after a cursor
- retrieve trajectory and artifacts
- list/manage schedules
- search/inspect/update memory
- list tool/MCP connection status and safely update supported settings
- approve/reject gated actions where the runtime policy supports it

These are proposed boundaries, not a claim that all endpoints already exist. Reuse existing runtime types and event names where possible. Keep execution, policy enforcement, credentials, database access and privileged machine operations on the trusted local runtime side.

## 9. Implementation guardrails

- Do not redesign the agent core to fit a UI abstraction.
- Do not implement every page before testing the design tokens and Workspace vertical slice.
- Do not invent fields/statuses that are not present in runtime contracts.
- Do not expose raw secrets or internal sensitive reasoning.
- Prefer observable action traces, concise explanations, tool status/results, and verification summaries.
- Keep navigation small. Deep technical inspection should be contextual.
- Verify on desktop first, while ensuring smaller windows still work via collapse/reflow rather than horizontal overflow.

## 10. Exit criteria for visual foundation

Before page implementation expands, the design review should approve:
- Selected direction and palette.
- Type and spacing scales.
- Button, input, menu, modal and status treatments.
- Sidebar, header, central work area and contextual panel.
- Hover, focus, active, disabled, loading, empty and error states.
- Workspace mockup with a realistic active run, approval-needed run, and completed run.
- Agreed API/event contract for the first Workspace vertical slice.
