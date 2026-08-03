# Hermes-Style Local Agent
### Architecture reference & phased build plan

**Stack decision:** TypeScript/Node — matches the existing agent harness project, avoids a rebuild, and keeps gateway/tools/memory/UI in one language.

---

## Contents
1. [What we're building](#1-what-were-building)
2. [Reference architecture (Hermes Harness)](#2-reference-architecture-hermes-harness)
3. [Full feature inventory](#3-full-feature-inventory)
4. [Sub-agent design (delegate_task)](#4-sub-agent-design-delegate_task)
5. [Phased build plan](#5-phased-build-plan)
6. [Suggested stack](#6-suggested-stack)

---

## 1. What we're building

A local, always-available agent system — not a single-session coding assistant, but a persistent assistant with:

- Access to multiple messaging channels (Telegram, WhatsApp, Slack, custom UI) hitting one agent core
- A tool layer that lets it act in the real world (terminal, browser, cron, MCP servers)
- Tiered memory that persists across sessions and improves itself over time
- The ability to delegate sub-tasks to isolated sub-agents
- An operations loop that evaluates its own runs and improves its own system prompt/config

The reference design is the open-source **NousResearch hermes-agent** architecture. This doc captures that design plus the extensions discussed (sub-agent delegation details, build sequencing) so the whole thing is buildable without feeling like one giant unshippable project.

---

## 2. Reference architecture (Hermes Harness)

### Message flow, end to end

```
Channel (Telegram/WhatsApp/Slack/UI)
        |
        v
  Gateway Interface  ---- runs local / Docker / SSH / VPS
        |
        v
  Ephemeral Agent Run
    Working Memory = User Prompt + Chat History + System Prompt + SOUL.md
        |
        v
  ================ THE LOOP ================
  |  LLM (Q&A Agent)  <---- tool results ---|
  |     |                                   |
  |     v                                   |
  |  Tool Calls: Terminal, Browser,         |
  |    delegate_task, cronjob,              |
  |    skill_manage, MCP                    |
  |     |                                   |
  |     +--> Sub-Agent  ---------------------
  |     +--> Sub-Agent  ---------------------
  |                                          |
  |  End Loop Guardrails ------> Reply       |
  ============================================
        |                           |
        v                           v
  Save history                Improved System
  (episodic memory)           Prompt + Config
                               (from LLM Ops loop)
```

### Memory — three tiers, not one context blob

| Tier | What it stores | Retrieval | Storage location |
|---|---|---|---|
| **Procedural** | "How to do X" — skill instructions | Keyword top-k, no embeddings needed | `~/.hermes/skills/*/SKILL.md` |
| **Semantic** | Durable facts, user profile | RAG (embeddings) + SQL | `MEMORY.md` + `state.db` |
| **Episodic** | Dated events, raw past chat history | Direct lookup / recency | `state.db` (SQLite + FTS5) |

### Consolidation — the self-improving piece

After N new chats accumulate, a separate auxiliary-model job runs offline (not in the live loop):

- Reads episodic memory (raw chat history)
- Distills recurring facts into **semantic memory**
- Can write brand new **SKILL.md** files into procedural memory based on what worked

This is what separates it from a plain chatbot with tools — it accumulates durable knowledge and writes its own instructions over time, rather than starting fresh (aside from raw logs) every session.

### LLM Ops — a separate loop, not part of Hermes itself

- **Trace:** one trace per run (full trajectory export/logs)
- **Eval:** LLM-as-judge scores whether the run was good
- **Observe:** tracks tokens, latency, errors per run (was it healthy?)
- **Diagnose:** if eval fails, work out where/why it broke
- **Gate:** pass/fail decision point
- **Release:** ship the fix safely — new prompt version, model config change, tool change, or RAG top-k parameter — versioned so you can roll back

This loop feeds "Improved System Prompt + Config" back into the live agent. It's the mechanism that makes the system get better from real usage instead of only from manual prompt editing.

---

## 3. Full feature inventory

### Gateway layer
- Multi-channel adapters (Telegram, WhatsApp, Slack, custom web/CLI UI)
- Message normalization — every channel's format maps to one internal message shape
- Runs local / Docker / SSH / VPS — deployment-target agnostic

### Agent core
- Ephemeral run construction — Working Memory rebuilt fresh every run, no lingering process state
- `SOUL.md` loader — persona/identity, kept separate from the operational system prompt
- Tool-calling loop with max-iteration guardrails
- End-of-loop checks before replying (guardrails)

### Tools
- **Terminal** — shell command execution
- **Browser** — web automation/navigation
- **delegate_task** — spawns a sub-agent (see Section 4)
- **cronjob** — schedules a future agent run (proactive triggers, not just reactive to messages)
- **skill_manage** — CRUD operations on `SKILL.md` files
- **MCP client** — connect to external MCP servers so the agent isn't limited to hand-built tools

### Memory system
- SQLite + FTS5 as the core state store
- Procedural memory: file-based skills, keyword retrieval
- Semantic memory: fact store, hybrid RAG + SQL retrieval
- Episodic memory: timestamped raw chat history
- Consolidation job: triggered after N chats, distills + writes new skills

### Sub-agents / delegation
- Scoped task spec per sub-agent (goal + relevant context slice, not full history)
- Tool scoping — each sub-agent gets only the tools its task needs
- Depth limiting — prevent fractal/recursive spawning
- Concurrency — parallel sub-agent execution with a concurrency cap
- Structured result contract — clean summary back to parent, not a raw transcript
- Per-sub-agent timeout + bounded retry
- Nested tracing — sub-agent traces tagged with `parentRunId`

### Scheduler
- Cron-style recurring triggers ("check email every 30 min")
- Event-driven triggers (file changed, webhook, calendar event)

### LLM Ops
- Per-run tracing (trajectory export/logs), nested for sub-agent runs
- LLM-as-judge evaluation on traces
- Observability: tokens, latency, error rates
- Diagnose → fix → re-eval loop
- Versioned release of prompt/config/tool/RAG-param changes, fed back into the live agent

---

## 4. Sub-agent design (delegate_task)

From the parent agent's point of view, `delegate_task` is just another tool: it takes an input and returns an output. The parent never sees the sub-agent's internal reasoning or tool calls — only the final structured result.

### Task spec (what the parent sends down)

```ts
interface SubAgentTask {
  id: string;
  parentRunId: string;
  goal: string;              // what it needs to accomplish
  context: string;           // relevant slice only, not full chat history
  allowedTools: string[];    // scoped — e.g. browser-only, no filesystem
  maxIterations: number;
  depth: number;             // for recursion limiting
}
```

### Result contract (what comes back up)

```ts
interface SubAgentResult {
  taskId: string;
  status: "success" | "failed" | "timeout";
  output: string;    // clean summary, never the raw internal transcript
  error?: string;
}
```

### Design rules

1. **Context isolation** — pass a scoped task, not the parent's whole conversation. Keeps context small and prevents the sub-agent from doing things the parent didn't intend.
2. **Tool scoping is your main safety lever**, not just an efficiency trick. A research sub-agent gets `[browser, semantic_memory_read]`. A refactor sub-agent gets `[terminal, filesystem]`. Never hand out the full tool set by default.
3. **Depth limit** — pass a `depth` counter down; once it hits `MAX_DEPTH`, strip `delegate_task` from `allowedTools` before spawning, so sub-agents can't spawn sub-agents indefinitely.
4. **Concurrency with a cap** — independent tasks run in parallel (`Promise.all`), but capped (e.g. `p-limit(3)`) to avoid blowing rate limits or local resources.
5. **Force a clean final summary** — the sub-agent's last step should produce the structured result, not let its full internal monologue leak into the parent's context.
6. **Timeout + bounded retry** — one hung sub-agent shouldn't hang the parent loop. Cap retries at 1–2 on failure.
7. **Nested tracing** — every sub-agent run gets its own trace id tagged with the parent's, so LLM Ops can show a full run tree, not flat unrelated logs.

> **Build order for this piece specifically:** synchronous single-spawn first (get isolation + result contract right) → enforce tool scoping → add depth limiting → add parallel spawning with concurrency cap → wire up nested tracing.

---

## 5. Phased build plan

Seven phases, each one a shippable, testable increment. Don't start a phase until the previous one actually runs end-to-end — this is what keeps the project from feeling overwhelming.

### Phase 0 — Core agent loop `foundation`
*Goal: one working ephemeral agent run, no memory, no channels beyond a CLI.*
- Agent class: prompts, responses, state, tools, model, system prompt (you already have this from the custom agent harness project)
- Ephemeral run construction: Working Memory = User Prompt + Chat History + System Prompt
- Basic tool-calling loop with a max-iteration guardrail
- CLI as the only interface for now

*Done when:* you can run a prompt from the CLI and get a tool-using, looped response back.

### Phase 1 — Real tools + one gateway channel
*Goal: the agent can actually act in the world, and you can talk to it from somewhere other than a terminal.*
- Terminal tool (shell execution)
- Filesystem tool (read/write)
- Browser tool (basic navigation/automation)
- One gateway channel — Telegram is the fastest to stand up
- Permission/confirmation flow for risky actions

*Done when:* you can message it on Telegram and have it read a file, run a command, or browse a page.

### Phase 2 — Episodic memory
*Goal: it stops forgetting everything between sessions.*
- Stand up `state.db` (SQLite + FTS5)
- Log every run's messages as timestamped episodic memory
- Load recent episodic history back into Working Memory on new runs

*Done when:* you can close the app, reopen it, and it remembers what you talked about yesterday.


### Phase 3 — Procedural + semantic memory
*Goal: it retrieves relevant "how to" instructions and durable facts, not just raw history.*
- Procedural: `SKILL.md` file format + keyword top-k retrieval (no embeddings needed here)
- Semantic: fact store + embeddings, hybrid RAG + SQL retrieval
- `skill_manage` tool — CRUD on SKILL.md files

*Done when:* the agent pulls in a relevant skill file or a stored fact about you without you repeating yourself.

### Phase 4 — Sub-agent delegation
*Goal: it can break work into isolated sub-tasks instead of doing everything in one giant context.*
- `delegate_task` tool — synchronous, single sub-agent spawn first
- Scoped task spec + structured result contract (Section 4)
- Tool scoping per sub-agent
- Depth limiting
- Then: parallel spawning with a concurrency cap

*Done when:* the parent can hand off a sub-goal, get a clean summary back, and continue its own loop.

### Phase 5 — Scheduler + consolidation
*Goal: it acts proactively and starts improving its own memory without you prompting it.*
- `cronjob` tool — scheduled/recurring triggers
- Consolidation job: after N new chats, distill episodic → semantic facts
- Consolidation job also writes new `SKILL.md` files based on what worked

*Done when:* it can run on its own schedule, and its memory gets more organized over time without manual cleanup.

### Phase 6 — LLM Ops loop
*Goal: the system evaluates and improves itself from real usage data. Build this last — it needs a running system to have anything worth evaluating.*
- Per-run tracing (trajectory export/logs), nested for sub-agent runs
- LLM-as-judge evaluation on traces
- Observability: tokens, latency, error rates
- Diagnose → fix → re-eval loop
- Versioned release of prompt/config/tool/RAG-param changes, fed back into the live agent

*Done when:* a bad run gets flagged, diagnosed, and a fix gets released as a new versioned config — without you manually digging through logs.

---

## 6. Suggested stack

| Layer | Suggestion | Why |
|---|---|---|
| Core language/runtime | TypeScript / Node.js | Matches existing harness project, strong ecosystem for tool/agent orchestration |
| State store | SQLite + FTS5 | Matches reference architecture; zero-ops, good enough for single-user local agent |
| Semantic memory / embeddings | SQLite + a vector extension, or Postgres + pgvector if you outgrow SQLite | Postgres/Prisma already in your stack if you want a heavier setup later |
| Browser tool | Playwright | Reliable headless automation, good API surface |
| Shell tool | execa | Already used in the harness project |
| Concurrency control | p-limit | Simple concurrency caps for parallel sub-agents |
| Testing | Vitest | Already in use in
 the harness project |

> **The one rule that keeps this from being overwhelming:** don't open Phase N+1 until Phase N runs end-to-end on a real message. Each phase is independently useful — even stopping after Phase 2 gives you a working assistant with memory.
