# ADR-0017: Reliability Subsystem — Multi-Category Task Verification, Independent Reviewer, Self-Repair, Gateway Approvals, Versioned Artifacts, and Deterministic Replay (P11)

- Status: Accepted
- Date: 2026-10-09
- Phase: V2 P11 (Reliability — spec sections 39–45, 62)

## Context

In Athena V1, verification was heuristic and approval checks were limited to synchronous CLI prompts. In Athena V2 (spec sections 39–45, 62):
1. **Task-Type Specific Verification (Spec Section 39)**:
   - Verification must follow an explicit `Expected Outcome → Evidence → Verification → PASS/FAIL` pipeline across 6 distinct task categories: `page_inspected`, `file_verified`, `test_build`, `sources_checked`, `delivery_result`, and `resulting_state`.
2. **Independent Reviewer (Spec Section 44 & Exit Criterion 2)**:
   - High-value or risky actions must be evaluated by an independent reviewer operating in an isolated context with separate reasoning and restricted permissions.
   - The reviewer evaluates against strict rubrics (safety boundary, code correctness, groundedness, task alignment) and must catch 100% of seeded defects (destructive commands, insecure eval, leaked credentials, syntax defects, hallucinated APIs).
3. **Bounded Self-Repair Pipeline (Spec Section 43)**:
   - Failures must follow a 5-stage loop: `classify → diagnose → replan → repair → verify`.
   - The loop must have a hard attempt budget (default max 3) to prevent runaway token spend.
4. **Gateway-Native Approvals (Spec Section 40 & Exit Criterion 1)**:
   - Human-In-The-Loop (HITL) approval requests must trigger on the 7 required triggers: critical ambiguity, high-risk, destructive operations, financial transactions, external publication, credential modification, and permission escalation.
   - Approval requests and run waits must be durable in SQLite (`approvals` and `run_waits` tables via Schema Migration 12).
   - Exit Criterion 1 requires approval survival across process restarts: an action triggers approval → process dies → new process starts → approval granted via SQLite → paused run resumes.
5. **Bounded Single Clarification (Spec Section 41)**:
   - When critical ambiguity blocks autonomous execution, Athena must formulate *one* useful, targeted multiple-choice question, ingest the answer, and immediately resume autonomy without endless chat back-and-forth loops.
6. **Versioned Artifacts (Spec Section 42)**:
   - Deliverables and work outputs must be versioned with content hashes in SQLite (`artifacts` and `artifact_versions` tables), linked to `agentId`, `runId`, `goalId`, and `taskId`.
7. **Deterministic Replay (Spec Section 45, 62 & Exit Criterion 3)**:
   - Full execution logs (model input/output, tool calls/outputs, state diffs) must be persisted in SQLite (`replay_logs`).
   - A run must replay deterministically offline without live LLM calls, producing an identical state trace.

## Decision

1. **Schema Migration 12 (`v2_p11_reliability`)**:
   - `approvals`: Tracks `id`, `action`, `risk_level`, `explanation`, `proposed_action`, `status` (`pending`, `approved`, `rejected`, `expired`), `channel_id`, `run_id`, `goal_id`, `task_id`, `expires_at`, `created_at`, `resolved_at`, `resolution_reason`.
   - `artifacts`: Tracks `id`, `name`, `type`, `mime_type`, `current_version`, `content_hash`, `file_path`, `content_text`, `agent_id`, `run_id`, `goal_id`, `task_id`, `metadata`, `created_at`, `updated_at`.
   - `artifact_versions`: Historical snapshots of artifacts per version with cascading foreign keys.
   - `replay_logs`: Step-by-step logs of model I/O, tool calls/outputs, and state transitions.

2. **Storage Layer**:
   - `SqliteApprovalStore`, `SqliteArtifactStore`, and `SqliteReplayStore` implemented behind `ApprovalStore`, `ArtifactStore`, and `ReplayStore` interfaces in `src/storage/stores/types.ts`.
   - Exposed on `SqliteStores` and `EpisodicMemory` facade getters (`getApprovalStore()`, `getArtifactStore()`, `getReplayStore()`).

3. **Task Verification Engine (`src/reliability/verificationEngine.ts`)**:
   - Implements verification logic across all 6 categories:
     - `file_verified`: Verifies disk presence, non-zero size, valid JSON syntax, and content keywords.
     - `page_inspected`: Verifies DOM elements and CSS selectors (`#id`, `.class`).
     - `test_build`: Verifies exitCode 0 and test failure count 0.
     - `sources_checked`: Verifies citation counts and URL formatting.
     - `delivery_result`: Verifies status `sent` / `delivered` / `ok`.
     - `resulting_state`: Verifies expected key-value properties against actual state.

4. **Independent Reviewer (`src/reliability/independentReviewer.ts`)**:
   - Analyzes candidate deliverables in isolation from the actor.
   - Evaluates safety boundaries (flags `rm -rf`, `DROP TABLE`, `eval()`, hardcoded secrets).
   - Validates implementation syntax and groundedness (flags hallucinated packages and fake domains).

5. **Bounded Self-Repair Engine (`src/reliability/selfRepairEngine.ts`)**:
   - Coordinates `classify → diagnose → replan → repair → verify`.
   - Enforces attempt bounding (`maxAttempts: 3`), returning `exhausted: true` if unresolved.

6. **Approval Engine (`src/reliability/approvalEngine.ts`)**:
   - Evaluates actions against the 7 HITL triggers.
   - Persists `ApprovalRequest` and registers `RunWait` (`WAITING`).
   - Cross-process survival: when restarted, queries SQLite and updates `RunWait` to `satisfied`, waking paused runs.

7. **Clarification Manager (`src/reliability/clarificationManager.ts`)**:
   - Formulates single high-impact questions for ambiguous actions.
   - Ingests user answer into prompt context and resumes autonomous execution.

8. **Deterministic Replayer (`src/reliability/deterministicReplayer.ts`)**:
   - Re-executes recorded runs offline from `replay_logs`.
   - Validates bit-for-bit trajectory determinism.

9. **Tools & Capability Registry**:
   - Tools: `approvalRequestTool`, `artifactManageTool`, `verificationInspectTool`.
   - Capabilities: `reliability.task_verification`, `reliability.independent_reviewer`, `reliability.self_repair`, `reliability.approvals_gateway`, `reliability.versioned_artifacts`, `reliability.deterministic_replay` registered with honest status `real`.

## Consequences

- Work outputs are strictly verified before being declared successful.
- High-risk operations cannot bypass human authorization and gracefully survive agent restarts.
- Deliverables are versioned and audited with cryptographic content hashes.
- Buggy outputs undergo automated, bounded self-repair without infinite loop risks.
- Runs can be audited and deterministically replayed offline.
