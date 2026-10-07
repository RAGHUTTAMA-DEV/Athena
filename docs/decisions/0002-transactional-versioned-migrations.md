# ADR-0002: Transactional, versioned schema migrations (PRAGMA user_version)

- Status: Accepted
- Date: 2026-10-07
- Phase: V2 P1 (Agent Foundation)

## Context

V1 evolved its SQLite schema ad hoc (`CREATE TABLE IF NOT EXISTS`, scattered
`ALTER TABLE`). V2 needs to (a) reach any schema version deterministically from any
baseline, (b) migrate a populated V1 database without data loss, and (c) survive a
crash mid-migration. The build plan requires a migration runner in P1 with the
PostgreSQL tooling landing in V2 P12.

## Decision

1. `src/core/database.ts` owns `AthenaDatabase.open(dbPath)`, which opens the
   connection, then runs ordered migrations through a runner that:
   - tracks the applied version with SQLite's `PRAGMA user_version`;
   - records each applied migration (version, name, appliedAt) in a
     `schema_migrations` audit table;
   - executes each migration's `up()` inside a transaction — on failure the
     transaction is rolled back, `user_version` is not advanced, and the error
     (naming the migration) is rethrown;
   - is idempotent: re-opening an up-to-date database applies nothing.
2. Migration definitions live in `src/core/migrations/index.ts` as an ordered array:
   - **M001 `v1_baseline`** — idempotent V1 DDL (`IF NOT EXISTS`), so an existing V1
     database and a brand-new empty database converge on the same schema;
   - **M002 `v2_p1_agent_foundation`** — new tables (`workspaces`, `projects`,
     `users`, `agent_profiles`, `agent_profile_versions`) plus `ALTER TABLE
     scoped_memory ADD COLUMN` for `workspace_id` / `project_id` / `agent_id`
     (existing rows get NULL = cross-workspace, preserving V1 visibility).
3. Tests can pass a custom migration array to simulate failures.

## Consequences

- A crash mid-migration leaves the database at its previous version with no partial
  DDL (verified by test: a broken migration rolls back its `CREATE TABLE` and the
  retry succeeds).
- Populated V1 databases (including a copy of the real `state.db`, 1,972 rows)
  migrate with no row loss (verified by test).
- M001 must stay idempotent forever because it runs before M002 on every database
  shape. This is a maintenance constraint on future baseline edits.
- PostgreSQL in P12 must reproduce this runner's semantics (version table +
  per-migration transaction) and run the same logical migrations.
