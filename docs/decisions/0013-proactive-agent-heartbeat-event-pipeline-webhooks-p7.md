# ADR-0013: Proactive Agent Subsystem — Event Pipeline, Heartbeat Engine, and Secure Webhook Ingestion (P7)

- Status: Accepted
- Date: 2026-10-08
- Phase: V2 P7 (Proactive Agent — spec sections 35, 36, 37, 38, 66)

## Context

In Athena V1, execution was fundamentally reactive: the system ran when prompted, executed the assigned task, and stopped. While V1 had an in-memory `EventBus` and `Scheduler`, it lacked true proactive autonomy:
1. **Multi-Stage Event Wake Pipeline (Spec Section 35)**: Events directly waking the main LLM without filtering or relevance scoring creates prohibitive costs and reasoning churn. Athena requires a strict staged pipeline: `Event -> Filter -> Relevance -> Agent Wake -> Reason -> Action`. Cheap rules first, small-model/heuristic relevance second, and main LLM invocation only when genuine intervention is required.
2. **Event-Aware, Cost-Capped Heartbeat (Spec Section 36)**: A proactive agent must periodically inspect obligations (stalled goals, approaching deadlines, parked run waits, unread agent messages). However, the heartbeat must ask "is anything important?", not "generate another response." When nothing is wrong, it must produce a quiet no-op tick at $0 cost. Reasoning spend must be strictly throttled and capped per hour and per day.
3. **Durable Agent Events (Spec Section 37)**: Events must possess a full schema (`traceId`, `agentId`, `goalId`, `taskId`, `runId`, `idempotencyKey`), persist in SQLite to survive crashes, support automatic deduplication, retry policies with exponential backoff, dead-letter queues, and deterministic event replay.
4. **Secure Webhook Ingestion Engine (Spec Section 66)**: Ingestion of external triggers (GitHub, PagerDuty, CI, Slack, custom integrations) requires rigorous defense:
   - Secret authentication and HMAC-SHA256 constant-time signature verification (`crypto.timingSafeEqual`).
   - Replay protection against timestamp skew (>5 minutes).
   - Deduplication against duplicate idempotency keys.
   - Untrusted boundary enforcement and `PromptDefense` sanitization.
   - **Privilege Separation Guard**: Spec Section 66 strictly dictates that webhooks cannot trigger privileged or destructive tools directly (e.g. `cmd:exec`, `writeFile`, `deleteFile`, `computerAction`).
5. **Autonomous Monitoring Triggers (Spec Section 38)**: Automatic detection of stalled goals (active goals with zero progress past a threshold) and site status anomalies that wake the agent to repair or unblock work.

## Decision

1. **Schema Migration 9 (`v2_p7_proactive_agent`)**:
   - `durable_agent_events`: `id`, `topic`, `trace_id`, `agent_id`, `goal_id`, `task_id`, `run_id`, `idempotency_key`, `payload`, `priority`, `source`, `status`, `retry_count`, `max_retries`, `error_message`, `timestamp`, `processed_at`. Indexed by `topic`, `idempotency_key`, `status`, `goal_id`, `agent_id`, `priority`, and `timestamp`.
   - `webhook_endpoints`: `id`, `name`, `secret`, `allowed_topics`, `is_active`, `require_signature`, `metadata`, `created_at`, `updated_at`.
   - `webhook_receipts`: `id`, `endpoint_id`, `idempotency_key`, `signature`, `timestamp`, `status`, `source_ip`, `payload_hash`, `created_at`. Indexed by `endpoint_id`, `idempotency_key`, and `created_at`.
   - `heartbeat_logs`: `id`, `agent_id`, `woke_agent`, `reason`, `cost_usd`, `tokens_used`, `active_goals_count`, `timestamp`. Indexed by `agent_id` and `timestamp`.

2. **Storage Layer**:
   - Interfaces in `src/storage/stores/types.ts`: `DurableAgentEventStore`, `WebhookStore`, `HeartbeatStore`.
   - SQLite implementations: `SqliteDurableAgentEventStore`, `SqliteWebhookStore`, `SqliteHeartbeatStore`.
   - Registered in `SqliteStores` and exposed through `EpisodicMemory` facade.

3. **Multi-Stage Event Pipeline (`src/proactive/eventPipeline.ts`)**:
   - Filter stage: topic patterns, quiet hours, cooldown windows, predicate lambdas.
   - Relevance stage: cheap rule / lightweight evaluation yielding score $[0.0, 1.0]$. Only events with score $\ge \text{threshold}$ (0.7) qualify for wake.
   - Rate limiting: max wakes per hour budget guard.
   - Wake stage: dispatches structured event context into agent reasoning.
   - Retries & Dead Letters: automatic retry counter with status update to `dead_letter` upon exhaustion.
   - Event Replay: deterministic replay of past events from SQLite audit log.

4. **Heartbeat Engine (`src/proactive/heartbeatEngine.ts`)**:
   - Configurable `intervalMs`, `costCapPerHourUsd`, `maxDailyCostUsd`, `activeHours`, and `stallThresholdMs`.
   - Proactive inspection evaluates active goals, run waits, and mailbox messages.
   - Normal checks produce quiet no-op ticks ($0 spend, 0 tokens).
   - Cost tracking aggregates spend; throttles agent wake if hourly spend cap is exceeded.

5. **Secure Webhook Ingestion Engine (`src/proactive/webhookEngine.ts`)**:
   - Secret key lookup and constant-time HMAC-SHA256 signature verification.
   - Timestamp skew check ($\le 300,000$ ms) preventing replay attacks.
   - Idempotency key lookup in `webhook_receipts` preventing duplicate ingest.
   - `PromptDefense` payload sanitization.
   - Strict privilege separation guard preventing direct invocation of privileged execution tools.

6. **Monitoring Triggers (`src/proactive/monitoringTriggers.ts`)**:
   - `StalledGoalDetector`: detects goals in `active` status lacking progress updates, emitting `goal:stalled` to wake the agent.
   - `SiteStatusMonitor`: monitors endpoint health, dispatching `monitor:site_down` / `monitor:site_recovered`.

7. **Tools & Capability Registry**:
   - Tools: `proactiveHeartbeatConfig`, `webhookManage`, `eventReplay`.
   - Capability registry seeds 5 capabilities as `real`: `proactive.event_pipeline`, `proactive.heartbeat`, `proactive.durable_events`, `proactive.webhooks`, `proactive.monitoring`.

## Consequences

- **Cost Protection**: Proactive operation does not burn tokens in loops; quiet ticks consume zero LLM tokens and $0.
- **Security & Integrity**: Webhooks cannot be forged, replayed, or used as a vector to bypass tool permissions or execute arbitrary shell commands.
- **Autonomous Recovery**: Stalled goals are caught automatically without human monitoring or manual `/resume` commands.
- **Deterministic Audit & Replay**: All external triggers and system events are durably recorded in SQLite and replayable for debugging.
