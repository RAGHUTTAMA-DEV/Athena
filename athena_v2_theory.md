# Athena V2: Theory and Vision

**Purpose of this document:** explain *what* Athena V2 is, *why* it differs from V1, and *what Athena should become*.
**Companion document:** `athena_v2_build_plan.md` explains *how* to build it, phase by phase.
**Sources:** the Athena V2 specification (sections 0-79) and the Athena V1 README (Phases 1-8, implemented).

> Read this first. Read the build plan when you start implementing.

---

## 1. One-sentence definitions

**Athena V1:** a reliable, local-first agent runtime that executes a task well, with strong safety, memory, recovery and observability.

**Athena V2:** a persistent agent that lives with the user, pursues goals over time, works in the background, reaches the user through any channel, and verifies its own work.

The one-line difference:

```text
V1:  you give Athena a task, and Athena runs it.
V2:  you give Athena responsibility, and Athena keeps working until it's done.
```

---

## 2. Where V1 stands

V1 already solved the hard runtime problems. These are strengths to keep, not rebuild:

| V1 strength | What it gives you |
|---|---|
| Durable runs (SQLite, events, budgets, cancellation, resume) | Work survives interruptions |
| Adaptive orchestration (classifier, Plan DAG, escalation, self-repair) | Simple tasks stay cheap, hard ones get planned |
| Scoped memory with provenance and contradiction handling | Memory isn't a blob of facts |
| Resilient tool runtime (manifests, breakers, offloading) | Flaky tools don't take the agent down |
| Coding harness bridge with snapshots and rollback | Safe repository changes |
| Scheduler, event bus, leases, worker pool | The beginnings of background work |
| Policy engine, prompt defense, secret redaction | Safety culture from day one |
| OTel/Langfuse, replay, adversarial evals | You can see, debug and measure it |

**What V1 is, honestly:** an excellent *engine*. It runs when you start it, for the task you gave it, in the interface you opened it in. Most of V1's concepts are **per-run**.

---

## 3. The core shift: from "run" to "agent"

This is the whole idea behind V2. Everything else follows from it.

### 3.1 The conceptual change

```text
V1 mental model                          V2 mental model

  User                                     User
   |                                        |
  Prompt                                  Intent
   |                                        |
  Run (the unit of work)                  Persistent Athena (identity, memory, goals)
   |                                        |
  Tools                                   Goal -> Task -> Run
   |                                        |
  Answer                                  Tools / Computer / Other agents
                                            |
                                          Verify -> Learn -> Continue / Wait / Finish
```

In V1, the **run** is the center of the system. In V2, the **agent** is the center, and the run is one execution detail inside a larger life.

### 3.2 The five properties that make something an agent (not a chatbot with tools)

1. **Persistence.** It exists between conversations. Its identity, memory, and obligations survive restarts, model changes and interface changes.
2. **Responsibility.** It owns goals, not just prompts. A goal can outlive many conversations.
3. **Initiative.** It notices things (an email arrived, CI failed, a deadline is near) and acts, without being asked, within permissions.
4. **Autonomy with limits.** It continues on its own, and stops for approval at risky points.
5. **Accountability.** It verifies its own work with evidence and can show what it did and why.

V1 has pieces of 1 and 5. V2 adds 2, 3, and 4 and completes 1 and 5.

---

## 4. V1 vs V2: side-by-side comparison

### 4.1 Overview

| Dimension | V1 | V2 |
|---|---|---|
| **Identity** | `SOUL.md` prompt text | Persistent, versioned agent profile that survives restarts, models, interfaces |
| **Unit of work** | A run | A goal, broken into tasks, executed as runs |
| **Time horizon** | Minutes to hours, one session | Days to weeks, many sessions |
| **Who starts work** | The user | The user *or* events, schedules, routines, heartbeats |
| **Waiting** | A state you resume manually | A persisted wait that wakes itself when an event arrives |
| **Interfaces** | CLI, Telegram | One core behind many channels and an API |
| **Actions** | Terminal, files, browser, Python, MCP | Plus real computer use, research, RAG, documents, multimodal |
| **Safety boundary** | Policy rules and prompt defense | Sandbox + permissions + approvals + reviewer |
| **Trust model** | Human confirms in the CLI | Approvals travel to the user's channel and survive restarts |
| **Verification** | Gate checks the run against criteria | Evidence-based verification plus an independent reviewer |
| **Learning** | Skill files with success rates | Skills, routines and learned workflows, reviewed before use |
| **Collaboration** | Parent spawns children | Specialist agents that message each other |
| **Models** | One provider, with failover | Task-aware routing, cost control, credential pools |
| **Storage** | SQLite | Interfaces over SQLite (local) and PostgreSQL (production) |
| **Proof** | Phase tests, benchmarks | Eval suites across 16 areas, chaos testing, E2E scenarios |

### 4.2 Three scenarios that show the gap

**Scenario A: "Apply to these 5 internships this week."**

```text
V1: Athena works through the applications in one run. If a form needs
    a reply from a recruiter, the run stalls. You come back, find out
    it stalled, and /resume.

V2: Athena creates a goal with tasks, submits applications, parks each task
    waiting for a response, and shuts down. A reply email arrives. The event
    wakes the right task. Athena responds if authorized, or messages you on
    Telegram for approval. It updates progress and tells you when the goal
    is actually finished.
```

**Scenario B: "Keep my project dependencies healthy."**

```text
V1: Nothing happens until you ask. You can schedule a cron job, but the
    job is just a prompt on a timer.

V2: A routine (trigger + conditions + workflow + permissions) checks weekly.
    It proposes updates, runs tests in a sandbox, has a reviewer check the
    result, then asks you to approve the merge. If tests fail it repairs
    within a bounded number of attempts, or tells you why it's blocked.
```

**Scenario C: "What did we decide about the database last month?"**

```text
V1: Athena can search memory facts. If the decision was in a past
    conversation or tool output and never became a memory, it's gone.

V2: Memory (what to remember) is separate from session history (what
    happened). Athena searches both: past messages, tool outputs, plans,
    decisions, and runs, with filters by project and time.
```

---

## 5. The conceptual model of V2

V2 keeps several concepts deliberately **distinct**. Mixing them is the most common way agent systems get confusing.

```text
Skill     "What do I know about doing this kind of thing?"   (procedural knowledge)
Routine   "When should I do it?"                             (trigger + workflow)
Goal      "Why am I doing it?"                               (outcome I'm responsible for)
Task      "What specific thing needs doing?"                 (unit inside a goal)
Run       "What execution is happening right now?"           (one attempt)
```

### 5.1 How they relate

```text
Routine (trigger fires)
   |
   v
Goal  ---- has ----> Tasks ---- each executed by ----> Runs
   |                    |                                |
   |                    |                                +-- uses Tools, Skills
   |                    +-- may be delegated to other Agents
   +-- produces Artifacts, owns budgets
```

### 5.2 Memory is not history

| | Memory | Session history |
|---|---|---|
| Question it answers | "What should Athena remember?" | "What actually happened?" |
| Content | Curated facts, preferences, procedures | Messages, tool calls/outputs, plans, events, runs, errors |
| Quality bar | Validated, with provenance and confidence | Complete and searchable |
| Danger | Poisoned or wrong facts become permanent | Too large to put in context |
| Rule | Model assumptions never silently become facts | Retrieve what's relevant; never dump it all |

### 5.3 Memory lifecycle

```text
candidate -> validated -> active -> superseded/contradicted -> archived
```

A fact the model *guessed* starts as a `candidate`. It becomes `active` only after validation. Memory can never override system policy.

### 5.4 Waiting is state, not a timer

```text
V1-style thinking:   sleep(n) then continue      (dies with the process)
V2 thinking:         persist "waiting for X" -> process may exit -> X happens
                     -> matcher finds the waiting run -> run resumes
```

Waiting kinds: for an event, for approval, for the user, or blocked.

### 5.5 Autonomy loop

```text
OBSERVE -> UNDERSTAND -> PLAN -> ACT -> OBSERVE RESULT -> VERIFY -> LEARN -> CONTINUE | WAIT | FINISH
```

The same loop applies to browsing, research, communication, coding and computer use. The tools change; the loop doesn't.

---

## 6. What Athena should become

### 6.1 The definition

> **A persistent, general-purpose autonomous AI agent that understands the user's world, remembers context, makes plans, uses tools, operates computers, communicates, learns workflows, pursues goals, and executes real digital work with minimal supervision.**

### 6.2 Identity: general-purpose, engineering as a strength

```text
Athena is NOT primarily:           Athena IS:
  - a coding agent                   - a general autonomous agent
  - a chatbot                          with engineering as one strong capability
  - an automation dashboard
  - a RAG app
```

Architecturally: `Athena -> Engineering capability -> Coding harness`, not `Athena = coding agent`. The same structure applies to RAG, research and everything else: *capabilities Athena uses*, not *the boundary of the product*.

### 6.3 The product test

Hand Athena: *"I need to get this done. Figure out what needs to happen, do as much as you can yourself, use whatever tools you have, remember what you learn, ask me only when necessary, and tell me when it's actually finished."*

Athena should work out:

```text
What is the objective?  -> What do I know?  -> What is missing?
-> What tools do I need?  -> What is safe?  -> What needs a plan?
-> What can be delegated?  -> What can happen in the background?
-> What needs approval?  -> How do I verify success?
-> What should I remember?  -> What happens next?
```

That is the product.

### 6.4 Seven qualities Athena must have

| Quality | Meaning in practice |
|---|---|
| **Persistent** | Same Athena after restart, model swap, new UI |
| **Proactive** | Notices events; never wakes the LLM "just because" |
| **Capable** | Real browser, real computer control, real documents, real research |
| **Trustworthy** | Least privilege, sandboxing, approvals, injection defense |
| **Verifiable** | Checks results against evidence, not its own claims |
| **Observable** | Every important run can be traced and replayed |
| **Local-first** | Works on your machine with local files and models; cloud is optional |

---

## 7. Design principles (the "why" behind decisions)

1. **The conversation is one interface, not the agent.** Athena keeps working when the chat is closed.
2. **Channels are not agents.** Telegram, Email, Slack and voice are doors into the same Athena, not separate bots.
3. **Don't over-plan trivial work.** "What's the weather?" is a direct tool call. "Build and deploy this app" gets planning, execution and verification.
4. **Never put hundreds of tool schemas in every prompt.** Discover tools by capability, rank them, check permission, then run.
5. **Everything external is untrusted.** Web pages, emails, documents, repos, tool results and even retrieved memories never become system instructions on their own.
6. **Autonomy is bounded.** Bounded attempts, budgets, agents, retries, events and context. "No infinite loops" is a hard rule.
7. **Stop at the right moments.** Ambiguity that changes the outcome, destructive or financial actions, external publication, credential changes, and permission escalation need a human. Otherwise, continue.
8. **Ask one useful question, then continue.** Clarification is not a habit.
9. **Verify independently.** The agent claiming success is not evidence of success.
10. **Never fake a capability.** If it needs a real backend (computer use, a cross-encoder reranker, real browser automation), implement it for real or mark it unsupported.
11. **Provenance everywhere.** Facts, memories, events and artifacts know where they came from.
12. **Modular and replaceable.** Providers, stores, channels and execution backends sit behind interfaces so new ones don't require a rewrite.

---

## 8. The trust model (why V2 is safer, not just bigger)

More autonomy means more risk, so V2 adds layers instead of relying on one.

```text
                 Every action Athena takes
                            |
        +-------------------+-------------------+
        |                                       |
   Is it permitted?                      Where does it run?
   (agent + tool + workspace             (sandbox, scoped filesystem
    + network permissions)                and network)
        |                                       |
        +-------------------+-------------------+
                            |
                  Does it need approval?
        (destructive / financial / external publish /
         credential change / permission escalation)
                            |
                     Run the action
                            |
                Verify with evidence, then
             independent review if high-risk
                            |
                 Audit log + replayable trace
```

V1's regex-style blocklist is a useful second layer. V2's first layer is a real boundary (sandbox + permissions), because attackers and model mistakes don't follow your patterns.

---

## 9. How V2 compares to other agent systems

The V2 spec treats Hermes and OpenClaw as reference points. Based on what the spec says about them:

- **Computer use** is treated as a real cross-platform capability using accessibility and input backends (Hermes is cited as the bar). Athena V2 should meet that standard rather than simulate it with screenshots.
- **Channels** are treated as a gateway-level capability instead of separate agents (OpenClaw is cited). Athena V2 uses the same structure.
- **On-demand skills** reduce token usage compared to loading everything into every prompt (Hermes is cited). Athena V2 uses progressive disclosure.

Where V2 aims to differentiate: durable runs with real waiting, memory with provenance and contradiction handling, independent verification and review, replay, and adversarial evaluation. Reach and ecosystem will take time. Reliability and trust are what Athena can lead on from the start.

> Caveat: details about other projects here come only from the spec's own references. Verify against their current docs before making comparison claims publicly.

---

## 10. What V2 deliberately is *not*

To keep V2 finishable (spec section 73):

```text
custom foundation model          custom browser engine
native mobile OS                 public plugin marketplace
social network for agents        custom cloud infrastructure
every possible integration       any UI
```

New providers, connectors and skills can be added after V2 *without* architectural changes. That is the meaning of "no V3 rewrite": V2 should be a stable platform where growth is additive. Treat this as a design goal to protect, not a guarantee. Review it honestly after each phase.

---

## 11. Success criteria: how you know V2 worked

Athena V2 is complete when:

```text
It can THINK, PLAN, REMEMBER, SEARCH, RESEARCH, BROWSE, SEE, HEAR, SPEAK,
USE A COMPUTER, USE FILES/TERMINALS/APIS, COMMUNICATE, SCHEDULE, WAIT, RESUME,
LEARN WORKFLOWS, USE SKILLS, CREATE GOALS, MANAGE TASKS, DELEGATE, COLLABORATE,
CODE, DEBUG, BUILD, AUTOMATE, VERIFY, REVIEW, REPAIR, CREATE ARTIFACTS,
ASK FOR APPROVAL, RECOVER FROM FAILURE, and WORK IN THE BACKGROUND
```

while maintaining security, reliability, observability, provenance, user control and local-first operation.

The practical test is simple. After a week of real use, does Athena feel like **"an AI that lives with the user and can actually do things"** rather than **"an application that generates AI responses"**?

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **Agent profile** | Persistent record of who Athena is: role, permissions, preferences, model policy |
| **Goal** | An outcome Athena is responsible for, with status, priority, deadline, budget |
| **Task** | An executable unit inside a goal; can depend on, delegate to, or wait on others |
| **Run** | One execution attempt of a task |
| **Wait** | Persisted "blocked until X" state (event, approval, user) that survives restarts |
| **Skill** | Reusable procedural knowledge, loaded on demand |
| **Routine** | A reusable behavior with a trigger, conditions, workflow, and permissions |
| **Learned workflow** | A procedure distilled from successful runs (intent, steps, conditions, failure handling), not a raw action recording |
| **Artifact** | A durable output (report, diff, file, screenshot, test report) linked to its run and goal |
| **Channel** | An interface (CLI, Telegram, Email...) normalized into one message format for the core |
| **Heartbeat** | A throttled, cost-aware check for "does anything need attention?" |
| **ExecutionBackend** | The interface that runs actions: local, sandboxed, or later remote |
| **Reviewer** | An independent agent that evaluates a result with separate context and restricted permissions |
| **Capability registry** | Honest list of what is `real`, `experimental` or `unsupported` |
| **Provenance** | Record of where a fact, event or artifact came from |

---

## 13. Where to go next

| You want to know... | Read |
|---|---|
| *What* is Athena V2 and *why*? | This document |
| *How* to build it, in what order | `athena_v2_build_plan.md` |
| Which V1 modules each phase reuses | Build plan, section 1 and each phase's "Reuse" |
| Where each component sits (V1 vs new) | Build plan, section 2b |
| What exactly changes per area | Build plan, section 2c |
| Exit criteria for each phase | Build plan, each phase |

**Suggested reading order:** this theory file, then the build plan's architecture section (2b, 2c), then P1.
