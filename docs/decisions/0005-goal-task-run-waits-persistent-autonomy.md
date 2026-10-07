# ADR-0005: Goal, Task, Run Waits, and Crash Recovery Architecture for Persistent Autonomy

- Status: Accepted
- Date: 2026-10-07
- Phase: V2 P2 (Persistent Autonomy)

## Context

In Athena V1 and Phase 1, runs executed autonomously within a process lifecycle, but process termination (e.g. machine restart, crash, deployment kill) would leave active runs in an inconsistent state (`running`, `planning`) with no deterministic recovery mechanism. Furthermore, long-running waiting workflows (e.g. human-in-the-loop approvals, external events, webhooks, or user replies) previously depended on in-memory timers or synchronous blocking loops, which violate durable persistence principles.

The V2 specification defines Phase 2 (Persistent Autonomy) requiring:
1. Long-lived **Goals** decomposed into structured DAG-dependent **Tasks** persisted in SQLite.
2. Real durable waiting (`run_waits`) with no long-lived `setTimeout` loops, integrated into `EventBus` and deadline timeout sweeps.
3. Deterministic crash recovery on engine startup via `CrashResumeSweeper`.
4. Strict Goal-level budget enforcement outranking run budgets.
5. Background execution safe tool guards restricting write/destructive operations (`BACKGROUND_SAFE_TOOL_RESTRICTION`).

## Decision

1. **Schema Migration 3 (`v2_p2_persistent_autonomy`)**:
   - `goals`: Stores multi-step objectives with `budget`, `usage`, `status` (`proposed`, `active`, `paused`, `completed`, `failed`, `cancelled`), `progress`, and dependencies.
   - `tasks`: Decomposed nodes of a goal containing structured `dependencies` (task IDs), priority, and execution status.
   - `run_waits`: Durable parking records for runs waiting on `WAITING_FOR_EVENT`, `APPROVAL`, `USER`, or `TIMER`.
   - Extended `runs` table with foreign keys `goal_id` and `task_id` for hierarchical trace and state linking.

2. **Durable Waiting Engine (`WaitingEngine`)**:
   - Runs do not park in memory with `setTimeout`. Instead, they transition to `RunStatus = 'waiting'` and insert an active record in `run_waits`.
   - In-flight events published to `EventBus` are matched against active `run_waits` rows. When an event pattern matches, the wait status becomes `satisfied` and the linked run is transitioned to `queued` for execution.
   - Deadlines are evaluated on demand and during periodic timeout checks via `checkTimeouts()`, marking expired waits as `timed_out` and finalizing the run state.

3. **Crash Recovery Sweeper (`CrashResumeSweeper`)**:
   - On boot, `CrashResumeSweeper.sweep()` scans SQLite for orphan runs left in non-terminal states (`running`, `planning`, `verifying`, `reviewing`, `repairing`).
   - These runs are automatically reset to `queued` state and can be cleanly resumed without duplicate side effects thanks to idempotency key deduplication.

4. **Hierarchical Budget Enforcement**:
   - Goal budgets (`maxTurns`, `maxTimeMs`, `maxToolCalls`, `maxCostUsd`, `maxTokens`) act as an authoritative ceiling above task and run budgets.
   - If a goal budget is exhausted, further execution under the goal is rejected immediately, and the goal transitions to `failed` (`failureReason: 'budget_exceeded'`).

5. **Background Tool Restriction Policy**:
   - In background execution (`isBackground: true`), `PolicyEngine` enforces rule `BACKGROUND_SAFE_TOOL_RESTRICTION`:
   - High-impact and side-effect tools (`executeCommand`, `writeFile`, `replaceFileContent`, `deleteFile`) are strictly denied unless explicitly authorized. Read-only tools (`readFile`, `readFolder`, `readUrlContent`, `cronjob:list`, etc.) remain allowed.

## Consequences

- Full process persistence: the agent can be killed via SIGKILL at arbitrary moments during execution and resumed safely with zero duplicate tool side effects.
- Clean separation between Goal planning, DAG Task orchestration, and low-level Run execution loops.
- All existing V1 and V2 P1 test suites remain backward-compatible and green.
