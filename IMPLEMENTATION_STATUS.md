# Athena V2 — Implementation Status

> **Snapshot:** 2026-10-08 · **Branch:** `athena-v2` · **Plan (source of truth):** [`docs/architecture/athena_v2_build_plan.md`](docs/architecture/athena_v2_build_plan.md)
> Full historical tracker: [`roadmap.md`](roadmap.md) · Local scratch: `.todo.md` (not committed)

---

## Where things stand right now

| | |
|---|---|
| **Current phase** | **P5: Learning — ✅ COMPLETE** |
| **Next phase** | P6: Multi-Agent — ⏳ **awaiting written approval** (not started) |
| **Working rule** | One phase at a time. Code only after plan approval; commit only at phase completion; no next phase without written approval. |
| **Regressions** | None. Full V1, V2 P1, V2 P2, V2 P3, V2 P4A, V2 P4B, V2 P4C, V2 P4D, & V2 P5 test suites green (see [Test suite status](#test-suite-status)) |

---

## Phase status

V2 phases are **P1–P13** (distinct from V1's "Phase 1–8").

| Phase | Scope | Status | Evidence |
|:---|:---|:---:|:---|
| **V1 baseline** | Phases 1–8: runtime, memory, tools, orchestration, harness, background, security, observability/evals | ✅ shipped | `roadmap.md`, commits on `main` |
| **P1** | **Agent Foundation** — versioned migrations, AgentProfile + version history, User model, Workspace/Project entities, candidate memory lifecycle, permission model, store interfaces | ✅ **done** (`6846f5c`) | `npm run test:v2p1` — 9/9 |
| **P2** | **Persistent Autonomy** — Goal/Task entities, extended run lifecycle (12 states), `run_waits`, crash-safe resume, per-goal budgets, Goal→Task→Run spans, background safe tool guard | ✅ **done** | `npm run test:v2p2` — 11/11 |
| **P3** | **Memory and Context** — Memory model per spec (scopes `agent`, `goal`, types `fact`, `preference`, etc., lifecycle `quarantined`, `archived`), Section 65 Secure Memory Write Pipeline (sanitize, prompt injection quarantine, credential masking), Universal Session Search (FTS5 over messages, tool calls/outputs, plans, thoughts, errors), Bounded Context References (`@file`, `@folder`, `@repo`, `@run`, `@goal`, `@task`, `@memory`, `@project`), Cache-Friendly Layered ContextEngine, Token & Cost Accounting | ✅ **done** | `npm run test:v2p3` — 9/9 |
| **P4** | **Action System** — P4A: Registry, Discovery, ExecutionBackend, FS, Terminal ✅ · P4B: Research/RAG/Documents ✅ · P4C: Browser ✅ · P4D: Computer Use ✅ | ✅ **done** | `npm run test:v2p4a` — 6/6 · `npm run test:v2p4b` — 9/9 · `npm run test:v2p4c` — 9/9 · `npm run test:v2p4d` — 8/8 |
| **P5** | **Learning** — Progressive disclosure skills, review lifecycle, standing routines with EventBus/Scheduler triggers, distilled learned workflows from successful runs (not raw recordings) | ✅ **done** | `npm run test:v2p5` — 9/9 |
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

### Added by V2 P4B
- **Schema Migration 5** — `v2_p4b_research_rag_documents`: `vector_embeddings` (namespace, ref binding, JSON embedding, dims, model) and `research_documents` (source type/URI, content hash for dedupe, chunk/char counts, workspace binding).
- **`VectorStore` interface + `SqliteVectorStore`** — upsert/get/delete/deleteByRef/deleteByNamespace, cosine search with namespace/ref/dims/threshold filters; pgvector adapter deferred to P12 (ADR-0001 pattern). Companion `ResearchDocumentStore` tracks ingested sources.
- **`EmbeddingProvider`** — the V1 Gemini → OpenAI/NVIDIA embedding fallback chain extracted verbatim from `EpisodicMemory.generateEmbedding` into a replaceable provider; RAG reuses the same backend with zero behavior change.
- **Real Local Cross-Encoder Reranker** — `LocalCrossEncoderReranker` (`@huggingface/transformers`, `Xenova/ms-marco-MiniLM-L-6-v2`, in-process ONNX, `RERANKER_MODEL` env) scoring `(query, passage)` pairs. Eval proves measurable gain over a lexical TF baseline (keyword-stuffed distractor ranked 1st by TF → cross-encoder ranks the answering passage 1st, gold rank 2 → 1). When the model cannot load, the capability is marked `unsupported` with a reason and `rerank()` returns `null` — the pipeline skips the stage and reports `reranked: false` + skip reason (never a lexical fake).
- **Capability Registry (spec section 71)** — first formal registry in the codebase: `real | experimental | unsupported` + reason, seeded at boot with 11 P4B capabilities; `documents.ocr` is `experimental`, `rag.rerank` reflects true backend state.
- **Document Intelligence** — `DocumentParser` with real extractors: PDF (pdf-parse v2 / pdf.js), DOCX (mammoth), XLSX (sheetjs, per-sheet CSV), CSV (papaparse), HTML (script/style excluded), Markdown/text; images/scanned docs via tesseract.js OCR (`experimental`). Unparseable input throws — never fabricated text.
- **Structure-Aware Chunker** — heading → paragraph → sentence boundaries with overlap and coverage guarantees; large documents are always reduced to chunks and go through retrieval, never wholesale into context.
- **RAG Pipeline** — `RagEngine`: ingest (parse → chunk → embed → vector store, SHA-256 dedupe, changed-source replacement), retrieve (top-K×4 candidates), rerank (capability-gated cross-encoder), cited results with `retrievalScore`/`rerankScore`. Missing embedding provider ⇒ capability `unsupported` + typed error.
- **Research Pipeline** — `ResearchEngine`: search → retrieve → extract → reason → cross-check → synthesize → cite. Every finding labeled `source` / `inference` / `uncertainty` with 1-based citations and confidence; conflict detection surfaces differing values as `uncertainty`. All retrieved content passes PromptDefense (`analyzeAndSanitize`) before extraction — neutralized injections are noted and can never surface as finding content. Search/fetch functions are injectable (fixtures in tests, production defaults = V1 `searchWeb` + bounded fetch).
- **Tools** — `researchWeb`, `ingestDocument`, `searchDocuments`, `readDocument` registered through the P4A registry with manifests (`net:http`/`fs:read`/`memory`, risk `safe`); discovery capability keywords extended with `research`. `readDocument` enforces the context budget (bounded excerpt + retrieval chunks for focus queries; full text only for small docs).
- **Store Facade Extension** — `EpisodicMemory.getVectorStore() / getResearchDocumentStore() / getRagEngine() / getResearchEngine()` follow the established ADR-0001 delegation pattern.
- **ADR** — [`docs/decisions/0008-research-rag-documents-p4b.md`](docs/decisions/0008-research-rag-documents-p4b.md).

### Added by V2 P4C
- **Schema Migration 6** — `v2_p4c_browser_profiles`: `browser_profiles` table (id, agent_id, task_id, name, user_data_dir, cookies_count, metadata, timestamps) indexed by agent, task, and name.
- **`BrowserProfileStore` interface & `SqliteBrowserProfileStore`** — persistent profile metadata CRUD and agent/task queries behind the SQLite implementation (ADR-0001 pattern; PostgreSQL adapter in P12). Exposed on `EpisodicMemory.getBrowserProfileStore()`.
- **`BrowserProfileManager`** — manages persistent user data directories scoped per agent/task (`scratch/browser_profiles/<profileId>`); guarantees two agents never share cookies or local storage unless explicitly configured.
- **`BrowserEngine`** — manages Playwright persistent contexts (`launchPersistentContext`) keyed by profile; supports multi-tab management (`newTab`, `switchTab`, `closeTab`, `listTabs`), interactive element tagging (`data-athena-id`), modern ARIA accessibility tree snapshots (`ariaSnapshot` / `accessibility.snapshot`), form actions (selectOption, check, uncheck, uploadFile), download interception and scoped storage, cookie inspection/clearing, and screenshots.
- **PromptDefense Untrusted Boundary (Spec Section 19)** — all page content and extracted text passes through `PromptDefense.analyzeAndSanitize()`, actively neutralizing prompt injection attacks (`INSTRUCTION_OVERRIDE`, `PROMPT_LEAK_REQUEST`, etc.) and wrapping untrusted external web content in `<untrusted_content origin="...">` tags.
- **Capability Registry (spec section 71)** — 6 browser capabilities seeded: `browser.playwright` (`real` if Chromium binary is detected, `unsupported` if missing), `browser.profiles` (`real`), `browser.tabs` (`real`), `browser.interactive` (`real`), `browser.accessibility` (`real`), `browser.downloads` (`real`).
- **Tools Suite** — `browserNavigate`, `browserAction`, `browserTabManage`, `browserSessionManage`, `browserExtract`, `browserScreenshot` registered in `SearchableToolRegistry` with complete manifests (`permissions: ['browser', 'net:http']`, timeouts, risk levels). Backward-compatible re-exports in `interactiveBrowser.ts`.
- **ADR** — [`docs/decisions/0009-browser-first-class-environment-p4c.md`](docs/decisions/0009-browser-first-class-environment-p4c.md).

---

## Test suite status

Run: 2026-10-08. `npx tsc --noEmit` clean.

| Suite | Command | Result |
|:---|:---|:---:|
| **V2 P4C (new, 9 tests)** | `npm run test:v2p4c` | ✅ 9/9 |
| **V2 P4B (9 tests)** | `npm run test:v2p4b` | ✅ 9/9 |
| **V2 P4A (6 tests)** | `npm run test:v2p4a` | ✅ 6/6 |
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
| Adversarial eval (V1) | `npm run eval:adversarial` | ✅ (score 10/12 on this run — see debt) |
| Verify (V1) | `npm run verify` | ✅ |
| **Self-evolution (V1)** | `npm run test:evolution` | ⚠️ **fails — pre-existing** (0/3 on `main` too) |

### P4C exit criteria — all PASS
1. E2E navigate $\rightarrow$ authenticate $\rightarrow$ perform action $\rightarrow$ verify — **PASS** (TEST 8: navigate to login form $\rightarrow$ fill credentials $\rightarrow$ authenticate $\rightarrow$ verify dashboard $\rightarrow$ perform authenticated action $\rightarrow$ verify updated dashboard state)
2. Two agents never share cookies unless configured — **PASS** (TEST 2: Agent A logs in and receives session cookie; Agent B visits same origin in isolated profile and sees 0 cookies / unauthorized state)
3. All page content passes through PromptDefense as untrusted — **PASS** (TEST 7: malicious prompt injection payload actively neutralized and enclosed in `<untrusted_content origin="...">` boundary)

### P4B exit criteria — all PASS
1. Reranker eval shows measurable gain over retrieval-only on a fixed dataset — **PASS** (TEST 6: lexical TF baseline ranks the keyword-stuffed distractor 1st (p2=22 > p1=12); the local cross-encoder ranks the answering passage 1st (p1 0.456 > p2 0.130), gold rank 2 → 1; unsupported-model path verified in TEST 6b)
2. Research report cites sources and labels claims vs inferences (eval) — **PASS** (TEST 7: 4 cited sources; findings labeled `source`/`inference`/`uncertainty` with in-range citations; cross-source corroboration + conflict detection; injection neutralized and never surfaced)
3. 200-page PDF Q&A stays within context budget — **PASS** (TEST 8: 450,914-char document → 7,305 chars returned via bounded excerpt + retrieval chunks (budget 8,000), top chunk on-topic; full text never returned)

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
| 2 | Committed adversarial report (`src/tests/evals/results/adversarial_report.*`) was stale (100% from a 3-scenario mock suite) | Scores are LLM-dependent run-to-run | **Regenerated 2026-10-08 during P4B regression run — now reflects the current 12-scenario suite at 10/12 (83%), improved from the previously recorded 8/12.** Keep regenerating whenever the suite is next touched |
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
