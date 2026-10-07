# ADR-0003: Versioned AgentProfile with append-only history; SOUL.md as seed

- Status: Accepted
- Date: 2026-10-07
- Phase: V2 P1 (Agent Foundation)

## Context

V1 identity is the `SOUL.md` text file: whoever edits it changes who Athena is, with
no versioning, no author, and no way to diff identities across restarts or model
switches. The V2 spec requires a versioned `AgentProfile` (id, name, identity, role,
personality, capabilities, permissions, preferences, workspace, memoryScope, skills,
routines, goals, modelPolicy, status, timestamps) with `SOUL.md` demoted to a seed,
and identity must be **identical across restart, model switch, and tool change**.

## Decision

1. Two tables:
   - `agent_profiles` — one current row per profile id (the read path is a single
     row lookup);
   - `agent_profile_versions` — **append-only** snapshots (profileId, version,
     snapshot JSON, changedBy, createdAt). Rows are never updated or deleted.
2. Every `AgentStore.save()` bumps `version` by 1 (preserving `createdAt`), upserts
   the current row, and appends the full snapshot to history with a `changedBy`
   label (e.g. `seed`, `workspace-switch`, a human label).
3. On first boot the primary profile (`athena-primary`) is seeded from `SOUL.md`
   with **empty `role`/`personality`**, so `renderProfileSoul(profile)` is
   byte-identical to the file content (empty sections are omitted).
4. After init, the rendered soul is a pure function of the stored profile —
   `Agent` renders from the profile, it does not re-read `SOUL.md` as the source
   of truth. The profile is reloaded from SQLite on every boot.

## Consequences

- Identity survives restart, model switch, and tool change (tested), and every
  change is auditable via `getVersionHistory()` with author labels.
- Editing `SOUL.md` on disk no longer changes a live profile; it only affects a
  database that has not been seeded yet. Migration of an already-seeded profile
  from a newer `SOUL.md` is a deliberate operation (candidate for a later phase CLI).
- History grows by one row per save; acceptable for local scale. If profiles are
  saved at high frequency later, consider pruning policy (not required for P1).
- Changing the shape of `AgentProfile` in a later phase requires a migration for
  both tables (current row + snapshot JSON parsing stays tolerant of old shapes).
