# 🏛️ Athena: Autonomous Multi-Tool AI Agent System

[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![Playwright](https://img.shields.io/badge/Playwright-2EAD33?style=for-the-badge&logo=playwright&logoColor=white)](https://playwright.dev/)
[![MCP](https://img.shields.io/badge/MCP-Model%20Context%20Protocol-blue?style=for-the-badge&logo=probot)](https://modelcontextprotocol.io/)
[![Langfuse](https://img.shields.io/badge/Langfuse-000000?style=for-the-badge&logo=langfuse&logoColor=white)](https://langfuse.com/)
[![OpenTelemetry](https://img.shields.io/badge/OpenTelemetry-425CC7?style=for-the-badge&logo=opentelemetry&logoColor=white)](https://opentelemetry.io/)

**Athena** is a production-grade, local-first autonomous AI agent system engineered in TypeScript. Designed for reliability, safety, and long-running execution, Athena pairs local machine access (terminal, filesystem, browser automation, Python sandbox) with **adaptive multi-phase orchestration**, **hierarchical run state and recovery**, **multi-scope persistent memory**, **circuit-breaker-protected tool runtimes**, **dedicated coding harness bridge**, **durable background event scheduling**, **multi-layered security and prompt defense**, and **deep OpenTelemetry/Langfuse observability with trajectory replay debugging**.

---

## 📹 Demo

> 🎬 **Watch Athena in Action**:

<video src="https://github.com/user-attachments/assets/a110cbc1-b913-4703-a54e-3c84bafeb9ab" controls width="100%"></video>

[🎥 Watch Demo Video](https://github.com/user-attachments/assets/a110cbc1-b913-4703-a54e-3c84bafeb9ab)

---

## 📋 Table of Contents

- [📹 Demo](#-demo)
- [💡 Core Philosophy](#-core-philosophy)
- [🚀 Architecture Phases (Phases 1–8 Implemented)](#-architecture-phases-phases-18-implemented)
- [✨ Key Features & Capabilities](#-key-features--capabilities)
  - [1. Agent Runtime & Durable Execution (Phase 1)](#1-agent-runtime--durable-execution-phase-1)
  - [2. Context Engine & Multi-Scope Memory (Phase 2)](#2-context-engine--multi-scope-memory-phase-2)
  - [3. Resilient Tool Runtime (Phase 3)](#3-resilient-tool-runtime-phase-3)
  - [4. Adaptive Orchestration & Self-Repair (Phase 4)](#4-adaptive-orchestration--self-repair-phase-4)
  - [5. Coding Harness Integration (Phase 5)](#5-coding-harness-integration-phase-5)
  - [6. Background Event Runtime & Worker Pool (Phase 6)](#6-background-event-runtime--worker-pool-phase-6)
  - [7. Reliability, Security & Policy Engine (Phase 7)](#7-reliability-security--policy-engine-phase-7)
  - [8. Observability, Telemetry & Replay Debugger (Phase 8)](#8-observability-telemetry--replay-debugger-phase-8)
  - [9. Model Context Protocol (MCP) Integration](#9-model-context-protocol-mcp-integration)
- [🛠️ Comprehensive Built-in Toolset](#️-comprehensive-built-in-toolset)
- [🏗️ System Architecture & Structure](#️-system-architecture--structure)
  - [📐 System Architecture Diagram](#-system-architecture-diagram)
  - [📂 Directory & File Structure](#-directory--file-structure)
- [⚡ Quick Start & Getting Started](#-quick-start--getting-started)
  - [Prerequisites](#prerequisites)
  - [1. Clone & Install Dependencies](#1-clone--install-dependencies)
  - [2. Configure Environment Variables](#2-configure-environment-variables)
  - [3. Build the Project](#3-build-the-project)
- [🧠 Multi-LLM Provider Architecture](#-multi-llm-provider-architecture)
  - [Supported Providers](#supported-providers)
  - [Automatic Outage Failover & Fallback](#automatic-outage-failover--fallback)
  - [Runtime Provider Switching](#runtime-provider-switching)
- [🔌 Model Context Protocol (MCP) Setup & Configuration](#-model-context-protocol-mcp-setup--configuration)
  - [1. Configuration File (`mcp_servers.json`)](#1-configuration-file-mcp_serversjson)
  - [2. Supported Transport Modes](#2-supported-transport-modes)
  - [3. How MCP Integration Works Under the Hood](#3-how-mcp-integration-works-under-the-hood)
- [💻 Usage & CLI Commands](#-usage--cli-commands)
  - [Start the Interactive CLI](#start-the-interactive-cli)
  - [Autonomous Unattended Execution (`--allow-all`)](#autonomous-unattended-execution---allow-all)
  - [In-CLI Commands Cheat Sheet](#in-cli-commands-cheat-sheet)
  - [Start the Telegram Gateway](#start-the-telegram-gateway)
- [🧪 Manual Feature Test Prompts](#-manual-feature-test-prompts)
- [📊 Evaluation & Benchmark Suite](#-evaluation--benchmark-suite)
  - [1. Running the Trajectory Benchmarks](#1-running-the-trajectory-benchmarks)
  - [2. Adversarial Security Evaluation](#2-adversarial-security-evaluation)
  - [3. CI/CD Regression Gate](#3-cicd-regression-gate)
- [🧪 Test Suite & Verification Commands](#-test-suite--verification-commands)
- [📜 License](#-license)

---

## 💡 Core Philosophy

### 💻 1. Local-First Machine Native Access
Athena runs directly on your local developer environment with hands-on capabilities:
* **Local Terminal Execution**: Runs shell commands, scripts, git workflows, and system tools via `terminal`.
* **Direct Filesystem Management**: Inspects, reads, writes, and surgical-edits workspace files (`readFile`, `filesystem`, `replaceFileContent`, `grepSearch`).
* **Python Sandbox**: Executes local Python code for analytics, math, and data processing (`executePython`).
* **Interactive Headless Browser**: Automates Chromium via Playwright for live DOM interaction, element clicking/typing, and screenshot capture (`browser`, `browserNavigate`, `browserAction`, `browserScreenshot`).

### 🌱 2. Adaptive Complexity & Resilience First
Athena prioritizes **reliability and recoverability over raw token counts**:
* **Adaptive Orchestration**: Simple requests use a fast direct tool loop with zero planning token overhead. Complex requests automatically decompose into a **Plan DAG**, run acceptance verifications, and trigger self-repair loops.
* **Cooperative Cancellation & Run Resumption**: Any long-running task can be interrupted cleanly via `Ctrl+C` and resumed later from SQLite checkpoints using `/resume <runId>`.
* **Deep Security Guardrails**: Dual-boundary prompt injection defense, recursive secret redacting, and a centralized policy engine prevent unintended access to sensitive files or destructive shell commands.
* **Continuous Self-Evolution**: Dynamic procedural skill learning (`skills/`) and multi-scope episodic memory allow Athena to grow alongside you.

---

## 🚀 Architecture Phases (Phases 1–8 Implemented)

Athena is engineered as a multi-tier modular architecture across 8 fully implemented and verified phases:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Athena Autonomous Runtime                       │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
 ┌─────────────────────────────────┴─────────────────────────────────┐
 │ Phase 1: Authoritative RunState, Budgets & Resumption             │
 ├───────────────────────────────────────────────────────────────────┤
 │ Phase 2: ContextEngine, Multi-Scope Memory & Contradiction Logic │
 ├───────────────────────────────────────────────────────────────────┤
 │ Phase 3: Resilient ToolRuntime, Circuit Breakers & Offloading     │
 ├───────────────────────────────────────────────────────────────────┤
 │ Phase 4: Adaptive Orchestrator, TaskClassifier & Self-Repair DAG  │
 ├───────────────────────────────────────────────────────────────────┤
 │ Phase 5: Coding Harness Bridge, Git Snapshots & Acceptance Gate   │
 ├───────────────────────────────────────────────────────────────────┤
 │ Phase 6: Scheduler (Timezones), EventBus & Priority WorkerPool    │
 ├───────────────────────────────────────────────────────────────────┤
 │ Phase 7: PolicyEngine, PromptDefense & Credential Isolation       │
 ├───────────────────────────────────────────────────────────────────┤
 │ Phase 8: Telemetry Alignment, Replay Debugger & Adversarial Suite │
 └───────────────────────────────────────────────────────────────────┘
```

---

## ✨ Key Features & Capabilities

### 1. Agent Runtime & Durable Execution (Phase 1)
* **Authoritative `RunState` Model**: Explicit lifecycle tracking (`queued` ➔ `running` ➔ `waiting` ➔ `verifying` ➔ `completed` / `failed` / `cancelled`) persisted transactionally to SQLite (`runs` and `run_events`).
* **Sub-Agent Run Tree Hierarchy**: Explicit parentage tracking with `runId`, `parentRunId`, and `rootRunId` across nested delegation trees.
* **Typed `AgentEvent` Stream**: Real-time event emission for status transitions, turns, thoughts, tool executions, sub-agent spawning, plan updates, and budget alerts via `AgentEventEmitter`.
* **Cooperative Cancellation**: `CancellationTokenSource` creates hierarchical cancellation tokens that cleanly abort LLM generation, child processes, sub-agents, and tools on `Ctrl+C`.
* **Interrupted Run Resumption**: Resume paused, failed, or interrupted runs with full turn history and state via `/resume <runId>` and `agent.resumeRun(runId)`.
* **Multi-Resource Budget Engine**: Bounded execution with strict limits on `maxTimeMs`, `maxTokens`, `maxCostUsd`, `maxToolCalls`, `maxTurns`, and child sub-agent allocations.
* **Idempotency Tagging**: Side-effect tool calls generate unique idempotency keys to prevent accidental duplicate actions upon retry.

### 2. Context Engine & Multi-Scope Memory (Phase 2)
* **Unified Context Pipeline**: `ContextEngine` dynamically budgets and synthesizes system prompt instructions, workspace state, relevant scoped memory, and active conversation history within model token limits.
* **Multi-Scope Memory Model**:
  - `global`: Universal knowledge and user preferences across all projects.
  - `user`: User-specific metadata, contact info, and constraints.
  - `workspace`: Working directory facts, repo layout, and tooling conventions.
  - `project`: Project goals, milestones, and architectural decisions.
  - `session`: Current conversation thread history.
  - `task`: Ephemeral context dedicated to an active sub-task.
* **Memory Provenance & Confidence**: Every memory record tracks origin `runId`, source type (user message / tool execution / subagent finding), timestamp, and calibrated confidence score (0.0 to 1.0).
* **Contradiction Resolution & Lifecycle**: Full lifecycle tracking (`active` ➔ `confirmed` ➔ `contradicted` ➔ `superseded` ➔ `deleted`) with bidirectional `supersededBy` and `supersedes` pointers when new facts invalidate older ones.
* **User Memory Controls**: Interactive CLI commands (`/memory inspect`, `/memory scopes`, `/memory forget <id>`, `/memory purge <scope>`).
* **Skill Registry Intelligence**: Tracks procedural skill versions, invocation counts, and success rates in SQLite.

### 3. Resilient Tool Runtime (Phase 3)
* **Standardized `ToolResult<T>` Envelope**: Unified return structure across all tools:
  ```typescript
  interface ToolResult<T> {
    success: boolean;
    data?: T;
    error?: { code: string; message: string };
    retryable: boolean;
    metadata?: Record<string, any>;
  }
  ```
* **Tool Manifests**: Every tool declares permissions (`fs:read`, `fs:write`, `cmd:exec`, `browser`, `memory`, `system`), risk levels (`safe`, `confirm`, `destructive`), timeout policies, and `parallelSafe` concurrency flags.
* **Central Timeout Policies**: Fine-grained per-tool execution timeouts (5s math, 15s search, 45s browser, 60s terminal) with cooperative cancellation tokens.
* **Circuit Breaker Registry**: Protects against flaky MCP servers or failing remote APIs with automatic state transitions (`closed` ➔ `open` ➔ `half-open` ➔ `closed`), failure thresholds, and recovery cooldowns.
* **Semantic Schema Validation**: Validates parameter types and required fields against JSON Schema definitions prior to tool invocation.
* **Large Output Offloading**: Payloads exceeding 16KB are automatically offloaded to disk artifacts (`scratch/artifacts/`), returning structured preview envelopes with artifact paths to avoid blowing out model context windows.
* **Dynamic Tool Pruning (`ToolSelector`)**: Intent-based filter that dynamically prunes 20+ registered tools down to relevant subsets for the current turn.

### 4. Adaptive Orchestration & Self-Repair (Phase 4)
* **Task Complexity Classification**: Zero-token-overhead heuristic router (`TaskClassifier`) assigning complexity classes:
  - `simple`: Direct tool loop with zero planning overhead.
  - `medium`: Standard loop with state checkpointing and focused context.
  - `complex`: Formal DAG decomposition and dependency scheduling.
  - `high_risk`: Mandatory verification gate and human-in-the-loop confirmation.
* **Plan DAG Engine**: Decomposes complex tasks into directed acyclic step graphs (`PlanDAG`, `PlanStep`) with dependency resolution and step-level status tracking.
* **Dynamic Escalation Engine**: Automatically escalates execution mode (`simple` ➔ `medium` ➔ `complex`) upon detecting repeated tool failures or lack of convergence.
* **Verification Gate**: Evaluates task completion against acceptance criteria, scoring responses and flagging defects.
* **Self-Repair Diagnostic Loop**: Re-prompts the model with structured diagnostic feedback when verification checks flag missing requirements or broken tests.

### 5. Coding Harness Integration (Phase 5)
* **Zero-Duplicate Architecture**: Athena orchestrates complex repository modifications via an external Coding Harness process bridge (`CodingHarnessBridge`) without duplicating sandbox or git logic.
* **Typed Communication Protocol**:
  - `CodingTaskRequest`: `{ runId, task, cwd, traceId, maxIterations, timeoutSec, constraints, autoSnapshot }`
  - `CodingTaskResult`: `{ status, summary, filesChanged, testsPassed, diff, checkpointId, stdout, stderr, error, durationMs }`
* **Shared Trace & Run ID**: Propagates Athena `runId` via `--trace-id` for end-to-end telemetry correlation.
* **Live Event Streaming**: Streams child process thoughts, tool calls, and test runs directly into Athena's terminal UI and event stream.
* **Repository Intelligence (`inspectRepo`)**: Auto-detects package managers (`npm`, `yarn`, `pnpm`, `bun`, `pip`, `cargo`), test runners, and git branch status.
* **Git Snapshots & Automatic Rollback**: Automatically creates pre-execution git snapshots and rolls back workspace state if verification tests fail.
* **Coding Acceptance Gate**: Verifies exit status, changed file paths, and test execution outcomes before declaring success.

### 6. Background Event Runtime & Worker Pool (Phase 6)
* **Durable Task Scheduler**: Persistent cron and timer engine stored in SQLite that survives system restarts (`Scheduler`).
* **Full IANA Timezone Support**: Schedule jobs with complete timezone awareness (`America/New_York`, `Asia/Kolkata`, `UTC`, etc.) using native `Intl.DateTimeFormat`.
* **Atomic Job Leases / Distributed Locks**: SQLite-backed lease manager (`JobLeaseManager`) with auto-heartbeat renewal and stale lease takeover, preventing duplicate executions across worker processes.
* **Decoupled Event Bus (`EventBus`)**: Wildcard topic subscription (`*`, `timer:*`, `webhook:*`) with sliding-window idempotency deduplication and an audit trail in `event_log`.
* **Priority Worker Pool (`WorkerPool`)**: Asynchronous task runner with configurable concurrency (`ATHENA_WORKER_CONCURRENCY`) and priority queues (`critical` > `high` > `normal` > `low`).

### 7. Reliability, Security & Policy Engine (Phase 7)
* **Central Policy Engine (`PolicyEngine`)**: Rule-based security gatekeeper:
  - Blocks access to sensitive paths (`.env`, `id_rsa`, `.ssh/`, `credentials.json`, `client_secret*.json`).
  - Enforces workspace boundaries against directory traversal (`../`).
  - Restricts destructive commands (`rm -rf /`, `del /s /q C:\`, fork bombs, drive formatting).
* **Prompt-Injection Dual-Boundary Defense (`PromptDefense`)**:
  - Disarms instruction overrides, jailbreaks, and delimiter escapes.
  - Sanitizes and isolates external web pages, emails, and external files inside strict `<untrusted_content>` tags.
* **Recursive Credential Redaction (`CredentialManager`)**: Automatically detects and redacts secrets (Gemini, OpenAI, NVIDIA, Telegram, AWS, GitHub tokens, Bearer tokens) across all tool outputs, trace spans, and histories.
* **Multi-Provider Fallback**: Automatic failover (e.g., Gemini ➔ NVIDIA NIM / OpenAI) on HTTP 429 rate limits, 500/503 outages, or connection resets with primary cooldown circuit breaker.
* **Structured Failure Taxonomy & Recovery**: Tailored backoff, retry, and recovery strategies for `rate_limit`, `provider_outage`, `network_reset`, `timeout`, `auth`, and `policy_violation`.

### 8. Observability, Telemetry & Replay Debugger (Phase 8)
* **OpenTelemetry & Langfuse Trace Alignment**: Unified trace and span hierarchies linking Athena Core, child sub-agents, Coding Harness processes, and background workers into a single observability tree.
* **Trajectory Replay Debugger (`TrajectoryReplayer`)**:
  - Replay past run trajectories step-by-step from persisted events.
  - Inspect timestamps, tool invocations, success/failure counts, and execution latency.
  - Trajectory diffing (`/replay <runId> --diff <otherRunId>`) to detect divergence between runs.
  - Markdown post-mortem export (`/replay <runId> --export <path>`).
* **Adversarial Security Evaluation Suite**: Built-in benchmark harness (`npm run eval:adversarial`) evaluating resilience against prompt injection, memory poisoning, directory traversal, and unauthorized tool invocation with defense scorecards.

### 9. Model Context Protocol (MCP) Integration
* Connects external tool servers (Gmail, Notion, Slack, GitHub, Postgres, Filesystem, Brave Search) seamlessly via `stdio`, `sse`, `http`, or `streamable-http`.
* Automatic Gemini schema sanitization (`cleanGeminiSchema`) converts raw JSON schemas into compliant function declarations.
* Server-namespaced tool registration (e.g. `[MCP: filesystem]`).

---

## 🛠️ Comprehensive Built-in Toolset

| Tool | Category | Description | Permissions | Risk Level |
| :--- | :--- | :--- | :--- | :--- |
| `delegate_task` | Orchestration | Spawns an isolated sub-agent with scoped tools, budget cap, and depth guards | `system` | `safe` |
| `delegateCodingTask` | Coding | Delegates repository coding tasks to the Coding Harness with git snapshots and rollback | `cmd:exec`, `system` | `confirm` |
| `browser` | Web | Headless Chromium web browsing, text extraction, and page navigation | `browser` | `safe` |
| `browserNavigate` | Web | Interactive browser navigation to URLs | `browser` | `safe` |
| `browserAction` | Web | Interactive browser DOM action (click, type, press, scroll) using element IDs | `browser` | `safe` |
| `browserScreenshot` | Web | Captures full or viewport screenshots of web pages for visual verification | `browser` | `safe` |
| `searchWeb` | Search | Live web search powered by DuckDuckGo and Yahoo fallback | `browser` | `safe` |
| `terminal` | System | Shell command execution with timeout policies, maxBuffer, and cwd control | `cmd:exec` | `confirm` |
| `writeFile` | Filesystem | Writes or overwrites file contents on the local filesystem | `fs:write` | `confirm` |
| `deleteFile` | Filesystem | Deletes a file on the local filesystem | `fs:write` | `confirm` |
| `listFiles` | Filesystem | Lists files and directories with depth limits and hidden file filters | `fs:read` | `safe` |
| `replaceFileContent` | Filesystem | Surgical search-and-replace for existing files without whole-file rewrites | `fs:write` | `safe` |
| `grepSearch` | Filesystem | Fast recursive regex codebase search with line numbers and file filters | `fs:read` | `safe` |
| `readFile` | Filesystem | Reads file contents with line slicing (`startLine`, `endLine`) and output offloading | `fs:read` | `safe` |
| `executePython` | Execution | Executes Python code in a local subprocess sandbox | `cmd:exec` | `confirm` |
| `calculate` | Utility | Mathematical expression evaluation | `system` | `safe` |
| `cronjob` | Scheduler | Persistent scheduled tasks with IANA timezones, priorities, and one-shot/cron triggers | `system` | `safe` |
| `skillManage` | Learning | Creates, lists, reads, and edits reusable procedural skills in `skills/` | `fs:write`, `fs:read` | `safe` |
| `semanticMemory` | Memory | Queries, updates, reinforces, or resolves scoped memories across scopes | `memory` | `safe` |
| `systemTime` | Utility | Returns current machine date, time, and timezone | `system` | `safe` |
| *Dynamic MCP Tools* | Dynamic | Discovered dynamically from declared servers in `mcp_servers.json` | *Dynamic* | *Dynamic* |

---

## 🏗️ System Architecture & Structure

### 📐 System Architecture Diagram

![Athena Architecture Diagram](assets/athena_architecture.png)

### 📂 Directory & File Structure

```
Athena/
├── .github/
│   └── workflows/
│       └── eval-benchmark.yml         # CI/CD benchmark regression gate
├── assets/                            # Media, demo videos & architecture diagrams
│   ├── videos/
│   │   ├── Athena.mp4                 # Athena demo video
│   │   └── Coding-Harness.mp4         # Coding harness demo video
│   └── athena_architecture.png        # Architecture diagram
├── docs/                              # Architecture blueprints, guides & learnings
│   ├── architecture/                  # Multi-phase system specifications
│   ├── guides/                        # Tool & browser automation guides
│   ├── roadmap/                       # Strategic development roadmap
│   └── learnings.md                   # Technical insights & post-mortems
├── skills/                            # Dynamic procedural skill markdown guides (.md)
├── src/
│   ├── index.ts                       # CLI entrypoint, command router, MCP loader & lifecycle
│   ├── cli/
│   │   └── ui.ts                      # ANSI terminal UI, spinners, rails & frame renderers
│   ├── core/                          # Core Runtime Engine
│   │   ├── agent.ts                   # Main Agent loop, resumption & turn controller
│   │   ├── cancellation.ts            # Cooperative CancellationTokenSource & signals
│   │   ├── codingHarness.ts           # Dedicated Coding Harness Bridge & git snapshots
│   │   ├── codingHarnessTypes.ts      # Typed harness request/response protocol
│   │   ├── consolidation.ts           # Background memory summarizer & consolidator
│   │   ├── contextEngine.ts           # Multi-scope prompt budgeting pipeline
│   │   ├── credentialManager.ts       # Recursive secret redactor & isolation
│   │   ├── eventBus.ts                # Decoupled EventBus with wildcard routing & dedup
│   │   ├── events.ts                  # Strongly typed AgentEvent definitions
│   │   ├── failureRecovery.ts         # Failure taxonomy & recovery strategies
│   │   ├── instrumentation.ts         # Langfuse & OpenTelemetry bootstrap
│   │   ├── jobLease.ts                # Distributed SQLite job leases & heartbeat locks
│   │   ├── llmProvider.ts             # Multi-provider abstraction & automatic fallback
│   │   ├── mcpManager.ts              # MCP client transports (stdio, sse, http) & schema cleaner
│   │   ├── memory.ts                  # SQLite Episodic, Scoped & RunState storage
│   │   ├── memoryTypes.ts             # Scoped memory, provenance & lifecycle models
│   │   ├── orchestration.ts           # TaskClassifier, Plan DAG & VerificationGate
│   │   ├── policyEngine.ts            # Sensitive file & dangerous command policy gatekeeper
│   │   ├── procedural.ts              # Procedural skill directory loader
│   │   ├── promptDefense.ts           # Dual-boundary prompt injection defense
│   │   ├── replayDebugger.ts          # Trajectory Replayer, diffing & export
│   │   ├── runState.ts                # Authoritative RunState & resource budget model
│   │   ├── scheduler.ts               # Durable task scheduler with timezone support
│   │   ├── telemetry.ts               # Unified OpenTelemetry / Langfuse trace aligner
│   │   ├── toolRuntime.ts             # ToolResult envelope, circuit breakers & offloading
│   │   ├── types.ts                   # Core interfaces, Message, Tool & Provider types
│   │   └── workerPool.ts              # Priority background worker pool & concurrency
│   ├── gateway/
│   │   └── telegram.ts                # Telegram Bot Gateway (Telegraf)
│   ├── prompts/
│   │   ├── index.ts                   # System prompt exports
│   │   └── agentPrompt.ts             # Master agent system prompt template
│   ├── tests/                         # Verification & Test Suites
│   │   ├── evals/                     # Evaluation benchmark harnesses
│   │   │   ├── runBenchmark.ts        # Trajectory benchmark runner & reporter
│   │   │   ├── adversarialRunner.ts   # Adversarial security benchmark runner
│   │   │   ├── checks.ts              # Deterministic side-effect & trajectory assertions
│   │   │   ├── datasets/              # Benchmark & adversarial test datasets
│   │   │   └── results/               # Baseline results & regression reports
│   │   ├── test_phase1_runtime.ts     # Phase 1: RunState, budgets, cancellation, resume
│   │   ├── test_phase2_context_memory.ts # Phase 2: ContextEngine, scopes, contradiction
│   │   ├── test_phase3_tools.ts       # Phase 3: ToolResult, circuit breaker, offloading
│   │   ├── test_phase4_adaptive_orchestration.ts # Phase 4: Classifier, Plan DAG, repair
│   │   ├── test_phase4_delegation.ts  # Phase 4: Sub-agent scoping & depth limits
│   │   ├── test_phase5_coding_harness.ts # Phase 5: Harness bridge, snapshots, gates
│   │   ├── test_phase6_background_runtime.ts # Phase 6: Scheduler, leases, event bus, workers
│   │   ├── test_phase7_reliability_security.ts # Phase 7: Policy, injection defense, secrets
│   │   ├── test_phase8_observability_eval.ts # Phase 8: Telemetry, replay, adversarial
│   │   └── verify.ts                  # Core system smoke verification
│   └── tools/                         # Registered Agent Tools
│       ├── index.ts                   # Tool exports & manifest initialization
│       ├── browser.ts                 # Playwright browser integration
│       ├── interactiveBrowser.ts      # Element ID navigation, actions & screenshots
│       ├── calculate.ts               # Math evaluator
│       ├── cronjob.ts                 # Scheduler tool with timezone and priority
│       ├── delegateCodingTask.ts      # Coding harness bridge tool
│       ├── delegateTask.ts            # Sub-agent task delegator
│       ├── editFile.ts                # Surgical replaceFileContent tool
│       ├── executePython.ts           # Python runner
│       ├── filesystem.ts              # File read/write/delete/list tools
│       ├── grepSearch.ts              # Recursive regex search tool
│       ├── readFile.ts                # Line slicing read tool
│       ├── searchWeb.ts               # DuckDuckGo search tool
│       ├── semanticMemory.ts          # Scoped memory tool
│       ├── skillManage.ts             # Procedural skill tool
│       └── systemTime.ts              # Machine time tool
├── mcp_servers.json                   # MCP external server definitions
├── roadmap.md                         # Master architectural roadmap & progress
├── SOUL.md                            # Agent personality, tone & behavioral guidelines
├── state.db                           # SQLite database (Episodic memory, runs, cron, events)
└── package.json                       # Dependencies & npm scripts
```

---

## ⚡ Quick Start & Getting Started

### Prerequisites
* **Node.js**: `v18.0.0` or higher (Node 20+ recommended)
* **npm**: `v9.0.0` or higher
* **Python**: `3.9+` (optional, required only for `executePython`)
* **LLM API Key**: Google Gemini (recommended) or NVIDIA NIM / OpenAI-compatible key

### 1. Clone & Install Dependencies
```bash
git clone <repository-url>
cd Athena
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the project root:

```env
# ── LLM Provider Configuration ─────────────────────────────────────
# Provider: 'gemini' (default) or 'nvidia'
LLM_PROVIDER=gemini

# Google Gemini API (Default)
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

# NVIDIA NIM / OpenAI-Compatible API (Optional Fallback / Primary)
NVIDIA_API_KEY=your_nvidia_api_key_here
NVIDIA_MODEL=z-ai/glm-5.2
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# ── Agent Execution Settings ──────────────────────────────────────
MAX_TURNS=20
ATHENA_ALLOW_ALL=0                    # Set to 1 to bypass interactive HITL prompts
ATHENA_WORKER_CONCURRENCY=2           # Background worker concurrency limit
DATABASE_PATH=./state.db              # SQLite storage path

# ── Gateway Integrations (Optional) ───────────────────────────────
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# ── Observability & Telemetry (Optional) ───────────────────────────
LANGFUSE_PUBLIC_KEY=your_langfuse_public_key
LANGFUSE_SECRET_KEY=your_langfuse_secret_key
LANGFUSE_HOST=https://cloud.langfuse.com
```

### 3. Build the Project
```bash
npm run build
```

---

## 🧠 Multi-LLM Provider Architecture

Athena implements a decoupled `LLMProvider` abstraction layer ([`src/core/llmProvider.ts`](file:///c:/Users/raghu/Documents/Athena/src/core/llmProvider.ts)) that standardizes interactions across different model families:

### Supported Providers
| Provider | Backend Client | Features | Configuration Keys |
| :--- | :--- | :--- | :--- |
| **`gemini`** *(Default)* | `@google/genai` | Native function calling, system instructions, token usage tracking | `GEMINI_API_KEY`, `GEMINI_MODEL` |
| **`nvidia`** | `openai` | OpenAI-compatible tool calling, NVIDIA NIM endpoints, token tracking | `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `NVIDIA_BASE_URL` |

### Automatic Outage Failover & Fallback
Athena provides `FallbackLLMProvider`: when configured with secondary credentials, Athena will automatically fail over to a backup provider if the primary encounters rate limits (HTTP 429), outages (HTTP 500/503), or network connection resets, engaging an automatic recovery cooldown before probing the primary again.

### Runtime Provider Switching
Switch providers and models on the fly in the active CLI session:
```bash
# View active provider and model
/provider

# Switch to NVIDIA NIM with default model
/provider nvidia

# Switch to NVIDIA with a custom model
/provider nvidia meta/llama-3.1-70b-instruct

# Switch back to Gemini with a custom model
/provider gemini gemini-2.5-pro
```

---

## 🔌 Model Context Protocol (MCP) Setup & Configuration

Athena includes native support for Anthropic's **Model Context Protocol (MCP)**, connecting external tool servers directly into the agent's tool execution loop.

### 1. Configuration File (`mcp_servers.json`)
Declare external servers in [`mcp_servers.json`](file:///c:/Users/raghu/Documents/Athena/mcp_servers.json):

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:\\Users\\yourname\\Documents"]
    },
    "gmail": {
      "command": "npx",
      "args": ["-y", "@gongrzhe/server-gmail-autoauth-mcp"]
    },
    "notion": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://mcp.notion.com/sse"]
    }
  }
}
```

### 2. Supported Transport Modes
* **`stdio`**: Local subprocess (`npx`, `node`, `python`, `uvx`) via stdin/stdout.
* **`sse`**: Remote HTTP Server-Sent Events.
* **`streamable-http`**: Streaming HTTP transport.
* **`http`**: Standard HTTP request/response.

### 3. How MCP Integration Works Under the Hood
1. **Discovery**: On boot, `MCPManager` connects to declared servers and calls `client.listTools()`.
2. **Sanitization**: `cleanGeminiSchema` translates complex JSON schemas into 100% Gemini-compliant function declarations.
3. **Registration**: Tools are registered dynamically into `toolsRegistry` under namespaces (e.g., `[MCP: filesystem]`).
4. **Resilience**: MCP tool invocations are wrapped in Athena's `CircuitBreakerRegistry` to isolate failing servers.
5. **Teardown**: Graceful process signal handling (`SIGINT`/`SIGTERM`) cleanly disconnects all client processes.

---

## 💻 Usage & CLI Commands

### Start the Interactive CLI
```bash
# Standard interactive mode (with Human-in-the-Loop confirmation prompts)
npm run dev

# Or after building:
npm start
```

### Autonomous Unattended Execution (`--allow-all`)
Bypasses interactive confirmation prompts for high-risk tools:
```bash
# Dev mode with pre-approved tool confirmations
npm run dev:allowAll

# Production mode with pre-approved tool confirmations
npm run start:allowAll

# Or directly:
node dist/index.js --allow-all
```

### In-CLI Commands Cheat Sheet

| Command | Action |
| :--- | :--- |
| **Provider & Model** | |
| `/provider` | View active LLM provider and model |
| `/provider <gemini\|nvidia> [model]` | Dynamically switch provider and model at runtime |
| **Session Management** | |
| `/session list` (or `/sessions`) | List all stored SQLite sessions, turn counts, and activity |
| `/session switch <name>` (or `/switch <name>`) | Switch conversation to a specific session and load history |
| `/session create <name>` | Create a new isolated conversation session |
| `/session rename <name>` | Rename the currently active session |
| `/session delete <name>` | Delete conversation history for a session |
| `/session current` | Print active session name |
| `/session help` | Show session help frame |
| `clear` | Clear message history for the active session |
| **Run State & Resumption (Phase 1)** | |
| `/runs` | List recorded runs in the current session |
| `/runs all` | List all recorded runs across all sessions |
| `/runs <sessionId>` | List runs for a specific session |
| `/resume <runId>` | Resume an interrupted, paused, or failed run from persisted state |
| `Ctrl+C` | Gracefully cancel the active run using cooperative cancellation tokens |
| **Scoped Memory Controls (Phase 2)** | |
| `/memory inspect [query]` | Search and view active memory facts with confidence & lifecycle |
| `/memory scopes` | List available memory scopes (`global`, `user`, `workspace`, `project`, `session`, `task`) |
| `/memory forget <id>` | Soft-delete a specific memory fact by ID |
| `/memory purge <scope>` | Purge all facts belonging to a specific scope |
| `/memory help` | Show memory controls help frame |
| **Replay Debugger (Phase 8)** | |
| `/replay <runId>` | View step-by-step timeline, duration, turns, and tool stats |
| `/replay <runId> --diff <otherRunId>` | Compare two run trajectories to identify divergence and token deltas |
| `/replay <runId> --export [path]` | Export a detailed markdown post-mortem report for a run |
| `/replay help` | Show replay debugger help frame |
| **General** | |
| `exit` / `quit` | Cleanly disconnect MCP clients and exit |

### Start the Telegram Gateway
Run Athena as a remote Telegram Bot:
```bash
npm start -- telegram
```

---

## 🧪 Manual Feature Test Prompts

Use these prompts in the CLI (`npm run dev`) to test each capability:

| Capability | Prompt | Verification Check |
| :--- | :--- | :--- |
| **Memory Scopes** | Turn 1: `Remember that my preferred styling framework is Tailwind and currency is EUR.`<br>Turn 2: `What styling framework and currency do I prefer?` | Responds correctly from scoped memory; verify with `/memory inspect` |
| **Run Resumption** | Start a complex research query, press `Ctrl+C` mid-execution, run `/runs`, then run `/resume <runId>` | Run cancels cleanly on `Ctrl+C` and resumes from the exact checkpoint |
| **Replay Debugger** | Run a tool-heavy task, then execute `/replay <runId>` and `/replay <runId> --export scratch/postmortem.md` | Renders trajectory timeline and writes markdown report |
| **Coding Harness** | `Create a directory called demo-counter. Build a clean counter web app with HTML, CSS, and JS. Add tests and summarize what you did.` | Invokes `delegateCodingTask`, creates files, runs checks, commits snapshot |
| **Procedural Skills** | `Create a skill named "npm-outdated-audit" that runs npm outdated, parses packages, and summarizes security risks.` | Skill `.md` is written to `skills/` and registered |
| **Interactive Browser** | `Go to https://news.ycombinator.com, click on the top story, and report the title and destination URL.` | Uses `browserNavigate` and `browserAction` with element IDs |
| **Headless Browser** | `Open https://example.com in the browser tool and extract the header text.` | Playwright navigates and extracts DOM text cleanly |
| **Sub-Agent Delegation** | `Delegate two tasks in parallel: (1) search for TypeScript 5.8 features, (2) compute 3^12. Synthesize results.` | Spawns child sub-agents with scoped tools and aggregates findings |
| **Policy Guard** | `Read the file .env in the project root.` | PolicyEngine blocks access to `.env` as a protected credential path |
| **Persistent Scheduler** | `In 15 seconds, remind me in this session to take a stretch break.` | Job is scheduled in SQLite; notification fires in CLI ~15s later |
| **Surgical File Edit** | `In demo-note.txt, replace "old text" with "new text" without rewriting the file.` | Uses `replaceFileContent` with targeted diff replacement |
| **Codebase Grep** | `Search this repository for all occurrences of "ToolResult" and show matching file paths.` | Uses `grepSearch` and returns regex matches with line numbers |

---

## 📊 Evaluation & Benchmark Suite

Athena includes an automated trajectory benchmarking and regression gating framework ([`src/tests/evals/`](file:///c:/Users/raghu/Documents/Athena/src/tests/evals)) to evaluate agent accuracy, tool selection, trajectory length, and execution constraints across multiple runs.

### 1. Running the Trajectory Benchmarks
Standard multi-run trajectory benchmarks test tool usage, side-effect assertions, and turn efficiency:

```bash
# Run standard evaluation benchmark (N=3 runs per test case)
npm run eval:benchmark

# Run stress-test benchmark with custom repetitions (N=5 runs)
npm run eval:benchmark:runs
```

Test cases cover four core competency categories:
* **`coding`**: Python sandbox execution and filesystem operations.
* **`delegation`**: Sub-agent spawning via `delegate_task` / `delegateCodingTask`, tool scoping, and synthesis.
* **`memory`**: Cross-turn retrieval (`semanticMemory`), user preferences, and procedural skill generation.
* **`search`**: Live web searches (`searchWeb`) and Playwright browser navigation.

### 2. Adversarial Security Evaluation
Test the runtime's resilience against prompt injection, memory poisoning, directory traversal, and tool hijacking:

```bash
npm run eval:adversarial
```

Outputs a defense scorecard across multiple adversarial vectors:
* **Prompt Injection**: Disarming embedded instructions in untrusted web pages and files.
* **Memory Poisoning**: Preventing injection of fake system commands into memory.
* **Unauthorized File Access**: Validating policy blocking of `.env`, SSH keys, and system files.
* **Destructive Commands**: Confirming refusal of destructive shell operations.

### 3. CI/CD Regression Gate
* **Baseline Tracking (`latest.json`)**: Benchmark outcomes are saved to [`src/tests/evals/results/latest.json`](file:///c:/Users/raghu/Documents/Athena/src/tests/evals/results/latest.json). Subsequent runs compute pass rate deltas (`Delta%`) per category and flag flipped test cases (`Pass ➔ Fail`).
* **CI/CD Quality Gate**: Integrated GitHub Actions workflow ([`.github/workflows/eval-benchmark.yml`](file:///c:/Users/raghu/Documents/Athena/.github/workflows/eval-benchmark.yml)) automatically executes on pull requests, blocking merges that cause performance or accuracy regressions.

---

## 🧪 Test Suite & Verification Commands

Athena maintains an exhaustive, phase-by-phase automated test suite:

```bash
# ── Full Build & Smoke Verification ────────────────────────────────
npm run verify                  # Verify core system smoke tests

# ── Phase 1–8 Subsystem Test Suites ────────────────────────────────
npm run test:runtime            # Phase 1: RunState, lifecycle, budgets, cancellation & resume
npm run test:context_memory     # Phase 2: ContextEngine, multi-scope memory & contradictions
npm run test:tools              # Phase 3: ToolResult envelope, circuit breakers & offloading
npm run test:orchestration      # Phase 4: Adaptive orchestrator, Plan DAG & self-repair
npm run test:delegation         # Phase 4: Sub-agent tool scoping & depth safety caps
npm run test:harness            # Phase 5: Coding harness bridge, git snapshots & gates
npm run test:background         # Phase 6: Scheduler, IANA timezones, leases & worker pool
npm run test:security           # Phase 7: PolicyEngine, prompt defense & secret redactor
npm run test:phase8             # Phase 8: Telemetry alignment, replay debugger & diffing

# ── Benchmarks & Adversarial Evals ─────────────────────────────────
npm run eval:adversarial        # Adversarial security benchmark & defense scorecard
npm run eval:benchmark          # Trajectory benchmark regression suite (N=3 runs)
npm run eval:benchmark:runs     # Stress-test benchmark regression suite (N=5 runs)
npm run test:eval               # LLM-as-a-judge response quality evaluator
```

---

## 📜 License

Distributed under the ISC License. See `LICENSE` for details.
