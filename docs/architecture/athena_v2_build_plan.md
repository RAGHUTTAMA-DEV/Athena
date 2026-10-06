# Athena V2: Full Build Plan (Production Level)

**Source of truth for scope:** `Athena V2: Final General-Purpose Autonomous Agent Specification` (sections 0-79).
**Baseline:** Athena V1 (README Phases 1-8, implemented). V1 is reused and extended, never rebuilt.
**This file is the build order.** It follows the spec's 13 phases (section 72) with V1 reuse mapped in and exit criteria added. UI is out of scope throughout.

To avoid confusion with V1's own "Phase 1-8", the V2 phases are called **P1-P13** below.

---

## 0. Rules for every phase

1. **Reuse first.** Inspect the V1 module before writing anything. Extend it. Preserve runtime contracts and existing tests (`npm run test:*` must stay green).
2. **Migrations for every schema change**, tested against a populated V1 database.
3. **No fake capabilities** (spec section 71). A capability is `real`, `experimental`, or `unsupported` in a capability registry. Never ship a toy heuristic as the real thing (e.g. a token-overlap "reranker", screenshot-description "computer use").
4. **Each phase ships:** code, migrations, unit + integration + failure + security + recovery tests (spec section 68), the phase's E2E scenarios, eval cases, and updated `roadmap.md` / `.todo.md` / ADRs.
5. **No phase starts until the previous phase's exit criteria pass.**
6. **Providers stay replaceable, capabilities independently testable, local-first preserved.**
7. **No UI in core.** No React/CSS/frontend state. Expose everything through APIs and events.

### Two sequencing changes from the spec's order (with reasons)

| Change | Reason |
|---|---|
| Define **store interfaces from P1** (`AgentStore`, `RunStore`, `EventStore`...) with the SQLite implementation. The PostgreSQL adapter still lands in P12. | If stores are written against SQLite directly for 11 phases, P12 becomes a rewrite of every store. Interfaces now make P12 an adapter. |
| **Background runs may not use `cmd:exec` / `fs:write` tools until P4A's sandbox/ExecutionBackend exists.** P2 ships background execution restricted to read-only/safe tools. | Spec section 63 says Athena controls real systems, so unattended execution needs a real boundary first. |

---

## 1. V1 baseline (what P1-P13 build on)

| V1 asset | Used by |
|---|---|
| RunState, `runs`/`run_events`, budgets, idempotency keys, run tree, cancellation, `/resume` | P2, P6, P11 |
| Scheduler (IANA TZ), JobLeaseManager, EventBus (+dedup, `event_log`), WorkerPool | P2, P7 |
| ContextEngine, scoped memory with provenance/confidence/supersede chain | P1, P3 |
| ToolRuntime (ToolResult, manifests, circuit breakers, 16KB offload), ToolSelector | P4 |
| TaskClassifier, PlanDAG, escalation, VerificationGate, self-repair | P2, P11 |
| CodingHarnessBridge (snapshots, rollback, acceptance gate) | P4, P11 |
| `delegate_task` sub-agents (scoped tools, budgets, depth guards) | P6 |
| PolicyEngine, PromptDefense, CredentialManager (redaction), FallbackLLMProvider | P4, P10, P13 |
| OTel + Langfuse alignment, TrajectoryReplayer, benchmark + adversarial evals, CI gate | P11, P13 |
| MCPManager (4 transports), Playwright browser, Telegram gateway, `skillManage` | P4, P5, P8, P12 |

---

## 2. Spec traceability (every spec section lands somewhere)

| Spec section | Topic | Phase |
|---|---|---|
| 3, 4, 5 | Identity, user model, workspace/project | P1 |
| 9, 10, 11, 12, 13, 14, 15 | Goals, tasks, runs, waiting, loop, planning, adaptive orchestration | P2 |
| 38 | Background execution | P2 (safe tools) → P4A (all tools) |
| 6, 7, 8, 49, 65 | Memory, session search, context refs, token efficiency, memory security | P3 |
| 16, 17 | Tool definition, tool discovery | P4A |
| 20, 21, 57 | Filesystem, terminal, ExecutionBackend | P4A |
| 23, 24, 25 | Web research, RAG (real reranker), documents | P4B |
| 19 | Browser | P4C |
| 18, 22 | Computer use, application control | P4D |
| 29, 30, 31 | Routines, learned workflows, skills | P5 |
| 32, 33, 34 | Delegation, A2A, teams | P6 |
| 35, 36, 37, 66 | Proactive autonomy, heartbeat, events, event security | P7 |
| 26, 27, 28, 58 | Communication, outbound messaging, calendar, gateway | P8 |
| 46, 47 | Multimodal, voice | P9 |
| 48, 49, 50, 56 | Model router, prompt caching, credentials, local models | P10 |
| 39, 40, 41, 42, 43, 44, 45, 62 | HITL, approvals, clarification, verification, reviewer, repair, artifacts, replay | P11 |
| 51, 55, 59, 60, 57 (remote) | MCP management, storage/Postgres, API, UI independence, remote backend | P12 |
| 61 | Observability (goal→task→run tracing) | P2 onward, finalized P13 |
| 63, 64, 67, 68, 69, 70, 71 | Security, injection, evals, testing, chaos, performance, no-fakes | P13 (+ per-phase tests) |
| 52, 53, 54 | Engineering capability, coding harness, RAG/AI eng | P4 (harness reuse), P11 (reviewer) |
| 73-79 | Non-goals, final architecture, success criteria | P13 |

## 2b. Architecture: where everything lives (V1 vs new)

`[V1]` = exists today (keep or extend). `[NEW]` = built in V2. Tag = phase.

```text
INTERFACES
  [V1] CLI            [V1] Telegram -> adapter (P8)     [NEW] Email/Discord/Slack/WhatsApp (P8)
  [NEW] Voice + images (P9)                              [NEW] REST + SSE API (P12)
        |  everything enters through ONE channel gateway (P8) -> same core
        v
IDENTITY, GOALS, ROUTING
  [NEW] AgentProfile + User model (P1)    [NEW] Workspaces/Projects (P1)
  [NEW] Goals + Tasks (P2)                [NEW] Model router + ModelPolicy (P10)
        v
RUNTIME AND CONTEXT
  [V1] Run engine (+ real waits, resume sweeper: P2)    [V1] Orchestrator (classifier, DAG, repair)
  [V1] Context engine (layered, cache-friendly: P3)     [V1] Memory (8 scopes, write pipeline: P3)
        v
KNOWLEDGE, LEARNING, AGENTS
  [NEW] Session search (FTS) (P3)     [NEW] @references (P3)
  [V1] Skills -> + routines, learned workflows (P5)     [V1] Delegation -> + A2A, teams (P6)
        v
ACTIONS
  [V1] Tool registry -> searchable discovery (P4A)      [NEW] Sandbox / ExecutionBackend (P4A)
  [V1] Terminal + files -> run inside sandbox (P4A)     [V1] Browser -> profiles, isolation (P4C)
  [NEW] Research + RAG + documents (P4B)                [NEW] Computer use (P4D)
  [V1] Coding harness (keep)                            [V1] MCP -> filtering, health (P12)
        v
AUTONOMY AND TRUST
  [V1] Events/webhooks -> relevance filter, heartbeat (P7)   [V1] Approvals CLI -> gateway-native (P11)
  [NEW] Independent reviewer (P11)                           [NEW] Artifacts (P11)
        v
FOUNDATION
  [V1] Scheduler + workers + leases    [V1] Security -> + credential pools (P10)
  [V1] OTel/Langfuse -> goal/task spans    [V1] SQLite -> store interfaces (P1) + Postgres (P12)
```

## 2c. What changes from V1 to V2

| Area | V1 today | V2 | Phase |
|---|---|---|---|
| Who Athena is | `SOUL.md` text file | Versioned `AgentProfile` + separate user model | P1 |
| Context boundaries | `workspace`/`project` memory scopes | Real Workspace/Project entities, enforced isolation | P1 |
| Storage | SQLite used directly | Store interfaces; SQLite default, Postgres adapter | P1, P12 |
| Work unit | Run (plus Plan DAG inside a run) | Goal -> Task -> Run, persisted, with budgets | P2 |
| Waiting | `waiting` state, manual `/resume` | `run_waits` + matcher, auto-resume after crash | P2 |
| Memory | 6 scopes, lifecycle | + `agent`/`goal` scopes, validated write pipeline | P3 |
| Recall | Replay only | Session search over messages/tools/events | P3 |
| Context input | Prompt text | `@file @run @goal @memory ...` references | P3 |
| Tools | Manifests + heuristic pruning | Searchable registry, discovery, output schemas | P4A |
| Execution | Local process, regex policy | ExecutionBackend + sandbox, allowlist | P4A |
| Research / docs | Web search, basic browser | Research pipeline, real-reranker RAG, documents/OCR | P4B |
| Browser | Playwright actions | Tabs, uploads/downloads, persistent isolated profiles | P4C |
| Desktop | None | Real OS computer-use backends (accessibility + input) | P4D |
| Learning | Skill files + success rates | Routines, learned workflows, progressive disclosure | P5 |
| Agents | Parent -> child delegation | Specialist profiles, A2A messages, teams | P6 |
| Proactivity | Scheduler + event bus | Relevance filter, heartbeat, signed webhooks | P7 |
| Channels | CLI + Telegram | Channel abstraction, + Email/Discord/Slack/WhatsApp, calendar | P8 |
| Modalities | Screenshots | Vision, STT, TTS, image generation | P9 |
| Models | Provider fallback | Task-based router, prompt caching, credential pools | P10 |
| Safety loop | CLI confirm prompts, gate | Gateway approvals, independent reviewer, artifacts | P11 |
| Interfaces | CLI/Telegram only | REST + SSE API over all resources | P12 |
| Proof | Phase tests + benchmarks | 16 eval areas, chaos suite, E2E scenarios | P13 |

---

---

# P1: Agent Foundation
**Spec:** 3, 4, 5, parts of 55.

**Reuse:** `SOUL.md`, `user`/`workspace`/`project` memory scopes, SQLite, ContextEngine.

**Build**
- `AgentProfile` record (id, name, identity, role, personality, capabilities, permissions, preferences, workspace, memoryScope, skills, routines, goals, modelPolicy, status, timestamps), versioned. `SOUL.md` becomes its seed/rendering.
- `User` model separate from generic memory: preferences (communication style, timezone, working hours, notification, approval, model, tool, project preferences), permissions, relationships, routines.
- Model-inferred user facts enter as `candidate` with provenance + confidence. They never silently become permanent.
- `Workspace` and `Project` entities (personal, college, company, research, dev environment) with context boundaries enforced in ContextEngine and tools.
- Permission model: agent permissions, user permissions, tool permissions (feeds PolicyEngine).
- **Store interfaces** for all entities now, SQLite implementations behind them.

**Exit criteria**
- Identity is identical across restart, model switch, tool change.
- Switching workspace never leaks another workspace's memory or files (test).
- A model-asserted fact stays `candidate` until validated (test).
- V1 database migrates cleanly (test on populated DB).

---

# P2: Persistent Autonomy
**Spec:** 9-15, 38, 61 (goal/task spans).

**Reuse:** RunState, Scheduler, EventBus, JobLeaseManager, WorkerPool, PlanDAG, TaskClassifier, budgets.

**Build**
- `Goal` (lifecycle: proposed/active/blocked/waiting/completed/failed/cancelled, priority, deadline, progress, dependencies, artifacts, runs, history) and `Task` (parent/child, dependencies, attempts/maxAttempts, result, recurring, delegated). Planner emits structured tasks into the store, not a text plan.
- Extend run lifecycle to the spec's states: `created, queued, planning, running, waiting, blocked, approval_required, verifying, reviewing, repairing, completed, failed, cancelled`.
- **Real waiting:** `run_waits` table (`WAITING_FOR_EVENT / APPROVAL / USER / BLOCKED`), event matcher, deadlines/timeouts. No `setTimeout`.
- **Crash-safe resume:** boot sweeper finds interrupted runs, re-queues them, idempotency keys protect side effects. Lease takeover for dead workers.
- Background execution through WorkerPool, with per-goal budgets and fairness. Restricted to safe/read tools until P4A.
- OTel/Langfuse spans: Goal → Task → Run.
- Minimal approval/user-reply resolution path (CLI + Telegram) so waits are testable. Full approvals in P11.

**Exit criteria**
- E2E: create → plan → execute → kill process → restart → resume → complete.
- E2E: execute → wait → process exits → event arrives → resume.
- Chaos: kill at random points (10 trials), no duplicated side effects.
- Goal-level budgets are enforced above run budgets.

---

# P3: Memory and Context
**Spec:** 6, 7, 8, 49, 65.

**Reuse:** V1 memory (scopes, provenance, supersede chain), ContextEngine, `/memory` commands.

**Build**
- Memory model per spec: scopes `global, user, workspace, project, agent, session, task, goal`; types `semantic, episodic, procedural, preference, relationship, fact`; lifecycle `candidate → validated → active → superseded/contradicted → archived`.
- **Memory write pipeline (section 65):** sanitize → security check → secret detection → provenance → confidence → store. Memory can never override system policy.
- **Session search** (separate from memory): SQLite FTS5 (Postgres full-text in P12) over messages, tool calls/outputs, plans, decisions, events, runs, artifacts, errors. Filters: time range, project, agent, run, session.
- **Context references:** `@file @folder @repo @url @session @run @goal @task @memory @artifact @project`, each resolved into bounded structured context. Never dump whole trees.
- ContextEngine layering: identity / stable instructions / skills / tool metadata / task state / relevant memory / live context. Stable layers first (cache-friendly for P10).
- Token accounting: input, output, cached, latency, cost per call.

**Exit criteria**
- Injection payload written to memory is blocked or quarantined (adversarial test).
- Session search recalls an exact tool output from a past run (eval).
- `@repo` on a large repo stays within the context budget (test).

---

# P4: Action System
Split into four independently shippable sub-phases.

## P4A: Registry, Discovery, Execution Backend, Filesystem, Terminal
**Spec:** 16, 17, 20, 21, 57.

**Reuse:** ToolRuntime, manifests, ToolSelector, PolicyEngine, filesystem/terminal tools.

**Build**
- Full `ToolDefinition` (capabilities, inputSchema, **outputSchema**, permissions, risk, timeout, sideEffects, idempotent, parallelSafe).
- **Searchable tool registry** and discovery pipeline: capability detection → discovery → ranking → permission check → execution. Replaces heuristic pruning; never put hundreds of schemas into the prompt.
- **`ExecutionBackend` interface** (`start/stop/execute/inspect/upload/download`). Default local backend plus a **sandboxed backend** (container or equivalent isolation: workspace mount, resource limits, network scope).
- Filesystem: read/write/edit/search/move/copy/delete/watch/inspect, scoped; destructive ops via policy/approval.
- Terminal: foreground + background processes, process management, logs, signals, timeouts, resource limits, cwd.
- PolicyEngine: blocklist becomes secondary; primary boundary is sandbox + allowlist + approval.

**Exit criteria**
- Sandbox escape attempts (symlinks, `..`, obfuscated destructive commands, env/secret reads) all fail (adversarial suite).
- Background runs may now use exec/write tools **only** inside the sandbox.
- Tool discovery picks the right tool from 100+ registered tools in eval, with bounded prompt size.

## P4B: Web Research, RAG, Documents
**Spec:** 23, 24, 25, 54.

**Build**
- Research pipeline: search → retrieve → extract → reason → cross-check → synthesize → cite → artifact. Output distinguishes **source / claim / inference / uncertainty**.
- RAG pipeline: ingest → parse → chunk → embed → retrieve → **rerank** → synthesize → verify.
- **Hard rule:** the reranker is a **real cross-encoder/reranker model** scoring `(query, passage)`. No token-overlap/TF-IDF/cosine-as-reranker. If no reranker backend is configured, the capability is `unsupported`, not faked.
- Documents: PDF, DOCX, XLSX, CSV, Markdown, HTML, images, scanned docs (OCR). Read/extract/search/summarize/compare/transform/generate. Large documents go through retrieval, never wholesale into context.
- Vector store behind an interface (SQLite-based locally, pgvector in P12).

**Exit criteria**
- Reranker eval shows measurable gain over retrieval-only on a fixed dataset.
- Research report cites sources and labels claims vs inferences (eval).
- 200-page PDF Q&A stays within context budget.

## P4C: Browser as First-Class Environment
**Spec:** 19.

**Reuse:** Playwright tools, interactive element IDs, screenshots.

**Build**
- Tabs, forms, downloads, uploads, cookies, sessions, authentication flows, accessibility trees, page extraction.
- Persistent browser profiles; **isolated per task/agent**.
- All page content passes through PromptDefense as untrusted.

**Exit criteria:** E2E navigate → authenticate → perform action → verify; two agents never share cookies unless configured.

## P4D: Computer Use and Application Control
**Spec:** 18, 22.

**Build**
- Real OS automation backends for Windows, macOS, Linux: screen inspection, **accessibility tree**, mouse, keyboard, click, type, scroll, drag, window management.
- Backend options for the harness to **evaluate and choose** (do not assume): Windows UI Automation, macOS Accessibility API, Linux AT-SPI, with an input-injection layer per OS (for example nut.js or native bridges). Decide via spike + ADR.
- Application control goes through the computer-use abstraction, with no per-app hacks.
- Permission scopes: which apps/windows Athena may touch; every action is audit-logged; destructive/financial actions require approval.
- **No faking** with screenshots + text description. If a platform backend is not ready, mark that platform `unsupported`.

**Exit criteria:** E2E inspect screen → act → inspect result → verify, on each supported OS; capability registry shows true per-OS status.

---

# P5: Learning
**Spec:** 29, 30, 31.

**Reuse:** `skillManage`, skill registry (versions, invocations, success rates).

**Build**
- Skills with **progressive disclosure**: metadata always loaded, body loaded on demand.
- `Routine` (trigger, conditions, workflow, permissions, enabled, successRate, history), reusing Scheduler and EventBus as triggers.
- Learned workflows from successful runs: store intent, steps, dependencies, conditions, required permissions, expected outcome, failure handling (not raw action recordings). Review before activation.
- Keep Skill / Routine / Goal / Task / Run strictly separate concepts.

**Exit criteria:** a repeated multi-step workflow becomes a proposed skill, passes review, and then executes with success tracking; routine "when CI fails" fires from an event.

---

# P6: Multi-Agent
**Spec:** 32, 33, 34.

**Reuse:** `delegate_task`, run tree, scoped tools, depth guards.

**Build**
- Specialized agent profiles (Researcher, Coder, Reviewer, Planner, Browser Agent, Data Agent) as `AgentProfile`s.
- Delegation contract: scoped context, tools, permissions, bounded lifetime, clear task, output contract.
- **A2A messaging:** `AgentMessage` (types: request, response, handoff, question, blocked, status, artifact, approval, cancel), durable mailbox, linked to goal/task.
- Teams optional, with a justification rule (a real specialization benefit) recorded per team.

**Exit criteria:** handoff Researcher → Coder → Reviewer survives a restart; a subagent cannot use a tool outside its scope (test); agent count and depth are capped.

---

# P7: Proactive Agent
**Spec:** 35, 36, 37, 38, 66.

**Reuse:** Scheduler, EventBus, JobLeaseManager, WorkerPool.

**Build**
- Pipeline: Event → Filter → Relevance → Agent Wake → Reason → Action. Cheap rules first, small-model relevance second, main LLM only when needed. **Never wake the LLM continuously.**
- Heartbeat: event-aware, throttled, cost-aware, priority-aware, user-configurable. Asks "is anything important?", not "generate another response."
- Full `AgentEvent` schema (traceId, agentId, goalId, taskId, runId, idempotencyKey) with persistence, routing, dedup, **retries, replay**, filtering.
- Webhooks with **authentication, authorization, signature verification, deduplication, replay protection, payload validation**. Webhooks cannot trigger privileged actions directly.
- Notifications and monitoring triggers (new email, GitHub issue, calendar approaching, site status changed, goal stalled).

**Exit criteria:** duplicate and replayed webhooks are rejected; forged signature rejected; heartbeat cost is capped and measured; stalled goal triggers a wake.

---

# P8: Communication
**Spec:** 26, 27, 28, 58.

**Reuse:** Telegram gateway, MCP (as a fallback for some integrations).

**Build**
- Normalized `Channel`, `Conversation`, `Participant`, `InboundMessage`, `OutboundMessage`. Gateway routes everything into one Athena core; **channels are not separate agents**.
- Migrate Telegram to a channel adapter, then add Email, Discord, Slack, WhatsApp.
- WhatsApp note: official access goes through the WhatsApp Business Platform; verify current terms and requirements before committing, and mark `experimental` if using anything unofficial.
- Sender identity and authorization (owner vs. others); all inbound content is untrusted.
- `send_message` tool with policy enforcement (who, what, when, approval for external publication).
- Calendar integration, deadlines, reminders; "tomorrow morning" becomes a durable scheduled action.

**Exit criteria:** same task works from CLI and two channels with identical core behavior; a stranger's message cannot trigger privileged actions; outbound policy blocks unauthorized sends.

---

# P9: Multimodal and Voice
**Spec:** 46, 47.

**Build**
- Provider interfaces: `VisionProvider`, `STTProvider`, `TTSProvider`, `ImageGenerationProvider`; local and cloud implementations.
- Image/PDF/audio input through channels and tools.
- Voice: STT → same Athena core → TTS; voice-triggered tasks.
- Cross-capability scenario: user sends screenshot → Athena understands it → opens browser → acts → verifies.

**Exit criteria:** screenshot→browser→verify E2E; voice request creates a goal through the normal core path.

---

# P10: Intelligence
**Spec:** 48, 49, 50, 56.

**Reuse:** FallbackLLMProvider (cooldown), token tracking from P3.

**Build**
- `ModelRouter` with `ModelPolicy` (preferred, fallback, capabilityRequirements, maxCost, latencyTarget) over categories fast/normal/reasoning/coding/vision/long-context/cheap/high-accuracy. Provider fallback stays separate.
- Prompt caching: stable-prefix assembly, cached-token tracking per provider.
- Credential management: isolation, **pools, rotation**, rate-limit handling, provider health. Credentials never in model context, logs, memory, or artifacts (tested by scanning).
- Local-first: Ollama/local model provider.

**Exit criteria:** router eval shows cost drop with no quality drop on the benchmark; rotation survives a 429 storm; secret-scan finds no credential in any persisted artifact.

---

# P11: Reliability
**Spec:** 39-45, 62.

**Reuse:** VerificationGate, self-repair, CodingHarness acceptance gate, TrajectoryReplayer.

**Build**
- **Verification** per task type: Expected Outcome → Evidence → Verification → PASS/FAIL (page inspected, file verified, tests/build, sources checked, delivery result, resulting state).
- **Independent reviewer:** separate context, separate reasoning (ideally a different model), restricted permissions, explicit criteria, for high-risk/high-value tasks.
- Self-repair: classify → diagnose → replan → repair → verify, with bounded attempts.
- **Approvals:** `ApprovalRequest` (action, risk, explanation, proposedAction, expiresAt), gateway-native, survives restarts. HITL triggers: critical ambiguity, high-risk, destructive, financial, external publication, credential modification, permission escalation.
- **Clarification:** one useful question, then continue.
- **Artifacts:** `Artifact` model + `ArtifactStore`, versioned, linked to agent/run/goal/task.
- **Full replay:** initial state, events, model calls, tool calls, state changes, artifacts, verification, final state. Record model I/O so replays are reproducible.

**Exit criteria:** approval requested → process killed → approval granted after restart → run resumes; reviewer catches seeded defects in eval; a run replays deterministically from the log.

---

# P12: Platform
**Spec:** 51, 55, 56, 57 (remote), 59, 60.

**Build**
- **PostgreSQL adapter** for every store behind the P1 interfaces, plus migration tooling and a **parity test suite** that runs the same tests on SQLite and Postgres (job leases via row locking, FTS, pgvector). SQLite stays the local default.
- REST API for: agents, users, workspaces, projects, sessions, goals, tasks, runs, memory, skills, routines, artifacts, approvals, events, tools, models, integrations. WebSocket/SSE for events. AuthN/AuthZ, rate limiting, versioning.
- MCP management: server discovery, tool discovery, **tool filtering** (never expose all tools blindly), permissions, credentials, health.
- Remote `ExecutionBackend` plug-in contract (implementation optional; no cloud platform build).
- UI-independence check in CI: no React/CSS/frontend code in core.
- Production configuration: env validation, secrets handling, health/readiness endpoints, structured logs.

**Exit criteria:** full test suite green on both SQLite and Postgres; API contract tests pass; a client can render complete agent state purely from the API.

---

# P13: Hardening
**Spec:** 61, 63-71, 73-79.

**Build**
- Security audit against section 63: least privilege, agent/tool/workspace/filesystem/network scopes, audit logs, approval policies.
- **Chaos tests:** process crash, DB failure, network failure, provider timeout, tool timeout, worker crash, duplicate event/webhook, partial output, corrupted state. Athena must recover safely.
- **Evaluation suites** for all 16 areas in section 67: planning, tool selection, tool execution, memory, session recall, browser, computer use, research, communication, delegation, verification, self-repair, long-running autonomy, waiting/resumption, security, prompt injection, model routing. CI regression gate (extends V1's).
- **E2E scenarios** from section 68: long-running goal, waiting, delegation, computer use, browser, security.
- Performance: time to first action, tool/event/memory/search/model/run latency, tokens, cost. Hard caps on context, retries, agents, events, tool schemas.
- Capability registry audit: no fake features remain (section 71).
- V1 → V2 data migration guide, documentation, ADR index.
- **The single most important test (section 75):** give Athena a vague "get this done" request and verify it determines objective, gaps, tools, safe actions, planning, delegation, background work, approvals, verification, memory, and next steps.

**Exit criteria:** all eval categories pass at agreed thresholds; chaos suite passes; capability registry honest; section 75 test passes on 3 distinct real tasks.

---

# 3. Harness prompt (reuse per phase)

```text
Read roadmap.md and docs/architecture/athena-v2-build-plan.md (this file) first.
The V2 specification is background; this build plan wins on phase order and scope.

Task: implement {PHASE, e.g. "P2: Persistent Autonomy"} ONLY.

1. Inspect the existing V1 modules this phase reuses (listed under "Reuse").
   Report what already exists and what is missing. Do not rebuild existing parts.
2. Write a plan: files to change, migrations, interfaces, tests, risks.
   Stop and wait for my approval before writing code.
3. Implement by extending existing modules. No placeholder implementations.
   If something can't be done for real, mark it `experimental` or `unsupported`
   in the capability registry and tell me.
4. Add migrations, unit/integration/failure/security/recovery tests, and the
   phase's E2E scenarios. Add eval cases.
5. Run the full existing suite; nothing may regress.
6. Verify every Exit criterion explicitly and report pass/fail for each.
7. Update roadmap.md, .todo.md, and add ADRs for key decisions.
Stop after this phase. Do not begin the next one. No UI work.
```

---

# 4. Out of scope (spec section 73)

Custom foundation model, custom browser engine, native mobile OS, public plugin marketplace, agent social network, custom cloud infrastructure, building every possible integration.
