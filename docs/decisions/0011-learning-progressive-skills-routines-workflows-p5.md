# ADR-0011: Learning Subsystem — Progressive Skills, Routines, and Learned Workflows (P5)

- Status: Accepted
- Date: 2026-10-08
- Phase: V2 P5 (Learning — spec sections 29, 30, 31)

## Context

In Athena V1, procedural memory consisted of markdown files (`skills/*.md`) parsed into memory wholesale on startup, with basic string search and rudimentary invocation tracking. As the skill library grows, loading full instruction markdown into every context window causes rapid token budget exhaustion.

Furthermore, general-purpose autonomy requires:
1. **Progressive Disclosure (Spec Section 29)**: Lightweight metadata (name, description, tags, version, dependencies, permissions, triggers) stays in memory/index (<50 tokens each). The full instruction body is loaded strictly on-demand when matched or requested.
2. **Review Lifecycle & Telemetry (Spec Section 29)**: New skills begin as `proposed`. They must pass review before automatic context injection and execution. Invocations, success counts, failure counts, and success rates must be tracked.
3. **Autonomous Standing Routines (Spec Section 30)**: Reusable behaviors triggered by events (e.g. `ci.failed`, `email:received`) or schedules (cron), guarded by condition evaluation, and executed with audit tracking and telemetry.
4. **Learned Workflows (Spec Section 31)**: Distillation of successful multi-step task executions into structured, reusable workflows with abstract parameters, conditions, and failure handling — **strictly not raw action recordings or session transcripts**.
5. **Strict Conceptual Separation**: Skill (reusable procedural knowledge), Routine (standing autonomous trigger-to-workflow automation), Goal (long-term objective), Task (executable unit), and Run (execution instance) remain strictly decoupled.

## Decision

1. **Schema Migration 7 (`v2_p5_learning`)**:
   - `routines`: `id`, `name`, `description`, `trigger_type`, `trigger_config`, `workflow`, `conditions`, `permissions`, `enabled`, `success_rate`, `invocations`, `last_run_at`, `history`, `created_at`, `updated_at`.
   - `learned_workflows`: `id`, `intent`, `steps`, `dependencies`, `conditions`, `required_permissions`, `expected_outcome`, `failure_handling`, `source_run_id`, `status`, `review_notes`, `reviewed_by`, `reviewed_at`, `success_rate`, `invocations`, `created_at`, `updated_at`.
   - `skill_records`: `id`, `name`, `version`, `description`, `tags`, `dependencies`, `permissions`, `triggers`, `content_path`, `status`, `invocations`, `success_count`, `failure_count`, `success_rate`, `last_used_at`, `created_at`, `updated_at`.

2. **Storage Layer**:
   - Store interfaces in `src/storage/stores/types.ts`: `RoutineStore`, `LearnedWorkflowStore`, `SkillStore`.
   - SQLite implementations: `SqliteRoutineStore`, `SqliteLearnedWorkflowStore`, `SqliteSkillStore` registered in `createSqliteStores`.

3. **Progressive Skill Manager (`src/learning/progressiveSkillManager.ts`)**:
   - Indexes metadata into memory (<50 tokens per skill).
   - On-demand body retrieval: `loadSkillBody(name)` reads file or database body only when matched.
   - Enforces lifecycle: `proposed` skills require review (`reviewSkill`) before being marked `active`.
   - Telemetry: `recordOutcome(name, success)` maintains rolling success rate and invocation counts.

4. **Routine Engine (`src/learning/routineEngine.ts`)**:
   - Subscribes to `EventBus` topics (exact or wildcards like `ci:*`, `ci.failed`).
   - Condition evaluator: validates event payload against filter criteria (equals, contains, in, greater_than, exists).
   - Reactive dispatcher: triggers routine workflows, records execution history, duration, and updates `successRate`.

5. **Workflow Learner (`src/learning/workflowLearner.ts`)**:
   - Distills successful execution runs into abstract `LearnedWorkflow` records.
   - Generalizes steps, strips ephemeral identifiers (run IDs, timestamps), extracts required permissions and conditions.
   - Review gate: stores as `proposed` until reviewed (`reviewWorkflow`).
   - Promotion: promotes approved workflows into reusable Skills (`promoteToSkill`) or standing Routines (`promoteToRoutine`).

6. **Tools & Integration**:
   - `routineManage`: create, list, trigger, enable, disable, and delete routines.
   - `workflowLearn`: distill, review, list, promote to skill or routine.
   - `ContextEngine`: uses `ProgressiveSkillManager` to search metadata and load candidate skill instructions within token budget.
   - `EpisodicMemory`: facade provides `getRoutineStore()`, `getLearnedWorkflowStore()`, `getSkillStore()`, `getProgressiveSkillManager()`, `getRoutineEngine()`, `getWorkflowLearner()`.

## Consequences

- **Token Efficiency**: Loading 100+ skills consumes only ~5,000 tokens for metadata rather than 100,000+ tokens for full instruction bodies.
- **Autonomy**: Standing routines enable Athena to react autonomously to events (e.g. CI failures) without continuous polling.
- **Safety**: Newly learned workflows and proposed skills cannot execute without explicit review.
- **Traceability**: All routines and skills maintain execution telemetry and success rates.
