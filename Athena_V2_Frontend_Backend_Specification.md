# Athena V2 — Product, Frontend & Backend Architecture Specification

> **Repository:** [`RAGHUTTAMA-DEV/Athena`](https://github.com/RAGHUTTAMA-DEV/Athena)  
> **Reviewed branch:** `athena-v2` (not `main`)  
> **Reviewed branch head:** `a76a2daaf721df683c53f385757117432a8d9100`  
> **Review date:** 11 November 2026  
> **Purpose:** A practical source of truth for building the Athena V2 desktop-first web workspace, its visual system, page structure, and its integration with the existing backend.

---

## 1. Executive summary

Athena V2 is a **local-first, persistent, general-purpose autonomous agent platform**. It should not be presented as a chatbot with a collection of dashboard cards. The product is a workspace/control centre where a person can:

- Define outcomes as goals and let Athena decompose them into tasks.
- Start, supervise, pause, resume, cancel, and inspect agent runs.
- See live progress, tool activity, delegated agents, verification, and artifacts.
- Approve consequential actions with clear context and an auditable decision.
- Search research, documents, artifacts, and scoped memory.
- Manage specialist agents, skills, learned workflows, and routines.
- Inspect browser/computer environments when relevant to a run.
- Configure tools, MCP connections, model routing, workspace settings, and system safety.
- Understand when Athena is active, waiting, blocked, reconnecting, or finished.

**Critical repository finding:** the reviewed `athena-v2` branch contains the TypeScript agent runtime, an Express REST/SSE platform, OpenAPI documentation, storage adapters, API client code, and a frontend design brief. It does **not** contain an established React/Vite frontend application or implemented page components. The UI described in this document is therefore the implementation blueprint for a separate frontend package, not a claim that those pages already exist.

The frontend must remain independent of the core runtime. It communicates through the versioned API and event stream; it must never import internal agent modules, open the database directly, execute tools itself, or contain provider credentials.

## 2. Repository review and source-of-truth boundaries

### 2.1 Branch and project state

- Repository: `RAGHUTTAMA-DEV/Athena`
- Branch reviewed: `athena-v2`
- Branch head at review: `a76a2daaf721df683c53f385757117432a8d9100`
- Latest branch commit message: `docs: add V2 frontend design brief`
- Default repository branch remains `main`; this specification is based on the explicitly requested `athena-v2` branch.

### 2.2 What exists in the branch

Important repository areas include:

| Area | Existing implementation |
|---|---|
| `src/core/` | Agent identity, orchestration, goals/tasks/runs, memory/context, policy, learning, delegation, proactive runtime and core services |
| `src/tools/` | Tool registry/runtime and tools for filesystem, terminal, browser, computer use, research, documents, communication, scheduling, memory and delegation |
| `src/api/server.ts` | Express API application, middleware, service wiring and modular route registration |
| `src/api/routes/` | Domain route modules for sessions, runs, approvals, artifacts, goals, harness, computer, browser, research, multi-agent, learning, communication, proactive, reliability, tools, intelligence and system |
| `src/api/controllers/` | HTTP controllers for those domains |
| `src/api/services/` | Dispatch, hydration, approval and artifact application services |
| `src/api/events/` | Typed event envelope and SSE manager |
| `src/api/openApiSpec.ts` | OpenAPI 3.1 document and Swagger UI HTML |
| `src/api/client/athenaClient.ts` | Typed TypeScript API client |
| `src/storage/stores/` | Storage interfaces and SQLite implementations |
| `src/storage/postgres/` | PostgreSQL database, migrations and store adapters |
| `src/tests/` | Phase tests, API/platform tests, reliability tests and evaluation suites |
| `docs/decisions/` | Architecture decision records |
| `docs/frontend-design-brief-v2.md` | Proposed visual direction, information architecture, first screens and frontend boundary |
| `IMPLEMENTATION_STATUS.md` | Phase-by-phase implementation status |
| `docs/architecture/athena_v2_build_plan.md` | V2 phase build plan |
| `docs/architecture/athena_v2_theory.md` | Product theory and V1-to-V2 conceptual shift |

### 2.3 Current implementation status

The branch's implementation status document reports:

- V2 P1–P12 complete.
- P13 Hardening not started and awaiting written approval.
- The listed P1–P12 phase test suites are reported green.
- P12 includes the Express REST/SSE platform, OpenAPI/Swagger, durable message dispatch, session hydration, approvals, artifacts, PostgreSQL adapter, typed client SDK and UI-independence check.

This is the repository's documented status, not an independent execution of every test during this design review.

### 2.4 What is not implemented yet

No frontend application/package or actual page components were found in the reviewed branch tree. In particular, do not assume the following already exist:

- React/Vite app shell
- Sidebar/navigation components
- Workspace/home page
- Goal/task pages
- Run inspector UI
- Approval centre UI
- Knowledge or Agent Studio UI
- Design tokens/CSS theme
- Frontend routing, query cache, SSE client lifecycle, or frontend state management

The branch does contain the backend APIs needed to build the first product workflows. The frontend design brief is explicitly marked as a proposed design direction.

---

## 3. Product identity and interaction philosophy

### 3.1 Product framing

Athena is a **local-first AI workspace and autonomous-agent control centre**. Software engineering and coding are strong capabilities, but they are not the entire identity of the product.

The central mental model is:

```text
User intent
    |
    v
Persistent Athena identity
    |
    v
Goal
    |
    +----> Tasks
              |
              +----> Runs
                         |
                         +----> Tools / Browser / Computer / Specialist agents
                         |
                         +----> Events / Waits / Approvals
                         |
                         +----> Verification / Repair
                                      |
                                      v
                              Result + Artifacts
                                      |
                                      v
                              Learn / Continue / Wait
```

A **goal** describes the outcome Athena is responsible for. A **task** is a unit of work within that goal. A **run** is one execution attempt. A **skill** is procedural knowledge. A **routine** describes when/how a workflow should run. These concepts must remain distinct in both the UI and API client.

### 3.2 Design principles

1. **Outcome before telemetry.** Show what Athena is doing and what it needs before exposing low-level traces.
2. **Runtime truth.** Every status, progress indicator, timestamp and activity item must come from real backend state/events. Never fabricate progress or pretend an unsupported capability is available.
3. **Progressive disclosure.** Keep the default view calm; reveal tool inputs/outputs, traces, event payloads and technical metadata on demand.
4. **Human control.** Risky or consequential actions must have a deliberate approval experience.
5. **Persistent work.** A user should be able to leave and return without losing goals, tasks, runs, decisions or artifacts.
6. **Local-first trust.** The browser UI is an API client, not a privileged runtime. The backend owns credentials, policy, filesystem access, machine execution and database access.
7. **Keyboard-first and accessible.** Use semantic controls, visible focus, keyboard navigation and reduced-motion support.
8. **Desktop-first, responsive.** Optimize the three-column workspace for desktop, but preserve essential workflows on smaller screens.

### 3.3 Three-zone composition

The supplied screenshot establishes the intended overall composition:

- **Left zone:** persistent navigation and workspace selection.
- **Centre zone:** the current working surface—conversation, goal, task or run.
- **Right zone:** contextual inspection and supervision, opened for the selected object without losing the central page or scroll position.

This three-zone layout should be consistent across the application. The right inspector is contextual, not a second permanent navigation menu.

---

## 4. Visual design system — Athena / Obsidian

The screenshot is the primary visual reference. The values below distinguish **sampled screenshot colours** from the original frontend brief's proposed palette. Use the screenshot values as the starting point for the implementation; preserve the design brief's restrained, low-contrast philosophy.

### 4.1 Colour tokens

#### Screenshot-derived graphite palette

The uploaded screenshot's dominant sampled RGB values map approximately to:

| Token | Hex | Usage |
|---|---|---|
| `--athena-canvas` | `#171819` | Main application canvas |
| `--athena-surface` | `#1D1E20` | Sidebar, header, standard panels |
| `--athena-surface-raised` | `#202123` | Composer, cards, selected/raised panels |
| `--athena-surface-deep` | `#191A1C` | Recessed sections and subtle contrast |
| `--athena-border` | `#303234` | Panel outlines and separators |
| `--athena-border-subtle` | `#292B2D` | Hairline dividers |
| `--athena-text` | `#EDEEEF` | Primary text (use sparingly at full strength) |
| `--athena-text-secondary` | `#BFC2C3` | Supporting copy |
| `--athena-text-muted` | `#777D80` | Timestamps, metadata, labels |
| `--athena-accent` | `#A8B6AE` | Restrained sage/grey-green accent |
| `--athena-success` | `#8EAD9A` | Completed/healthy states |
| `--athena-warning` | `#C5A66A` | Waiting, attention and approval-needed states |
| `--athena-danger` | `#C77D7D` | Failure, destructive actions |
| `--athena-info` | `#91A7B7` | Informational states and neutral highlights |

The screenshot is deliberately almost monochrome. Do not turn the interface into a colourful analytics dashboard. Accent colours should be used for meaning, not decoration.

#### Existing design brief palette (alternative proposal)

`docs/frontend-design-brief-v2.md` proposes:
- Canvas `#111318`
- Main surface `#191C23`
- Elevated surface `#20242C`
- Border `#292D37`
- Primary text `#F4F5F8`
- Secondary text `#9CA3AF`
- Muted indigo focus/accent `#A5B4FC`
- Restrained green success, amber warning, red failure

Do not mix the two palettes arbitrarily. The supplied screenshot is the stronger visual reference; use its neutral graphite/sage direction as the default. The indigo accent in the brief is an alternative proposal, not a requirement.

### 4.2 Typography

- Use **Inter** or **Geist Sans** as the primary UI sans family, after confirming the selected font is available/licensed and loaded locally.
- Use a monospace family only for code, file paths, commands, model IDs, run IDs, timestamps where aligned, JSON, logs and technical values.
- Body copy: typically 13–14 px in the dense desktop workspace; use 14–16 px for longer reading surfaces.
- Page title: 20–24 px, semibold.
- Section title: 14–16 px, semibold.
- Navigation labels: 12–13 px.
- Technical eyebrow/metadata labels: 9–10 px, uppercase, letter spacing around 0.06–0.10em.
- Keep line-height comfortable; dense does not mean cramped.
- Use tabular numerals for durations, counters, costs and timestamps.

### 4.3 Spacing, sizing and geometry

- Base spacing unit: **4 px**.
- Common gaps: 4, 8, 12, 16, 20, 24, 32 px.
- Standard border: 1 px.
- Panel radius: 2–4 px for the screenshot's restrained, squared-off feel; use 6–8 px only for larger dialogs or selected controls.
- Avoid large pill-shaped cards everywhere.
- Shadows should be rare and subtle. Prefer surface contrast and thin borders.
- Keep central reading width comfortable; dense tables may use the available width.
- Align labels, timestamps, status markers and numeric values consistently.

### 4.4 Application shell proportions

Suggested desktop starting point (adjust responsively):

- Left sidebar: 180–220 px, collapsible.
- Top header: 44–52 px.
- Main content: flexible, min-width 0.
- Right inspector: 260–340 px when open; overlay/drawer on narrow windows.
- Main content horizontal padding: 24–32 px.
- Composer: anchored at the bottom of the active workspace where the workflow is conversational; it should not obscure scrollable content.

These are implementation starting points, not fixed backend constraints.

### 4.5 Icons and status language

- Use one consistent line-icon family (Lucide-style).
- Main navigation should show icon + text; reserve icon-only buttons for compact actions with tooltips and accessible labels.
- Status must never rely on colour alone. Pair colour with a label and, where useful, a small icon.
- Use restrained dots for connection/health state.
- Avoid emoji as primary navigation iconography.

### 4.6 Motion

- Small transitions only: inspector slide, disclosure expansion, status change, toast entrance.
- Respect `prefers-reduced-motion`.
- Do not animate every agent/tool event with flashing or pulsing effects.
- Live activity should update quietly and preserve scroll position unless the user is already following the bottom.

### 4.7 Light mode

The screenshot includes a theme control. Implement dark mode first, but define semantic CSS tokens so a light theme can be added without changing components. Light mode should preserve the same hierarchy, border subtlety and restrained accent use; do not simply invert every pixel.

---

## 5. Application navigation and page map

Use coherent user workflows, not a one-to-one copy of every backend route. The recommended navigation groups follow the existing frontend design brief.

### 5.1 Primary navigation

#### Work
1. **Workspace / Home**
2. **Goals & Tasks**
3. **Activity**

#### Supervision
4. **Approvals**
5. **Automations**

#### Knowledge & agents
6. **Knowledge**
7. **Agent Studio**

#### System
8. **Tools & Connections**
9. **System Settings**

The active workspace selector sits near the top of the sidebar. The bottom of the sidebar can show the current run/workspace state and local-tools connection status, as in the screenshot.

### 5.2 Workspace / Home

**Purpose:** the starting point for work and the place to see what needs attention.

Recommended layout:
- Page header: `Workspace` plus current workspace/project context.
- Main task/goal composer: ask Athena to do something; support attachments/context references only when the backend supports them.
- Active work section: current goals and runs with real state, short progress summary and next action.
- Recent sessions: resume previous conversations/work.
- Needs attention: pending approvals, blocked runs, clarification requests, failed work requiring review.
- Recent artifacts/results: useful outputs from completed runs.

Avoid arbitrary KPI grids. Show counts only when they answer a real operational question.

**Primary actions:**
- Create/continue a session and submit a message.
- Create a goal where the intent represents a longer-running outcome.
- Open an active run.
- Resume a session.
- Open a pending approval or blocked item.

**States to design:** first-run empty workspace, active work, waiting, blocked, approval required, disconnected/offline, and workspace with no recent sessions.

### 5.3 Goals & Tasks

**Purpose:** manage outcomes and their decomposed work.

Goals list:
- Goal name/outcome.
- Status and priority.
- Progress derived from task state—not a made-up percentage.
- Deadline and budget where available.
- Current blocker/next action.
- Associated project/workspace.

Goal detail:
- Goal description and success criteria.
- Status, priority, deadline and budget.
- Task hierarchy and dependency relationships.
- Active/recent runs for each task.
- Delegated agents where applicable.
- Related artifacts and verification results.
- Pause/resume controls where supported.
- Event/history timeline.

Task detail (drawer or nested detail):
- Parent goal and dependencies.
- Task state, attempt count, result and assigned agent.
- Run history.
- Blockers, approval requirement and artifacts.

Do not confuse tasks with runs. A task can have multiple execution attempts.

### 5.4 Activity

**Purpose:** a searchable operational history of sessions and runs.

List view:
- Search and filters: status, workspace, goal, date, agent, session.
- Run/session identity and user-facing summary.
- Status, start/updated time and duration.
- Parent/child run relationship.
- Outcome or failure summary.

Run inspector:
- Run header with ID, status, goal/task/session association.
- Status timeline: created, queued, planning, running, waiting, blocked, approval required, verifying, reviewing, repairing, completed, failed or cancelled (use actual backend values and mapping).
- Current stage and safe progress summary.
- Plan/task tree.
- Delegated-agent tree and handoffs.
- Tool-call timeline with status, duration and safe input/output preview.
- Approval events.
- Artifacts and links to results.
- Verification outcome and repair attempts.
- Replay/trajectory view.
- Cancel/resume/retry controls only where supported and valid.

Never expose private chain-of-thought. Display concise user-facing progress summaries, observable tool activity, plan steps, and verification evidence—not hidden internal reasoning.

### 5.5 Approvals

**Purpose:** a clear human-in-the-loop decision centre.

List:
- Pending approval requests, grouped by urgency or run.
- Requesting agent/run and creation/expiry time.
- Action category and target.
- State and risk level.

Approval detail:
- Exact proposed action.
- Target resource and workspace.
- Why approval is required.
- Requested permissions and scope.
- Consequences and potential side effects.
- Safe parameters/preview.
- Approve and reject actions, with optional reason if supported.
- Resulting decision status and audit trail.

Approval controls must be deliberate, not tiny icon buttons. Prevent accidental approval with clear button labels and confirmation for high-impact actions. Show stale/expired/resolved states and handle API conflicts.

### 5.6 Automations

**Purpose:** inspect Athena's proactive and scheduled behaviour.

Suggested tabs:
- **Routines:** trigger, conditions, workflow, permissions, enabled state and recent success.
- **Scheduled work:** timers/cron schedules, timezone, next run and last result.
- **Events:** incoming events and event pipeline status.
- **Heartbeats:** inspections, quiet ticks, wake reasons and cost information where exposed.
- **Webhooks:** endpoint metadata, recent receipts, signature/validation state and retries.

Do not imply every automation is a cron job. A routine, learned workflow, goal and run are separate concepts. Do not expose webhook secrets.

### 5.7 Knowledge

**Purpose:** one place to search and inspect what Athena knows and what it has produced.

Use tabs/sub-navigation rather than many permanent sidebar destinations:
- **Search:** universal session/search experience across messages, tool calls/results, plans, decisions, errors and runs.
- **Research:** findings, source/inference/uncertainty labels, citations and research reports.
- **Documents:** indexed PDFs, DOCX, spreadsheets, text and other supported document types; ingestion state and retrieval.
- **Artifacts:** generated files, metadata, versions, diffs and raw download/view.
- **Memory:** scoped facts/preferences/procedures with provenance, confidence, lifecycle and validation/quarantine status.

Memory is not session history:
- Memory is curated knowledge Athena should retain.
- Session history is what actually happened.
- Search both through their appropriate interfaces; do not dump all memory/history into a page or prompt.

### 5.8 Agent Studio

**Purpose:** manage agent identity, specialist profiles, teams and learned capabilities.

Recommended tabs:
- **Agents:** profile, role, capabilities, permissions, model policy and status.
- **Teams:** team composition, specialization rationale and team state.
- **Delegations:** active/recent delegation tree, contracts, allowed tools and handoff status.
- **Skills:** metadata, version, description, invocation/success statistics and review status.
- **Workflows:** learned workflow proposals, steps, conditions, permissions and review/activation.
- **Routines:** optionally deep-link to Automations rather than duplicate routine management.

Make permissions and specialist boundaries visible. For example, a reviewer agent may be read-only; do not present every agent as having identical access.

### 5.9 Tools & Connections

**Purpose:** understand what Athena can access and which integrations are connected.

Sections:
- Tool catalog with search, category, capability, permission, risk and availability.
- MCP servers: configured server, transport, connection/health state and exposed tools.
- Integration/channel status.
- Capability registry: `real`, `experimental`, or `unsupported` with a reason.
- Safe connection management actions supported by the current API.

Never display secret values. Credentials must be write-only/redacted and remain on the backend.

### 5.10 System Settings

**Purpose:** configuration and health, not daily work.

Sections:
- Model/provider configuration and routing tiers.
- Local model/provider availability.
- Token/cost/cache/latency telemetry where exposed.
- Workspace settings and local runtime configuration.
- Policy/safety overview and permission boundaries.
- System capability status.
- Storage mode/health (SQLite default, optional PostgreSQL deployment).
- API connection status and diagnostic information.

Do not put low-level settings on the main Workspace page.

### 5.11 Contextual browser/computer inspector

Browser and computer use should primarily appear inside the selected goal/run/agent context. Provide contextual panels for:
- Browser profile and session.
- Tabs and page snapshot.
- Browser activity and safe page metadata.
- Current screen/window inspection where supported.
- Recent computer-use actions and outcomes.

Do not create permanent top-level navigation for every runtime module unless later user research proves it necessary.

---

## 6. Global interaction patterns and reusable components

### 6.1 Shell components

- `AppShell`
- `WorkspaceSwitcher`
- `Sidebar`
- `NavigationGroup`
- `PageHeader`
- `GlobalSearch`
- `CommandPalette`
- `ContextInspector`
- `ConnectionStatus`
- `ActivityIndicator`
- `ThemeToggle`

### 6.2 Primitives

- `Button`, `IconButton`
- `TextField`, `TextArea`, `Select`
- `Tabs`, `SegmentedControl`
- `Menu`, `Tooltip`
- `Dialog`, `ConfirmDialog`
- `Toast`, `Banner`
- `StatusBadge`, `StatusDot`
- `Skeleton`
- `EmptyState`, `ErrorState`
- `Table`, `FilterBar`
- `CodeBlock`, `JsonViewer`
- `Timeline`, `DisclosurePanel`

### 6.3 Domain components

**Work**
- `GoalComposer`
- `GoalCard`
- `GoalTree`
- `TaskList`
- `TaskDependencyView`
- `SessionList`
- `RunList`
- `RunStatusTimeline`
- `PlanTree`
- `AgentTree`
- `ToolCallRow`
- `ToolCallDetail`
- `ApprovalCard`
- `ArtifactList`
- `ReplayTimeline`

**Knowledge**
- `GlobalSearchResults`
- `ResearchResult`
- `CitationList`
- `DocumentCard`
- `MemoryInspector`
- `ArtifactVersionHistory`
- `ArtifactDiffViewer`

**Automation and agents**
- `RoutineList`
- `ScheduledJobRow`
- `EventFeed`
- `WebhookCard`
- `AgentProfileCard`
- `TeamView`
- `DelegationTree`
- `SkillCard`
- `WorkflowReviewCard`

**System**
- `ToolCatalog`
- `MCPServerCard`
- `CapabilityStatus`
- `ModelRoutingPanel`
- `HealthPanel`
- `TelemetrySummary`

Domain components should receive data and callbacks. They should not embed route navigation, make raw HTTP calls, or know how the backend stores data.

### 6.4 Shared UI states

Every page/component that fetches or mutates data should define:
- Initial loading.
- Refreshing/background revalidation.
- Empty state.
- Error state with retry where safe.
- Offline/disconnected state.
- Reconnecting state for SSE.
- Stale data state where relevant.
- Permission denied.
- Unsupported capability.
- Disabled action with explanation.
- Success/confirmation feedback.

---

## 7. Frontend architecture

### 7.1 Recommended stack

The repository's design brief recommends a separate `frontend/` workspace/package. A suitable initial implementation:

- React
- TypeScript
- Vite
- React Router (or an equivalent route-level router)
- CSS variables/design tokens; CSS Modules or a consistent utility/component styling approach
- A server-state cache such as TanStack Query (or equivalent)
- A small dedicated SSE/event client
- Zod or generated types for client-side contract validation where useful
- A typed API client generated from or checked against the existing OpenAPI contract

This is a frontend recommendation, not an existing dependency in the backend package. Keep frontend dependencies out of the backend runtime package.

### 7.2 Suggested directory structure

```text
Athena/
├── src/                         # Existing backend/core; keep independent
│   ├── core/
│   ├── tools/
│   ├── api/
│   └── storage/
│
├── frontend/                    # New independent UI package
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── app/
│       │   ├── App.tsx
│       │   ├── router.tsx
│       │   └── providers/
│       ├── components/
│       │   ├── primitives/
│       │   ├── shell/
│       │   └── domain/
│       ├── pages/
│       │   ├── workspace/
│       │   ├── goals/
│       │   ├── activity/
│       │   ├── approvals/
│       │   ├── automations/
│       │   ├── knowledge/
│       │   ├── agents/
│       │   ├── tools/
│       │   └── settings/
│       ├── features/
│       │   ├── sessions/
│       │   ├── runs/
│       │   ├── goals/
│       │   ├── approvals/
│       │   ├── artifacts/
│       │   ├── research/
│       │   ├── memory/
│       │   ├── agents/
│       │   └── integrations/
│       ├── lib/
│       │   ├── api/
│       │   ├── events/
│       │   ├── query/
│       │   └── format/
│       ├── styles/
│       │   ├── tokens.css
│       │   ├── themes.css
│       │   └── globals.css
│       └── types/
│
└── docs/
```

The exact folder naming can change; the boundary cannot. Backend `src/` must not import anything from `frontend/`.

### 7.3 Frontend responsibility boundaries

Frontend owns:
- Navigation, layout, responsive behaviour and visual presentation.
- User input and client-side validation for usability.
- Query caching, optimistic UI only where safe, and local view state.
- SSE connection lifecycle and event-to-cache invalidation.
- Rendering statuses and safe event summaries.
- Accessibility, keyboard navigation and theme.

Backend owns:
- Agent runtime and orchestration.
- Tool execution and machine access.
- Policy, permission and approval enforcement.
- Database access and durable state.
- Model/provider credentials and routing.
- Canonical run/goal/task/approval/artifact state.
- Event creation and authoritative timestamps.
- Secret redaction and audit history.

The frontend must never:
- Import `src/core` or `src/tools`.
- Access SQLite/PostgreSQL directly.
- Execute shell commands or filesystem operations locally on behalf of Athena.
- Hold provider API keys in static assets/local storage.
- Treat client state as authoritative for run/approval state.
- fabricate an unsupported feature or a successful action before the API confirms it.

---

## 8. Backend architecture already present in `athena-v2`

### 8.1 Actual backend stack

The reviewed branch uses:
- TypeScript / Node.js.
- Express 5 for the HTTP API.
- OpenAPI 3.1 and Swagger UI.
- Server-Sent Events (SSE) for run/session updates.
- Existing store interfaces.
- SQLite as the local default.
- PostgreSQL as an optional adapter.
- `pg` for PostgreSQL connectivity.
- A typed `AthenaClient` in `src/api/client/athenaClient.ts`.

**Important:** an older Phase 12 specification proposed Fastify unless an existing server made replacement unjustified. The accepted ADR and actual `src/api/server.ts` show that the implemented platform uses **Express**. The frontend should integrate with the actual Express API; do not replace the backend framework merely to follow the older proposal.

### 8.2 Logical request architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                 Athena Frontend (new package)               │
│                                                             │
│  React pages / components / local view state                │
│          │                                                  │
│          ├── Typed REST client + query/cache                 │
│          └── SSE event client                               │
└──────────┬───────────────────────────────┬───────────────────┘
           │ HTTPS/HTTP JSON               │ text/event-stream
           v                               v
┌─────────────────────────────────────────────────────────────┐
│                Existing Express API Platform                │
│                                                             │
│ Request ID / CORS / body parsing / auth / workspace scope    │
│ OpenAPI + Swagger                                             │
│ Modular route registration                                   │
│ Controllers                                                   │
│ Dispatch / Hydration / Approval / Artifact services          │
│ SSE Manager                                                   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               v
┌─────────────────────────────────────────────────────────────┐
│                   Athena Application/Core                   │
│                                                             │
│ Agent runtime / orchestration / planning / verification      │
│ Goals / Tasks / Runs / Waiting / Delegation                  │
│ Memory / Context / Skills / Routines / Proactive events      │
│ Tools / Browser / Computer / Research / Multimodal           │
│ Policy / Permissions / Approvals / Observability              │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               v
┌─────────────────────────────────────────────────────────────┐
│                    Store Interfaces                          │
│                                                             │
│       SQLite adapter (default)   PostgreSQL adapter (opt-in) │
└─────────────────────────────────────────────────────────────┘
```

### 8.3 Request lifecycle: user sends a message

1. User enters a request in the Workspace composer.
2. Frontend calls `POST /api/v1/sessions/:sessionId/messages`.
3. Request includes the required auth/workspace context and an idempotency key where supported.
4. Express middleware assigns/propagates a request ID, applies CORS/body parsing and authentication.
5. `SessionsController` delegates to `DispatchService`.
6. Dispatch service deduplicates retries, persists the message/run association and returns durable tracking information.
7. Athena's runtime executes the run using its actual core orchestration and policy layers.
8. The API exposes canonical run/session state through REST hydration.
9. SSE publishes user-facing events to the connected frontend.
10. Frontend updates the relevant query cache and renders the real run state.
11. When complete, frontend fetches canonical state/artifacts and renders the result.

The frontend should not assume that a successful message POST means the task has completed. It means the dispatch was accepted/created according to the API response.

### 8.4 Request lifecycle: approval

1. A run reaches a policy/approval boundary.
2. Backend persists the approval and places the run into the appropriate waiting state.
3. The event stream emits an approval-related event.
4. Frontend updates the pending approval list and opens the approval detail.
5. User reviews the exact action, target, scope and consequences.
6. Frontend submits a decision to `POST /api/v1/approvals/:approvalId/decision`.
7. Backend validates authorization, state and expiry; the decision is atomic.
8. Backend records the decision and resolves/unblocks the waiting run if approved.
9. SSE updates the run and approval views.
10. Frontend rehydrates canonical approval/run state.

The client must handle stale approvals and `409 Conflict`; it must not assume a decision succeeded until the backend confirms it.

### 8.5 REST and SSE responsibilities

Use REST for canonical state and commands:
- List resources.
- Load detail pages.
- Submit messages.
- Create/pause/resume goals where supported.
- Cancel runs.
- Make approval decisions.
- Fetch artifact metadata, versions and diffs.
- Search research/documents and inspect capabilities.

Use SSE for live updates:
- Run queued/started/progress/completed.
- Message started/delta/completed.
- Agent progress.
- Tool started/progress/completed.
- Subagent started/progress/completed.
- Approval required/resolved.
- Artifact created/updated.
- Task updated.
- Heartbeat.

SSE events are **signals to update the UI**, not an indefinitely authoritative copy of the database. After reconnect or important transitions, fetch canonical state through REST.

### 8.6 Existing event envelope

The current event envelope in `src/api/events/eventEnvelope.ts` includes:

```typescript
interface AthenaEventEnvelope<T = any> {
  eventId: string;
  schemaVersion: 1;
  type: AthenaEventFamily;
  timestamp: string;
  workspaceId?: string;
  sessionId?: string;
  runId?: string;
  data: T;
}
```

Event families currently declared include:
- `run.queued`
- `run.started`
- `run.progress`
- `run.waiting_for_approval`
- `run.cancellation_requested`
- `run.completed`
- `message.started`
- `message.delta`
- `message.completed`
- `agent.progress`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `subagent.started`
- `subagent.progress`
- `subagent.completed`
- `approval.required`
- `approval.resolved`
- `artifact.created`
- `artifact.updated`
- `task.updated`
- `heartbeat`

Do not render private chain-of-thought. `agent.progress` should be a concise, user-facing status summary.

### 8.7 Existing SSE manager behaviour and integration notes

The reviewed `SSEManager`:
- Sets `Content-Type: text/event-stream`.
- Sends heartbeat comments every 15 seconds.
- Assigns event IDs and supports replay from a supplied last event ID.
- Keeps an in-memory ring buffer with a default maximum of 500 events.
- Filters streams by run/session when those identifiers are present.
- Cleans up clients on disconnect.

Frontend integration requirements:
- Use `EventSource` or a compatible SSE client.
- Support reconnecting and last-event cursor semantics where exposed.
- Show a small connection state: connected, reconnecting, disconnected.
- Do not create a new run when reconnecting.
- On reconnect, re-fetch the current session/run state and reconcile it with received events.
- Deduplicate events by `eventId`.
- Treat event data as untrusted display data; render safe text, escape HTML and redact sensitive fields if any should reach the UI.
- The current manager's replay buffer is in-memory and bounded. Do not describe it as a durable event log or guarantee replay beyond the retained buffer.

---

## 9. Existing API surface and page mapping

The route modules below were inspected in the `athena-v2` branch. The list is the currently visible route surface, not a promise that every possible CRUD operation exists.

| Domain | Existing route surface | Main UI consumer |
|---|---|---|
| Health | `GET /health/live`, `GET /health/ready` | Connection/system health |
| Sessions | `GET /api/v1/sessions`; `POST /api/v1/sessions/:sessionId/messages`; `GET /api/v1/sessions/:sessionId/state`; `GET /api/v1/sessions/:sessionId/events` | Workspace, session view |
| Runs | `GET /api/v1/runs/:runId`; `POST /api/v1/runs/:runId/abort`; `GET /api/v1/runs/:runId/events`; `GET /api/v1/runs/:runId/replay` | Activity, run inspector |
| Goals | `GET /api/v1/goals`; `POST /api/v1/goals`; `GET /api/v1/goals/:goalId`; `GET /api/v1/goals/:goalId/tasks`; `POST /api/v1/goals/:goalId/pause`; `POST /api/v1/goals/:goalId/resume` | Goals & Tasks |
| Approvals | `GET /api/v1/approvals/pending`; `GET /api/v1/approvals/:approvalId`; `POST /api/v1/approvals/:approvalId/decision` | Approvals |
| Artifacts | `GET /api/v1/artifacts`; `GET /api/v1/artifacts/:artifactId`; `GET /api/v1/artifacts/:artifactId/versions`; `GET /api/v1/artifacts/:artifactId/diff`; `GET /api/v1/artifacts/:artifactId/raw` | Knowledge, run inspector |
| Coding harness | `GET /api/v1/harness/status`; `POST /api/v1/harness/snapshots`; `POST /api/v1/harness/rollback`; `GET /api/v1/harness/diff` | Run inspector, contextual coding tools |
| Computer use | `GET /api/v1/computer/screen`; `GET /api/v1/computer/windows`; `POST /api/v1/computer/focus` | Contextual computer inspector |
| Browser | `GET /api/v1/browser/profiles`; `GET /api/v1/browser/sessions/:id`; `GET /api/v1/browser/sessions/:id/snapshot` | Contextual browser inspector |
| Research/RAG | `GET /api/v1/research/documents`; `POST /api/v1/research/documents/upload`; `POST /api/v1/research/search`; `GET /api/v1/research/vectors/stats` | Knowledge |
| Multi-agent | `GET /api/v1/teams`; `POST /api/v1/teams`; `GET /api/v1/teams/:id`; `GET /api/v1/agents/messages`; `POST /api/v1/agents/messages` | Agent Studio, run inspector |
| Learning | `GET /api/v1/learning/skills`; `GET /api/v1/learning/workflows`; `POST /api/v1/learning/workflows/:id/review`; `GET /api/v1/learning/routines`; `POST /api/v1/learning/routines` | Agent Studio, Automations |
| Communication | `GET /api/v1/communication/channels`; `GET /api/v1/communication/conversations`; `GET /api/v1/calendar/events`; `POST /api/v1/calendar/events` | Tools & Connections, Automations |
| Proactive | `GET /api/v1/proactive/heartbeats`; `GET /api/v1/proactive/events`; `POST /api/v1/proactive/events/:id/retry`; `GET /api/v1/proactive/webhooks`; `POST /api/v1/webhooks/incoming/:endpointId` | Automations |
| Reliability | `POST /api/v1/reliability/verify`; `POST /api/v1/reliability/repair`; clarification assess/list/answer routes | Run inspector, Approvals/attention |
| Tools/MCP | `GET /api/v1/tools`; `GET /api/v1/mcp/servers`; `POST /api/v1/mcp/servers` | Tools & Connections |
| Intelligence | `GET /api/v1/intelligence/models`; `GET /api/v1/intelligence/cache/stats`; `GET /api/v1/telemetry/metrics` | System Settings |
| System | `GET /api/v1/system/capabilities`; `GET /api/v1/system/policy` | System Settings |

The full OpenAPI specification is served by the backend at `/api/v1/openapi.json`; Swagger UI is served at `/docs`.

Before implementing each UI action, inspect its controller/service/schema and confirm the actual request/response shape. Do not invent endpoint fields based on a screen mockup.

---

## 10. Authentication, workspace scoping and security

The API server applies authentication middleware after registering the OpenAPI/Swagger documentation routes. The server accepts the configured API-key mechanism and the CORS allow-header list includes:
- `Authorization`
- `x-api-key`
- `x-idempotency-key`
- `x-workspace-id`
- `last-event-id`
- `x-signature`

Integration rules:
- Keep API credentials out of committed frontend source and static build assets.
- For a local desktop/local-first deployment, use a trusted local backend/proxy or secure runtime configuration to provide credentials; do not hard-code a long-lived key into the browser bundle.
- Scope requests to the active workspace where required.
- Do not assume a session ID grants access to every associated resource.
- Avoid logging auth headers, tokens, raw secrets or sensitive tool outputs.
- Render only safe summaries and redacted previews.
- Keep approval actions auditable.
- Treat web pages, documents, email content and tool outputs as untrusted content.
- Do not let UI affordances bypass backend PolicyEngine rules.

The exact deployment/auth strategy for a browser-hosted local UI must be settled before shipping beyond a trusted local development environment.

---

## 11. Storage architecture

The existing storage factory selects an adapter behind shared store interfaces.

```text
Core / Application Services
          |
          v
    Store Interfaces
          |
      StoreFactory
       /       \
      v         v
   SQLite   PostgreSQL
  default    optional
```

- **SQLite** remains the default for local, zero-configuration use.
- **PostgreSQL** is an optional deployment adapter.
- Both adapters are intended to satisfy the same store contracts.
- Core runtime code should depend on interfaces, not concrete SQL implementations.
- Database credentials belong in backend environment configuration, never in frontend code.

The backend Phase 12 specification and ADR describe storage parity and PostgreSQL migrations/adapters. A future frontend should not know which database is in use.

---

## 12. Recommended frontend data and event model

### 12.1 Server state versus local UI state

Use the query/cache layer for canonical server state:
- sessions
- messages
- goals/tasks
- runs
- approvals
- artifacts and versions
- skills/workflows/routines
- agents/teams
- tools/MCP
- capabilities and health

Use local component/app state for:
- current sidebar collapse state
- selected inspector tab
- open/closed inspector
- search/filter input before submission
- active page tab
- unsent composer draft
- temporary dialogs/menus
- theme preference (unless persisted through a backend preference API)

Do not mirror the entire backend database into global client state.

### 12.2 Event-to-cache strategy

Example approach:
- `run.*` → invalidate/update the matching run and its parent goal/task summary.
- `message.*` → append/update the matching session message.
- `tool.*` → update the active run timeline; do not retain unbounded raw tool output in memory.
- `subagent.*` → update the run's delegation tree.
- `approval.*` → invalidate pending approvals and matching run/session.
- `artifact.*` → invalidate artifact list and matching run detail.
- `task.updated` → invalidate goal/task data.
- `heartbeat` → update connection liveness only.

On reconnect:
1. Mark stream as reconnecting.
2. Re-establish stream.
3. Re-fetch the active run/session state.
4. Deduplicate/reconcile events by `eventId`.
5. Restore connected state only after successful stream setup.

### 12.3 Optimistic updates

Use optimistic UI sparingly:
- Safe local toggles (sidebar, theme, tabs) can update immediately.
- Approval decisions, run cancellation, goal pause/resume and other consequential operations should show pending state and wait for server confirmation.
- If the backend rejects a mutation, restore the canonical state and explain why.

---

## 13. Run status and visual state mapping

The V2 core's canonical run lifecycle includes:

- `created`
- `queued`
- `planning`
- `running`
- `waiting`
- `blocked`
- `approval_required`
- `verifying`
- `reviewing`
- `repairing`
- `completed`
- `failed`
- `cancelled`

The frontend design brief also references these states and asks the UI to preserve distinctions. Do not collapse `waiting`, `blocked`, and `approval_required` into one generic "paused" badge.

Suggested presentation:
- `created` / `queued`: neutral grey, "Queued".
- `planning`: muted blue/grey, "Planning".
- `running`: restrained sage, "Running".
- `waiting`: muted amber, "Waiting" plus the reason if available.
- `blocked`: amber/red semantic emphasis, explicit blocker and next action.
- `approval_required`: amber, "Needs approval" with direct link to the decision.
- `verifying` / `reviewing`: muted blue, show the stage, not a fake percentage.
- `repairing`: subdued amber, "Repairing".
- `completed`: restrained green, "Completed".
- `failed`: restrained red, "Failed" plus safe error summary.
- `cancelled`: neutral grey, "Cancelled".

Status transitions should be subtle, accessible and not dependent on colour alone.

---

## 14. First implementation vertical slice

Build in this order to prove the frontend/backend connection before expanding the product.

### Slice 1 — App shell + Workspace

1. Create the independent `frontend/` package.
2. Add tokens, typography, base controls and app shell.
3. Implement sidebar, workspace selector, header and contextual inspector.
4. Connect session list and session hydration.
5. Implement message composer and durable message dispatch.
6. Connect session/run SSE.
7. Render messages and real run progress.
8. Add offline/reconnect/error states.

### Slice 2 — Goal detail + Run inspector

1. Goals list/detail.
2. Task hierarchy and dependencies.
3. Run detail and lifecycle.
4. Live tool and subagent timeline.
5. Artifacts and verification summary.
6. Cancellation and replay where supported.

### Slice 3 — Approval centre

1. Pending approval list.
2. Approval detail and consequence preview.
3. Atomic decision action.
4. Stale/expired/conflict handling.
5. Live run/approval updates.

### Slice 4 — Product breadth

1. Automations.
2. Knowledge.
3. Agent Studio.
4. Tools & Connections.
5. System Settings.
6. Contextual browser/computer inspectors.

### Acceptance criteria for the first slice

- Frontend can run separately from the backend.
- Backend can be tested without starting the frontend.
- User can submit a message and receive a durable run reference.
- Reloading the page restores the session/run from backend state.
- Live events update the UI without resubmitting the message.
- Reconnecting does not create duplicate runs.
- Waiting, blocked, approval-required, failed and completed states are distinct.
- User can open the run inspector without losing the current workspace context.
- No frontend import exists in backend/core code.
- No API/provider secret is bundled into static frontend assets.

---

## 15. Build and development workflow

The backend `package.json` already defines:
- `npm run build`
- `npm run start:backend`
- `npm run dev:backend`
- `npm run test:v2p1` through `npm run test:v2p12`
- `npm run verify`
- Additional focused test/evaluation scripts

Keep the backend's current build/test workflow intact. Add independent frontend scripts inside `frontend/package.json`, for example:
- `dev`
- `build`
- `preview`
- `lint`
- `typecheck`
- `test`

During local development, configure Vite to proxy `/api` and health routes to the local Express backend. This avoids scattering backend origins through components. Confirm SSE proxy behaviour explicitly; the proxy must preserve streaming and relevant headers.

Do not add frontend packages to the root backend runtime dependencies unless there is a deliberate monorepo/build decision.

---

## 16. Known implementation cautions and audit items

These are important before production use:

1. **No frontend yet:** the UI pages in this document are a product blueprint, not existing code.
2. **P13 not started:** the implementation status document says the hardening phase is awaiting written approval.
3. **OpenAPI audit:** route existence does not automatically prove every controller operation is complete, correctly authorized and represented in OpenAPI. Audit exact request/response schemas before wiring screens.
4. **SSE replay is bounded/in-memory in the current manager:** the 500-event ring buffer is not a durable event store. Reconcile with REST state after reconnect.
5. **Auth deployment:** decide how a browser frontend receives local API credentials safely. Never bake secrets into Vite assets.
6. **Workspace scoping:** confirm every resource controller enforces workspace/resource authorization, not only the global API-key check.
7. **Capability truth:** show `real`, `experimental` or `unsupported` with reasons. Do not imply a browser/computer backend works on every OS.
8. **Long-running operations:** cancellation is a request; show the actual backend transition rather than immediately declaring a run cancelled.
9. **Tool output safety:** redact secrets and bound previews; large output belongs in artifacts or a controlled detail view.
10. **Accessibility:** validate keyboard navigation, focus management, contrast and reduced-motion behaviour.
11. **Tests:** branch status reports P1–P12 test suites passing, but run the checks locally in the target environment before a release.

---

## 17. Final product definition

Athena should feel like a quiet, serious command workspace for a persistent agent:

- The **left sidebar** answers: where am I and what area am I working in?
- The **central workspace** answers: what is Athena doing and what outcome are we working toward?
- The **right inspector** answers: what are the details, evidence, permissions and controls for this selected item?
- The **event stream** answers: what changed while I was away?
- The **backend** remains the authority for execution, state, safety and persistence.

The visual language is neutral graphite, thin borders, restrained sage/semantic accents, compact typography and precise technical labels. The product architecture is a separate frontend consuming the existing Express REST/OpenAPI/SSE platform. Athena core remains independent and can continue to run through CLI, Telegram or other channels without the web UI.

**Build the first real workflow end-to-end—Workspace → Goal → Run → Events → Approval/Result—before filling every navigation item with placeholder pages.** Every screen must be backed by a real API capability and every displayed status must reflect actual runtime state.

---

## 18. Repository references

- Repository: https://github.com/RAGHUTTAMA-DEV/Athena
- Reviewed branch: https://github.com/RAGHUTTAMA-DEV/Athena/tree/athena-v2
- Frontend design brief: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/docs/frontend-design-brief-v2.md
- Implementation status: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/IMPLEMENTATION_STATUS.md
- V2 build plan: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/docs/architecture/athena_v2_build_plan.md
- V2 theory: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/docs/architecture/athena_v2_theory.md
- Phase 12 backend specification: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/athena_v2_phase12_backend_postgres_spec.md
- Phase 12 accepted ADR: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/docs/decisions/0018-backend-platform-postgres-adapter-and-api-spec-p12.md
- API server: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/src/api/server.ts
- OpenAPI specification: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/src/api/openApiSpec.ts
- Event envelope: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/src/api/events/eventEnvelope.ts
- SSE manager: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/src/api/events/sseManager.ts
- Storage factory: https://github.com/RAGHUTTAMA-DEV/Athena/blob/athena-v2/src/storage/storeFactory.ts
