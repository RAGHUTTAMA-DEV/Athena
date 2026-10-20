# Athena V2 Frontend Design Brief

**Status:** Proposed design direction; review before visual implementation.  
**Target branch:** `athena-v2`  
**Purpose:** Establish Athena's visual identity, interaction philosophy, information architecture, and first implementation slice before building individual pages.

## 1. Product framing

Athena V2 should feel like a local-first AI workspace and autonomous-agent control center—not a chatbot with extra dashboard cards. The user needs to set goals, launch and supervise work, see what agents are doing, handle approvals, inspect results, and understand when the system is waiting or blocked.

The V2 backend exposes a broad capability set: goals/tasks, a richer run lifecycle, approvals, artifacts, research and documents, browser/computer use, multi-agent execution, skills/workflows/routines, proactive events, tools/MCP, intelligence/model routing, and reliability/health. The UI should present these capabilities as coherent user workflows rather than mirror every backend module in navigation.

Design principles:
- Calm, precise, premium, and desktop-first.
- Clear outcomes before low-level telemetry.
- Runtime truth, never fake progress or invented capability.
- Progressive disclosure: summary first, inspection on demand.
- Human control where actions are risky or consequential.
- Keyboard-first and accessible.
- Local-first trust boundaries: browser code cannot bypass backend policy or access provider credentials directly.

## 2. Visual direction: “Athena / Obsidian”

**Recommendation:** restrained graphite dark UI with editorial clarity. It should feel like serious local software, not a neon sci-fi dashboard.

Proposed starter tokens (not current repo values; adjust after prototype review):
- Canvas: `#111318`
- Main surface: `#191C23`
- Elevated surface: `#20242C`
- Border / separators: `#292D37`
- Primary text: `#F4F5F8`
- Secondary text: `#9CA3AF`
- Muted indigo focus/accent: `#A5B4FC`
- Success: restrained green
- Waiting / warning: amber
- Failure / destructive: red

Typography and density:
- One UI sans family (Inter or Geist Sans) after confirming the frontend's font setup.
- Monospace only for code, paths, commands, run IDs and technical values.
- Prefer readable 14–16 px body text, short labels, clear heading hierarchy, and aligned numerics.
- Use a 4 px spacing scale; typically 8–12 px corner radius; thin separators and minimal shadows.
- One consistent line-icon family. Keep labels on main navigation; use tooltips for icon-only controls.
- Dark mode first. Build around tokens so light mode can be added later without redesigning each component.

Avoid: excessive glow, glassmorphism everywhere, giant KPI cards, meaningless charts, bright gradients on every surface, and persistent animations that compete with task content.

## 3. Application shell

Desktop layout:
1. Persistent, collapsible left sidebar.
2. Central working area with a compact page header.
3. Optional contextual right inspector for the selected goal, task, run, agent, tool call, artifact or browser/computer session.
4. Global search / command palette and a small activity/approval indicator in the header.

The inspector should open without losing the current page or scroll position. Keep the central column comfortable for writing and reading; use denser layouts only for run/event tables.

## 4. Information architecture

Recommended navigation groups:

### Work
- **Home / Workspace** — create a goal or task, continue a session, see active work and items needing attention.
- **Goals & Tasks** — goal hierarchy, progress, task dependencies, deadlines, budgets and associated runs.
- **Activity** — runs and sessions, filters, lifecycle timeline, live activity, failure/resume/cancel, replay and artifacts.

### Supervision
- **Approvals** — pending human decisions and the exact action/effect requiring approval. Show a badge only when there are pending items.
- **Automations** — schedules, routines, learned workflows, proactive events, heartbeat results and webhook history/retries.

### Knowledge & agents
- **Knowledge** — universal search, research results/citations, indexed documents, artifacts and scoped memory. Use tabs or sub-navigation; avoid making every data type a separate permanent destination.
- **Agent Studio** — agents/profiles and teams, delegated work, skills, learned workflows and review/activation lifecycle.

### System
- **Tools & Connections** — searchable tool catalog, MCP servers, connection state, capability availability and permissions.
- **System Settings** — model/provider routing, system capabilities, reliability/safety status, workspace settings and preferences.

Browser and computer use should appear contextually inside the goal/run/agent workflow, with an optional environment inspector when the user needs direct access. Do not create a permanent top-level item for every runtime module by default.

## 5. First screens to design

Build and review these four related screens before expanding navigation:

1. **Workspace / Home:** a strong task-entry composer, recent sessions, active goals/runs, pending approvals and a small “needs attention” area. Keep summaries useful and avoid arbitrary KPI grids.
2. **Goal detail:** goal outcome, status, progress derived from actual tasks, child tasks/dependencies, budgets, runs, blockers and artifacts.
3. **Run inspector:** status timeline, plan/tasks, delegated-agent tree, tool calls/results, artifacts and verification outcome. Use tabs or a segmented view if content becomes too dense.
4. **Approval center:** clear action summary, target, requested permissions, why confirmation is needed, consequences and explicit approve/reject actions.

This vertical slice exercises the product's core identity: goal → tasks → runs → events → approval/result. Use realistic queued, waiting-for-user, approval-required, failed, and completed scenarios in the prototype.

## 6. Runtime states and micro-interactions

V2's documented run lifecycle includes:
`created`, `queued`, `planning`, `running`, `waiting`, `blocked`, `approval_required`, `verifying`, `reviewing`, `repairing`, `completed`, `failed`, and `cancelled`.

Map UI labels and transitions to actual backend enums/contracts rather than collapsing distinct states:
- `waiting`: explain what the run is waiting for (event, user reply or deadline) when the API has that detail.
- `blocked`: state the blocker and the next useful action.
- `approval_required`: surface the pending decision and link to its approval context.
- `verifying` / `reviewing` / `repairing`: show meaningful stage labels and event activity, not a fabricated percentage.

Micro-interactions to design:
- A subtle, accessible status transition when live events arrive.
- Expandable plan/task tree and nested delegated-agent tree.
- Tool-call disclosure with status, duration, safe input/output preview and redaction.
- Approval card with explicit, deliberate approve/reject actions.
- Cancel/resume controls with confirmation and clear pending/error feedback.
- Inspector open/close without losing selection.
- Command palette with keyboard navigation and discoverable shortcuts.
- Toasts for transient success; persistent banners for connection failures, stale data or blocking issues.
- Explicit loading, empty, error, disabled, offline/reconnecting and unsupported-capability states.
- Respect reduced-motion preferences; never rely on color or animation alone to communicate status.

## 7. API and frontend boundary

The `athena-v2` branch already contains an Express API, OpenAPI specification and SSE manager. The modular route modules include sessions, runs, approvals, artifacts, goals, coding harness, computer use, browser, research, multi-agent, learning, communication, proactive events, reliability, tools/MCP, intelligence/models and system health.

Important existing entry points include:
- Session dispatch/state/events: `/api/v1/sessions` and `/api/v1/sessions/:sessionId/...`
- Run detail/abort/events/replay: `/api/v1/runs/:runId`
- Pending approval list and decision: `/api/v1/approvals/...`
- Goal and task access: `/api/v1/goals/...`
- Artifacts, research, agents, learning, proactive events, tools and health via their modular API routes.

Use the branch's OpenAPI contract and controller implementations as the source of truth for exact shapes and supported operations. Do not invent API fields/endpoints. Do an endpoint audit against the first four screens before wiring UI actions.

Streaming:
- Use the existing session/run SSE endpoints where appropriate.
- Handle reconnects and `Last-Event-ID` / event replay according to actual implementation; reconcile with authoritative current run/session state after connection recovery.
- Include a connection state indicator but avoid alarming users for brief reconnects.
- Treat an SSE event as an update signal; hydrate canonical data where necessary instead of relying indefinitely on a local event-derived copy.

Security:
- Respect the backend's `Authorization: Bearer` / `x-api-key` and workspace context contract.
- Never bundle an API key into static frontend assets or log credentials.
- Keep policy enforcement, machine execution, secrets, and database access on the trusted runtime side.
- Keep approval decisions auditable and visually separate from ordinary navigation/actions.

## 8. Frontend structure recommendation

The current repo has a TypeScript/Express backend and no established React/Vite page app in the root. Keep the frontend in a dedicated `frontend/` workspace or package, separate from backend `src/` and backend TypeScript build configuration.

A sensible initial setup is React + TypeScript + Vite, with:
- Design tokens as CSS variables.
- Reusable primitives and domain components separated from pages.
- A typed API client generated from or checked against the existing OpenAPI document where practical.
- A query/cache layer for canonical REST state and a small event-stream layer for live updates.
- Route-level page modules, not a single oversized component.
- Dev-server proxying to the local Athena API; production serving/package decisions made after the local workflow is validated.

Do not add frontend dependencies to the backend runtime unless the build/deployment plan actually requires it.

## 9. Suggested component inventory

**Shell:** AppShell, Sidebar, PageHeader, CommandPalette, ContextInspector, ConnectionStatus.  
**Primitives:** Button, IconButton, TextField, TextArea, Select, Tabs, Menu, Tooltip, Dialog, ConfirmDialog, Toast, Banner, StatusBadge, Skeleton, EmptyState, ErrorState.  
**Work:** GoalComposer, GoalTree, TaskList, TaskDependencyView, SessionList, RunList, RunStatusTimeline, PlanTree, AgentTree, ToolCallDetail, ApprovalCard, ArtifactList, ReplayTimeline.  
**Knowledge:** GlobalSearch, ResearchResult, CitationList, DocumentCard, MemoryInspector.  
**Automation/agents:** RoutineList, EventFeed, AgentProfileCard, TeamView, SkillReviewCard.  
**System:** ToolCatalog, MCPServerCard, CapabilityStatus, ModelRoutingPanel, HealthPanel.

Use design tokens throughout. Domain components should not embed route navigation logic or hard-code transport assumptions.

## 10. Implementation sequence

1. Approve or revise the visual direction and token palette.
2. Create a small moodboard and a static Workspace/AppShell mockup.
3. Build primitives and all common component states.
4. Implement the shell and responsive sidebar/context inspector.
5. Build Workspace → Goal detail → Run inspector → Approvals as a working vertical slice against the current API.
6. Validate SSE behavior, cancellation, waiting, approval decisions, event replay and reconnect recovery.
7. Add Knowledge, Agent Studio and Automations.
8. Add Tools & Connections, health/reliability, settings and polish.
9. Verify keyboard navigation, contrast, reduced motion, small-window layout and state coverage.

## 11. Acceptance criteria for the visual foundation

Before building out all pages, review and approve:
- The selected visual personality, palette, typography, spacing and density.
- App shell proportions and behavior when the inspector is open/closed.
- Buttons, fields, menus, dialogs, status styles and approval treatment.
- Workspace mockups for active, waiting, approval-required, failed and completed runs.
- The proposed navigation grouping and names.
- The API/event contract for the first vertical slice.
