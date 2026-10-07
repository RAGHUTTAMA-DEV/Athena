# Athena V2 — Implementation Status

> **Snapshot:** 2026-10-07 · **Branch:** `athena-v2` · **Plan (source of truth):** [`docs/architecture/athena_v2_build_plan.md`](docs/architecture/athena_v2_build_plan.md)
> Full historical tracker: [`roadmap.md`](roadmap.md) · Local scratch: `.todo.md` (not committed)

---

## Where things stand right now

| | |
|---|---|
| **Current phase** | **P2: Persistent Autonomy — ✅ COMPLETE** |
| **Next phase** | P3: Memory and Context — ⏳ **awaiting written approval** (not started) |
| **Working rule** | One phase at a time. Code only after plan approval; commit only at phase completion; no next phase without written approval. |
| **Regressions** | None. Full V1 & V2 test suites green (see [Test suite status](#test-suite-status)) |

---

## Phase status

V2 phases are **P1–P13** (distinct from V1's "Phase 1–8").

| Phase | Scope | Status | Evidence |
|:---|:---|:---:|:---|
| **V1 baseline** | Phases 1–8: runtime, memory, tools, orchestration, harness, background, security, observability/evals | ✅ shipped | `roadmap.md`, commits on `main` |
| **P1** | **Agent Foundation** — versioned migrations, AgentProfile + version history, User model, Workspace/Project entities, candidate memory lifecycle, permission model, store interfaces | ✅ **done** (`6846f5c`) | `npm run test:v2p1` — 9/9 |
| **P2** | **Persistent Autonomy** — Goal/Task entities, extended run lifecycle (12 states), `run_waits`, crash-safe resume, per-goal budgets, Goal→Task→Run spans, background safe tool guard | ✅ **done** | `npm run test:v2p2` — 11/11 |
| **P3** | Memory and Context | ⏳ awaiting approval | — |
| **P4** | Action System | ⛔ not started | — |
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

---

## Test suite status

Run: 2026-10-07. `npx tsc --noEmit` clean.

| Suite | Command | Result |
|:---|:---|:---:|
| **V2 P2 (new, 11 tests)** | `npm run test:v2p2` | ✅ 11/11 |
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
