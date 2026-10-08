# ADR-0012: Multi-Agent Subsystem — Specialized Profiles, Delegation Contracts, and Durable A2A Messaging (P6)

- Status: Accepted
- Date: 2026-10-08
- Phase: V2 P6 (Multi-Agent — spec sections 32, 33, 34)

## Context

In Athena V1, multi-agent execution was limited to ephemeral sub-agents spawned via `delegate_task`. While effective for simple one-off sub-tasks, it lacked:
1. **Persistent Specialized Profiles (Spec Section 32)**: Dedicated agent identities with specialized system directives, capabilities, and permission boundaries (Researcher, Coder, Reviewer, Planner, Browser Agent, Data Agent).
2. **Formal Delegation Contracts (Spec Section 33)**: Explicit scoping of context, allowed tools, bounded turn/time budgets, expected output format, and strict depth ($\le 3$) and concurrency ($\le 5$) limits.
3. **Tool Scoping Guard (Spec Section 33)**: Strict enforcement ensuring a delegated sub-agent cannot execute tools outside its contract's authorized tool set.
4. **Durable A2A Mailbox (Spec Section 34)**: Asynchronous, structured inter-agent messaging across 9 canonical message types (`request`, `response`, `handoff`, `question`, `blocked`, `status`, `artifact`, `approval`, `cancel`) linked to goals and tasks. Messages must persist in SQLite to survive host process restarts.
5. **Multi-Stage Handoff Pipelines**: Workflows where output transitions between specialists (e.g. Researcher $\rightarrow$ Coder $\rightarrow$ Reviewer), with crash-safe recovery if the system restarts mid-pipeline.
6. **Justified Teams (Spec Section 32)**: Prevention of gratuitous multi-agent teams by enforcing a recorded specialization benefit rule for every team entity.

## Decision

1. **Schema Migration 8 (`v2_p6_multi_agent`)**:
   - `agent_messages`: `id`, `sender_id`, `recipient_id`, `message_type`, `goal_id`, `task_id`, `run_id`, `payload`, `status`, `reply_to_id`, `created_at`, `processed_at`. Indexes on `recipient_id`, `sender_id`, `goal_id`, `task_id`, `status`, `reply_to_id`.
   - `agent_teams`: `id`, `name`, `justification`, `lead_agent_id`, `member_agent_ids`, `metadata`, `created_at`, `updated_at`. Index on `lead_agent_id`.

2. **Storage Layer**:
   - Interfaces in `src/storage/stores/types.ts`: `AgentMessageStore`, `AgentTeamStore`, `AgentMessage`, `AgentTeam`.
   - SQLite implementations: `SqliteAgentMessageStore`, `SqliteAgentTeamStore` registered in `createSqliteStores`.

3. **Specialized Profiles (`src/multiagent/specializedProfiles.ts`)**:
   - Seeded standard profiles: `Researcher`, `Coder`, `Reviewer`, `Planner`, `Browser Agent`, `Data Agent`.
   - Reviewer role has strictly read-only tool permissions with zero write or shell execution access.

4. **Delegation Contract Engine (`src/multiagent/delegationContract.ts`)**:
   - Validates contracts against max depth ($\le 3$), max active sub-agents per goal ($\le 5$), bounded turn counts (1–30), timeouts (1ms–600,000ms), and output formats.
   - Enforces runtime tool scoping: attempts to invoke tools not listed in `contract.allowedTools` are denied with an explicit policy violation error.

5. **Durable A2A Mailbox (`src/multiagent/agentMailbox.ts`)**:
   - Provides `send()`, `receive()`, `getThread()`, `markRead()`, `markProcessed()`, `reply()`, `broadcast()`.
   - Persisted in SQLite so messages survive process crashes and reboots.

6. **Crash-Safe Handoff Engine (`src/multiagent/handoffEngine.ts`)**:
   - Executes multi-stage pipelines emitting durable `handoff` messages.
   - `resumeFromRestart()` reconciles past handoffs from the mailbox, discovers interrupted states, and resumes pending stages without duplicating finished work.

7. **Team Manager (`src/multiagent/teamManager.ts`)**:
   - Validates substantive specialization justification ($\ge 15$ characters) and minimum membership ($\ge 2$).

8. **Tools & Runtime Integration**:
   - `agentDelegate`: Upgraded tool executing contract-validated sub-agents.
   - `agentMessageSend` & `agentMailboxCheck`: A2A communication tools.
   - `EpisodicMemory` facade: `getAgentMessageStore()`, `getAgentTeamStore()`, `getAgentMailbox()`, `getHandoffEngine()`, `getTeamManager()`, `getDelegationContractEngine()`.
   - `CapabilityRegistry`: Seeds `multiagent.specialized_profiles`, `multiagent.delegation_contract`, `multiagent.a2a_mailbox`, `multiagent.handoff_engine`, `multiagent.teams` as `real`.

## Consequences

- **Fault Tolerance**: Multi-agent handoffs survive process termination; interrupted tasks resume deterministically from persisted mailbox records.
- **Security & Least Privilege**: The Reviewer and Researcher cannot execute arbitrary shell commands or overwrite sensitive files.
- **Resource Protection**: Hard depth caps and concurrency limits prevent uncontrolled cascading sub-agent proliferation.
- **Efficiency**: Teams cannot be created without verified specialization rationale, preventing unnecessary token and resource consumption.
