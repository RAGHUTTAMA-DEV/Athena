THENA — FINAL PRODUCTION ROADMAP
Implementation plan for Athena + the existing Coding Harness. Build vertically; do not refactor everything at once.
North Star
Adaptive agent runtime: keep a normal LLM/tool loop for simple tasks, and activate planning, verification, repair and the Coding Harness
only when task complexity or risk justifies the extra work. The goal is reliability, recoverability, security and long-running autonomy—not
maximum number of LLM calls.
Core runtime
User → Context → LLM → Tool/Subagent → Result → LLM → … → Persistence
Advanced capabilities are optional: Planner / Verifier / Repairer / Delegator / Coding Harness.
Do NOT make Plan or Verify mandatory LLM calls. Simple questions should remain cheap.
1. AGENT RUNTIME — Athena owns this
• RunState: one authoritative state model for every run.
• Explicit lifecycle: queued → running → waiting → verifying → completed/failed/cancelled.
• Run IDs + parentRunId for sub-agent trees.
• AgentEvent stream for model/tool/subagent/state events.
• Cancellation propagated through every execution layer.
• Resume interrupted runs from persisted state.
• Budget model: time, tokens, cost, tool calls, child-agent budget.
• Termination reasons and structured failures.
• Idempotency keys for retryable side effects.
• Persistence layer with transactional state updates.
2. CONTEXT + MEMORY — Athena owns this
• Context Engine combining system, task, workspace, conversation and retrieved memory.
• Memory scopes: global/user/workspace/project/session/task.
• Memory provenance: source, timestamp, run and evidence.
• Memory confidence instead of treating every stored fact as truth.
• Memory lifecycle: active/confirmed/contradicted/superseded/deleted.
• Contradiction resolution and stale-memory handling.
• User-visible inspect/forget/purge controls.
• Project memory for repositories and long-running work.
• Skill registry with versions, dependencies and success rate.
• Memory retrieval should be budget-aware and context-size aware.
3. TOOL RUNTIME — Athena owns the orchestration contract
• Unified ToolResult: success/data/error/retryable/metadata.
• Tool manifests: schema, version, capabilities and risk level.
• Central timeout policy.
• Retry/backoff only for safe or idempotent failures.
• Circuit breaker for unhealthy tools/MCP servers.
• Tool argument + semantic validation.
• Tool output limits and artifact references for large results.
• Relevant-tool retrieval instead of exposing every tool to every model.
• Parallelism metadata: sequential vs parallel-safe.
• Standard tool telemetry and failure classification.
4. ADAPTIVE ORCHESTRATION — Athena's differentiator
• Simple task → normal agent loop; no planner/verifier tax.
• Medium task → checkpoints + stronger context handling.
• Complex task → create explicit plan with steps/dependencies/success criteria.
• High-risk side effect → policy/approval before execution.
• Coding task → delegate to Coding Harness.
• Tasks requiring proof → invoke verifier.
• Verification failure → repair loop, not immediate final answer.
• Allow dynamic escalation: normal loop → planner → specialist → verifier.
• Keep orchestration decisions observable so runs can be debugged.
• Never let memory or retrieved content override system/policy constraints.
5. CODING HARNESS INTEGRATION — DO NOT DUPLICATE THE HARNESS
• Harness already owns: coding execution, sandbox/policy controls, snapshots/rollback, checkpoints, context handling, MCP recovery and
evaluation infrastructure.
• Athena should call the Harness through a typed CodingTaskRequest.
• CodingTaskRequest: runId, task, cwd/workspace, constraints, allowed capabilities, budget.
• CodingTaskResult: status, summary, filesChanged, tests, diff, checkpointId, verification, artifacts, errors.
• Stream Harness lifecycle events: started/inspecting/editing/testing/failed/repairing/verifying/completed.
• Use one shared run ID across Athena → subagents → Harness → evaluations.
• Pass Athena's high-level plan into the Harness; let the Harness decide low-level coding execution.
• Ask Harness for repository intelligence: stack, package manager, tests, build/lint commands and workspace status.
• After execution, Athena consumes structured test/evaluation results and decides whether the task is actually complete.
• Repair loop: Harness failure → structured failure → Athena decision → Harness repair → verify.
• Checkpoint coordination: Athena requests checkpoint before risky work and rollback when verification requires it.
• Final gate: diff + tests + evaluation + Athena verification + approval when required.
• Do NOT implement a second snapshot engine, rollback system, policy engine, sandbox, secret scanner, checkpoint system or evaluator
inside Athena.
6. BACKGROUND + EVENT RUNTIME
• Persistent scheduler backed by durable state, not process memory.
• Timezone-aware schedules.
• Job leases/locks to prevent duplicate workers.
• Retry/backoff and missed-run recovery.
• Background agent runs separate from interactive chat.
• Event bus for webhooks, GitHub, filesystem, cron and external events.
• Priority queue and worker pool.
• Deduplication and idempotent event handling.
• Pause/resume/cancel/retry/history for long-running jobs.
• Background tasks use the same Athena RunState and observability model.
7. RELIABILITY + SECURITY
• Central policy engine for high-impact actions.
• Prompt-injection trust model: external content is data, not authority.
• Credential isolation and least-privilege tool access.
• Network egress controls for sensitive workspaces.
• Provider/model fallback for rate limits and outages.
• Failure taxonomy: timeout/auth/rate-limit/invalid-input/policy/tool/provider/bug.
• Failure-specific recovery strategies.
• Concurrency limits and backpressure.
• Dry-run mode for side effects.
• Audit trail for approvals, destructive actions and important state transitions.
• Chaos tests: tool timeout, provider failure, MCP disconnect, process crash, corrupted state.
• Recovery tests: restart, resume, rollback, duplicate event and partial execution.
8. OBSERVABILITY + EVALUATION
• OpenTelemetry spans for run → model → tool → subagent → Harness → verification.
• Structured metrics: latency, tokens, cost, retries, failures and success rate.
• Run trajectory debugger.
• Replay mode with recorded tool/model responses.
• Regression benchmark for Athena runtime changes.
• Adversarial evaluation: prompt injection, memory poisoning, tool misuse and malformed outputs.
• Agent quality metrics: task completion, tool correctness, verification accuracy and recovery success.
• Failure dashboard / failure clustering.
• SLOs for important production workflows.
• Keep Langfuse/OTel correlation IDs consistent across Athena and Harness.
9. PLATFORM / PRODUCTION
• Workspace abstraction: root, tools, policy, memory, secrets and budgets.
• API for create/get/cancel/resume runs and stream events.
• CLI, Telegram, Web and other interfaces should use the same runtime API.
• Control-plane UI for runs, memory, jobs, tools, MCP, policies and artifacts.
• Execution graph visualization.
• Durable artifact store.
• Health/readiness/metrics endpoints.
• Authentication + workspace-level authorization in server mode.
• Database migrations and transactional state changes.
• Production profile: Postgres/pgvector + durable queue/workers + OTel + secret management + backups.
