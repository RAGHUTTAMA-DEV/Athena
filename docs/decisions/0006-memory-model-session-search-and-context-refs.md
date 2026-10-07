# ADR-0006: Memory Model Expansion, Secure Write Pipeline, Universal Session Search, and Bounded Context References

- Status: Accepted
- Date: 2026-10-07
- Phase: V2 P3 (Memory and Context)

## Context

In Athena V1 and earlier V2 phases, memory was scoped to `global, user, workspace, project, session, task`, and lacked dedicated bindings to `agent` profiles or long-running `goal` objectives. Furthermore:
1. Model-inferred facts lacked a formal multi-stage security pipeline (Section 65) to prevent malicious prompt injection attacks from poisoning long-term memory or leaking credentials.
2. Conversation history and tool outputs were only searched via basic FTS over episodic chat messages (`episodic_memory`), with no universal search capability across tool calls, tool results, plans, thoughts, decisions, errors, and runs.
3. User prompts lacked structured reference parsing (`@file`, `@repo`, `@run`, `@goal`, `@task`, `@memory`, `@artifact`, `@project`), risking context overflow if raw file trees were dumped directly into context.
4. Prompt assembly was linear, which degraded performance on LLM providers supporting prompt prefix caching (Claude, Gemini, OpenAI).

## Decision

1. **Memory Model Expansion (Schema Migration 4 `v2_p3_memory_context`)**:
   - Added memory scopes: `agent` (profile-specific instructions/preferences) and `goal` (goal-specific criteria and intermediate learnings).
   - Added memory types: `fact`, `preference`, `relationship`, `procedural`, `semantic`, `episodic`.
   - Added lifecycle states: `archived` (retired/cold storage) and `quarantined` (flagged for safety review).
   - Added columns to `scoped_memory`: `memory_type`, `goal_id`, `security_status`, `quarantine_reason`.

2. **Section 65 Secure Memory Write Pipeline (`MemoryWritePipeline`)**:
   - Implemented 6-stage pipeline:
     1. `sanitize`: Normalizes strings and strips harmful boundary delimiter mimicry.
     2. `security check`: Evaluates prompt injection heuristics via `PromptDefense`. If an injection payload is detected (e.g. instruction override, jailbreak pattern), the fact is automatically **quarantined** (`lifecycle = 'quarantined'`, `securityStatus = 'quarantined'`), assigned `confidence = 0.0`, and prevented from ever entering active prompts. Memory can never override system policy.
     3. `secret detection`: Scans credentials via `CredentialManager` and masks API keys/tokens before storage (`[REDACTED_*]`).
     4. `provenance`: Validates source, timestamp, runId, sessionId, workspaceId, projectId, agentId, goalId.
     5. `confidence calibration`: Enforces calibrated confidence by source authority (user input = 0.95, model reflection = 0.60 as candidate).
     6. `store`: Commits securely via `MemoryStore`.

3. **Universal Session Search Engine (`SessionSearchEngine` / FTS5)**:
   - Dedicated `session_search_entries` backing table and `session_search_fts` virtual table.
   - Indexes: messages, tool calls, tool outputs, plans, decisions, thoughts, errors, runs, artifacts.
   - Multi-dimensional filters: `time range`, `categories`, `runId`, `sessionId`, `goalId`, `taskId`, `workspaceId`, `projectId`, `agentId`.

4. **Bounded Context Reference Resolvers (`ContextRefResolver`)**:
   - Parses typed `@references` from user prompts: `@file`, `@folder`, `@repo`, `@url`, `@session`, `@run`, `@goal`, `@task`, `@memory`, `@artifact`, `@project`.
   - Resolvers enforce strict token budget limits. In particular, `@repo` traverses directory structure up to depth 3, summarizes package manifests and README excerpts, and guarantees bounded token consumption (max 2,000–2,500 tokens) regardless of repo size. Whole directory trees are never dumped.

5. **Cache-Friendly Layered ContextEngine Assembly (`ContextEngine`)**:
   - Prompt assembly organized into strict stable-to-dynamic layers:
     - Layer 1: Agent Identity (Stable)
     - Layer 2: Operational Directives & Safety Policies (Stable)
     - Layer 3: Procedural Skills Catalog (Stable)
     - Layer 4: Tool Catalog & Schemas (Semi-Stable)
     - Layer 5: Active Task & Goal State (Dynamic)
     - Layer 6: Retrieved Scoped Memories (Dynamic)
     - Layer 7: Live Context, Resolved @Refs & History (Fast Dynamic)
   - Guarantees deterministic prefix stability across turns to maximize prompt cache hits.

6. **Token & Cost Accounting (`TokenAccountant`)**:
   - Tracks input, output, cached tokens, latency ms, and estimated USD costs per call, per run, and cumulative per goal across standard model pricing tiers.

## Consequences

- Quarantined memories cannot influence agent reasoning or bypass security policies.
- Past execution artifacts and tool outputs can be recalled exactly using full-text search.
- Prompts referencing `@repo` or large files stay strictly within model context limits.
- Full backward compatibility with V1 and V2 P1/P2 test suites preserved.
