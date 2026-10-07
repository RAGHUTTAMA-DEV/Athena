# Athena V2 — Implementation Status

> **Snapshot:** 2026-10-07 · **Branch:** `athena-v2` · **Plan (source of truth):** [`docs/architecture/athena_v2_build_plan.md`](docs/architecture/athena_v2_build_plan.md)
> Full historical tracker: [`roadmap.md`](roadmap.md) · Local scratch: `.todo.md` (not committed)

---

## Where things stand right now

| | |
|---|---|
| **Current phase** | **P4A: Action System (Registry, Discovery, Sandbox, FS, Terminal) — ✅ COMPLETE** |
| **Next phase** | P4B: Web Research, RAG, and Document Intelligence — ⏳ **awaiting written approval** (not started) |
| **Working rule** | One phase at a time. Code only after plan approval; commit only at phase completion; no next phase without written approval. |
| **Regressions** | None. Full V1, V2 P1, V2 P2, V2 P3, & V2 P4A test suites green (see [Test suite status](#test-suite-status)) |

---

## Phase status

V2 phases are **P1–P13** (distinct from V1's "Phase 1–8").

| Phase | Scope | Status | Evidence |
|:---|:---|:---:|:---|
| **V1 baseline** | Phases 1–8: runtime, memory, tools, orchestration, harness, background, security, observability/evals | ✅ shipped | `roadmap.md`, commits on `main` |
| **P1** | **Agent Foundation** — versioned migrations, AgentProfile + version history, User model, Workspace/Project entities, candidate memory lifecycle, permission model, store interfaces | ✅ **done** (`6846f5c`) | `npm run test:v2p1` — 9/9 |
| **P2** | **Persistent Autonomy** — Goal/Task entities, extended run lifecycle (12 states), `run_waits`, crash-safe resume, per-goal budgets, Goal→Task→Run spans, background safe tool guard | ✅ **done** | `npm run test:v2p2` — 11/11 |
| **P3** | **Memory and Context** — Memory model per spec (scopes `agent`, `goal`, types `fact`, `preference`, etc., lifecycle `quarantined`, `archived`), Section 65 Secure Memory Write Pipeline (sanitize, prompt injection quarantine, credential masking), Universal Session Search (FTS5 over messages, tool calls/outputs, plans, thoughts, errors), Bounded Context References (`@file`, `@folder`, `@repo`, `@run`, `@goal`, `@task`, `@memory`, `@project`), Cache-Friendly Layered ContextEngine, Token & Cost Accounting | ✅ **done** | `npm run test:v2p3` — 9/9 |
| **P4** | **Action System** — P4A: Registry, Discovery, ExecutionBackend, FS, Terminal ✅ (P4B: Research/RAG, P4C: Git/Worktrees, P4D: Advanced Actions pending) | 🔄 in progress (P4A done) | `npm run test:v2p4a` — 6/6 |
| **P5** | Learning | ⛔ not started | — |
| **P6** | Multi-Agent | ⛔ not started | — |
| **P7** | Proactive Agent | ⛔ not started | — |
| **P8** | Communication | ⛔ not started | — |
| **P9** | Multimodal and Voice | ⛔ not started | — |
| **P10** | Intelligence | ⛔ not started | — |
| **P11** | Reliability | ⛔ not started | — |
| **P12** | Platform (PostgreSQL adapter for P1 store interfaces, API) | ⛔ not started | — |
| **P13** | Hardening | ⛔ not started | — |

---

## What is implemented (as of P1)

### From V1 (unchanged, reused)
- RunState + budgets + idempotency + run tree + cancellation + resume
- ContextEngine pipeline; multi-scope `scoped_memory` with provenance/confidence/supersede chain
- Tool runtime: `ToolResult` envelope, timeout policies, circuit breakers, `ToolSelector`, output offloading
- Adaptive orchestration: TaskClassifier, PlanDAG, escalation, VerificationGate, self-repair; sub-agent delegation
- Coding harness bridge; scheduler + worker pool + job leases + event bus
- Security: PolicyEngine V1 rules, PromptDefense, credential redaction, provider fallback
- Observability: OTel/Langfuse, replay debugger, benchmark + adversarial evals

### Added by V2 P1 (commit `6846f5c`)
- **Migration layer** — `AthenaDatabase` (`src/core/database.ts`): `PRAGMA user_version` + `schema_migrations` audit, per-migration transactions with rollback; M001 `v1_baseline` (idempotent), M002 `v2_p1_agent_foundation` (`src/core/migrations/index.ts`)
- **Identity** — versioned `AgentProfile` seeded from `SOUL.md` with append-only `agent_profile_versions` history; `User` model (preferences/permissions/relationships/routines); `Workspace` / `Project` entities with filesystem roots (`src/core/identity.ts`, `src/core/identityTypes.ts`)
- **Candidate memory lifecycle** — model-inferred `user`-scope facts (`agent_reflection` / `subagent`) enter as `candidate`, promoted only via explicit `validateMemory()`; nullable `workspace_id` / `project_id` / `agent_id` on `scoped_memory` (NULL = cross-workspace, V1 visibility preserved); bind-aware search + ContextEngine pass-through
- **Permission model** — composed agent + user + tool rules as the **primary** PolicyEngine layer (user deny > agent deny > confirmations > allows, first match wins); V1 hardcoded rules remain the secondary layer and can't be bypassed by an allow; `require_confirmation` enforced once in `ToolExecutor` via a memoized confirm callback (`src/core/policyEngine.ts`, `src/core/toolRuntime.ts`)
- **Store interfaces** — `AgentStore`, `UserStore`, `WorkspaceStore`, `ProjectStore`, `RunStore`, `EventStore` behind SQLite implementations (`src/core/stores/`); `EpisodicMemory` delegates through a facade → zero caller changes; PostgreSQL adapter lands in P12
- **Agent wiring** — `initIdentity()`, `getAgentProfile()`, `setActiveWorkspace()` (moves memory binding + PolicyEngine root, versioned); soul rendered from profile, not re-read from file (`src/core/agent.ts`)
### Added by V2 P2
- **Schema Migration 3** — `v2_p2_persistent_autonomy`: tables `goals`, `tasks`, `run_waits`, plus foreign key columns `runs.goal_id` and `runs.task_id`.
- **Stores & Types** — `GoalStore`, `TaskStore`, `RunWaitStore` with SQLite implementations (`SqliteGoalStore`, `SqliteTaskStore`, `SqliteRunWaitStore`) behind the memory facade.
- **Extended Run Lifecycle** — 12 canonical states (`created`, `queued`, `planning`, `running`, `waiting`, `blocked`, `approval_required`, `verifying`, `reviewing`, `repairing`, `completed`, `failed`, `cancelled`).
- **Durable Waiting Engine** — `WaitingEngine` parks runs in `run_waits` table for events, human approvals, user replies, and timeouts without long-lived `setTimeout` loops.
- **Crash Recovery Sweeper** — `CrashResumeSweeper` boot sweep identifies interrupted runs left in active states and resets them to `queued` for deterministic resumption.
- **Hierarchical Telemetry** — OpenTelemetry / Langfuse spans linked hierarchically: Goal span $\rightarrow$ Task span $\rightarrow$ Agent trace / run span.
- **Policy Guard** — `BACKGROUND_SAFE_TOOL_RESTRICTION` denying destructive commands and file writes when `isBackground: true`.
- **Goal Budgets** — Authoritative goal budgets (`maxTurns`, `maxTimeMs`, etc.) enforced strictly above run-level budgets.
- **ADR** — [`docs/decisions/0005-goal-task-run-waits-persistent-autonomy.md`](docs/decisions/0005-goal-task-run-waits-persistent-autonomy.md).

### Added by V2 P3
- **Schema Migration 4** — `v2_p3_memory_context`: altered `scoped_memory` with `memory_type`, `goal_id`, `security_status`, `quarantine_reason`; created backing table `session_search_entries` and FTS5 virtual table `session_search_fts` with auto-sync triggers.
- **Memory Model Expansion** — scopes `agent` and `goal`; types `fact`, `preference`, `relationship`, `procedural`, `semantic`, `episodic`; lifecycle states `archived` and `quarantined`.
- **Section 65 Secure Memory Write Pipeline** — `MemoryWritePipeline`: 6 stages (`sanitize` $\rightarrow$ `security check` $\rightarrow$ `secret detection` $\rightarrow$ `provenance` $\rightarrow$ `confidence` $\rightarrow$ `store`). Prompt injection attacks are quarantined and given confidence 0.0 with full threat rationale, guaranteeing zero leakage into reasoning context. Credentials automatically masked with `[REDACTED_*]` tokens.
- **Universal Session Search Engine** — `SessionSearchEngine`: searches and filters across messages, tool calls, tool results/outputs, plans, thoughts, decisions, errors, and runs with multi-dimensional filtering.
- **Bounded Context Reference Resolvers** — `ContextRefResolver`: parses `@file`, `@folder`, `@repo`, `@url`, `@session`, `@run`, `@goal`, `@task`, `@memory`, `@artifact`, `@project`. Enforces strict token caps; `@repo` summarizes structure and packages without wholesale directory tree dumps.
- **Cache-Friendly Layered ContextEngine** — Strict assembly: Layer 1 (Identity) $\rightarrow$ Layer 2 (Directives) $\rightarrow$ Layer 3 (Skills) $\rightarrow$ Layer 4 (Tools) $\rightarrow$ Layer 5 (Task State) $\rightarrow$ Layer 6 (Memory) $\rightarrow$ Layer 7 (Live Context & References). Deterministic prefix stability preserves LLM prompt prefix caches.
- **Token & Cost Accounting** — `TokenAccountant`: measures input, output, cached tokens, latency ms, and estimated cost per call, per run, and cumulative per goal across standard model pricing tiers.
- **Store Interfaces & Implementations** — `MemoryStore` (`SqliteMemoryStore`) and `SessionSearchStore` (`SqliteSessionSearchStore`).
- **ADR** — [`docs/decisions/0006-memory-model-session-search-and-context-refs.md`](docs/decisions/0006-memory-model-session-search-and-context-refs.md).

### Added by V2 P4A
- **Tool Definition & Manifest** — `ToolDefinition` implementing schema, capabilities, permissions, risk, timeout, sideEffects, idempotent, and parallelSafe flags.
- **Obfuscation Detection Engine** — `ObfuscationDetector` unmasks Base64 shell invocations, PowerShell UTF-16LE (`-EncodedCommand`), cmd caret insertions (`d^e^l`), hex/octal escapes, and inline script evaluators (`eval`, `Function`).
- **PolicyEngine Modernization** — `canonicalPath` realpath symlink escape protection for workspace containment; obfuscated command detection denying masked dangerous operations; background run safety restricting execution/writes strictly to sandbox backends.
- **Execution Backend Abstraction** — `ExecutionBackend` interface implemented by `LocalExecutionBackend` (process tree tracking, timeouts, signals) and `SandboxedExecutionBackend` (virtual workspace mount, path traversal & symlink jail protection, sensitive host env stripping, resource limits, and policy verification).
- **Scoped Filesystem Engine** — `FilesystemEngine` providing safe `readFile`, `writeFile`, `editFile`, `searchFiles`, `moveFile`, `copyFile`, `deleteFile`, `inspectPath`, and `watchPath` within canonical jail boundaries.
- **Terminal Process Manager** — `ProcessManager` supporting foreground and background process tracking, ring-buffer stdout/stderr logging, PID lookup, signal dispatch (`SIGINT`, `SIGTERM`, `SIGKILL`), and agent shutdown cleanup.
- **Searchable Tool Registry & 5-Stage Discovery** — `ToolRegistry` and `ToolDiscoveryPipeline`: registers 100+ tools, filters via capabilities and permissions, scores by semantic relevance, and bounds prompt schema output strictly within token budgets ($\le 2000$ tokens).
- **ADR** — [`docs/decisions/0007-action-system-p4a-registry-discovery-sandbox.md`](docs/decisions/0007-action-system-p4a-registry-discovery-sandbox.md).

---

## Test suite status

Run: 2026-10-08. `npx tsc --noEmit` clean.

| Suite | Command | Result |
|:---|:---|:---:|
| **V2 P4A (new, 6 tests)** | `npm run test:v2p4a` | ✅ 6/6 |
| **V2 P3 (9 tests)** | `npm run test:v2p3` | ✅ 9/9 |
| **V2 P2 (11 tests)** | `npm run test:v2p2` | ✅ 11/11 |
| **V2 P1 (9 tests)** | `npm run test:v2p1` | ✅ 9/9 |
| Memory (V1) | `npm run test:memory` | ✅ |
| Runtime (V1) | `npm run test:runtime` | ✅ |
| Context + memory (V1) | `npm run test:context_memory` | ✅ |
| Tools (V1) | `npm run test:tools` | ✅ |
| Tools legacy (V1) | `npm run test:tools_legacy` | ✅ |
| Coding harness (V1) | `npm run test:harness` | ✅ |
| Background runtime (V1) | `npm run test:background` | ✅ |
| Reliability + security (V1) | `npm run test:security` | ✅ |
| Adaptive orchestration (V1) | `npm run test:orchestration` | ✅ |
| Delegation (V1) | `npm run test:delegation` | ✅ |
| Observability + evals (V1) | `npm run test:phase8` | ✅ |
| Observability (V1) | `npm run test:observability` | ✅ |
| Eval (V1) | `npm run test:eval` | ✅ |
| Adversarial eval (V1) | `npm run eval:adversarial` | ✅ (score 8/12 — see debt) |
| Verify (V1) | `npm run verify` | ✅ |
| **Self-evolution (V1)** | `npm run test:evolution` | ⚠️ **fails — pre-existing** (0/3 on `main` too) |

### P4A exit criteria — all PASS
1. 100+ tools registered $\rightarrow$ discovery ranks top tools $\rightarrow$ bounded prompt schema $\le 2000$ tokens — **PASS** (TEST 1)
2. Obfuscated attack payload unmasked $\rightarrow$ policy engine blocks before execution — **PASS** (TEST 2, TEST 4)
3. Sandboxed execution environment verified: symlink jail escape blocked, host secrets scrubbed, resource limits enforced — **PASS** (TEST 3)

### P3 exit criteria — all PASS
1. Injection payload written to memory is blocked or quarantined (adversarial test) — **PASS** (TEST 2)
2. Session search recalls an exact tool output from a past run (eval) — **PASS** (TEST 4)
3. `@repo` on a large repo stays within the context budget (test) — **PASS** (TEST 5)

### P2 exit criteria — all PASS
1. Create goal $\rightarrow$ plan $\rightarrow$ execute $\rightarrow$ kill process mid-flight $\rightarrow$ restart $\rightarrow$ resume $\rightarrow$ complete — **PASS** (TEST 5)
2. Execute $\rightarrow$ durable wait parked in `run_waits` $\rightarrow$ process exits $\rightarrow$ event published to EventBus $\rightarrow$ resume — **PASS** (TEST 6)
3. Chaos kill across 10 trials $\rightarrow$ zero duplicate side effects via idempotency keys — **PASS** (TEST 8)
4. Goal-level budgets enforced strictly above run budgets — **PASS** (TEST 9)

### P1 exit criteria — all PASS
1. Identity identical across restart, model switch, tool change — **PASS** (TEST 3)
2. Workspace switch never leaks memory or files — **PASS** (TEST 5, TEST 8)
3. Model-asserted fact stays `candidate` until validated — **PASS** (TEST 6)
4. V1 DB migrates cleanly on populated DB — **PASS** (TEST 2)


---

## Known issues & debt

| # | Item | Impact | Plan |
|---|:---|:---|:---|
| 1 | `test:evolution` race: `Scheduler.tick()` doesn't await the worker pool, so the test asserts `triggeredPrompt` before the runner fires | Test fails deterministically (**0/3 on `main` baseline** — not a V2 regression) | Fix as a small separate hygiene commit if approved |
| 2 | Committed adversarial report (`src/tests/evals/results/adversarial_report.*`) is **stale**: shows 100% from a 3-scenario mock suite; current 12-scenario suite scores **67% (8/12) on both `main` and `athena-v2`** (identical → no regression) | Report misleading; scores vary slightly run-to-run (LLM-dependent checks) | Regenerate + commit separately when the eval suite is next touched |
| 3 | `.todo.md` is **tracked in git** despite being treated as local scratch | Updated locally but excluded from phase commits per working rule | User decision: commit it, or `git update-index --skip-worktree .todo.md` |
| 4 | Untracked root duplicates `athena_v2_build_plan.md` / `athena_v2_theory.md` (committed copies live in `docs/architecture/`) | Clutter only | Delete on request |
| 5 | Editing `SOUL.md` after first seed doesn't change an existing profile (rendering is profile-driven by design) | Live identity can drift from the file | Possible import/CLI path in a later phase |
| 6 | `ToolExecutor` confirmation prompt works only when a `confirm` callback is provided; direct executor calls (tests/tools) prompt per call | Conservative default | Revisit with HITL approvals in P11 |

---

## Working agreements (per build plan)

1. AUDIT → PLAN → BUILD → TEST → REPORT per phase; **stop and wait for written approval** before each new phase.
2. Extend V1, never rebuild; no placeholders or fake capabilities — mark `experimental` / `unsupported` in the capability registry instead (registry lands with a later phase).
3. Migrations, tests (unit/integration/failure/security/recovery), phase E2E scenarios, and eval cases ship **with** each phase.
4. Full existing suite must stay green; every exit criterion reported pass/fail explicitly.
5. Never commit `.env`, secrets, `state.db`; commits only at phase completion; only on `athena-v2` — no merges/rebases/force-pushes/deletions without permission.
6. No UI work.
