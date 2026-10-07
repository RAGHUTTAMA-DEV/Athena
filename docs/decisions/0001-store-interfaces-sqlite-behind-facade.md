# ADR-0001: Store interfaces defined in P1, SQLite behind them, facade delegation

- Status: Accepted
- Date: 2026-10-07
- Phase: V2 P1 (Agent Foundation)

## Context

The V2 build plan requires store interfaces for all entities **now**, because writing
persistence directly against SQLite for 11 phases would make the PostgreSQL adapter
(P12) a rewrite of every store. At the same time, V1 has a large body of callers that
use `EpisodicMemory` directly (`agent.ts`, `contextEngine.ts`, scheduler, event bus,
CLI), and P1 must not rebuild or break them.

## Decision

1. Define persistence interfaces in `src/core/stores/types.ts`:
   `AgentStore`, `UserStore`, `WorkspaceStore`, `ProjectStore`, `RunStore`, `EventStore`.
2. Implement them in `src/core/stores/sqlite/` against a shared `Database` handle
   (the `sqlite` connection owned by `AthenaDatabase`).
3. Keep `EpisodicMemory`'s public API stable and **delegate** to the stores
   (facade pattern): `saveRunState`/`getRunState`/`updateRunState`/`listRuns` and
   `saveRunEvent`/`getRunEvents` forward to `RunStore`/`EventStore`; store accessors
   (`getAgentStore()`, `getUserStore()`, ...) expose the new entities.
4. All callers keep going through `EpisodicMemory`; nothing imports a store directly
   except identity/workspace code that receives the store via those accessors.

## Consequences

- Zero caller changes were required in V1 code paths; the full V1 test suite passes.
- P12 adds a PostgreSQL adapter implementing the same interfaces and a parity test
  suite; callers and the facade do not change.
- One extra layer of indirection in run/event persistence (delegation instead of
  inline SQL) — measured as no behavioral change; row shapes and semantics are
  byte-compatible with the V1 implementations they replaced.
- Risk: facade and store could drift apart if someone edits one side only. Mitigated
  by the P1 test suite exercising both the facade path and direct store usage.
