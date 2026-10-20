# Athena V2 — Phase 12 Backend & PostgreSQL Implementation Specification

**Status:** Proposed implementation specification  
**Scope:** Backend platform, API contracts, event streaming, approvals, artifacts, PostgreSQL adapter, production configuration, and backend verification  
**Explicitly out of scope:** Frontend implementation, visual design, UI component work, and frontend-specific state management

---

## 1. Purpose

Phase 12 exposes Athena's existing core capabilities through a reliable backend platform and adds PostgreSQL as an alternative storage adapter without rewriting the agent runtime.

The implementation must preserve these architectural constraints:

1. **SQLite remains the default local database.** A new user should be able to clone Athena, configure the minimum required environment, and run it without a PostgreSQL server.
2. **PostgreSQL is an optional adapter** selected through configuration for deployments that need a shared, server-grade database.
3. **Existing store interfaces remain the contract.** Reuse the interfaces in `src/storage/stores/types.ts` and the current core architecture. Do not rewrite core services around SQL or introduce database-specific behavior into the agent runtime.
4. **The backend is UI-independent.** No React, HTML, CSS, browser UI, or frontend framework imports in core or platform business logic.
5. **The API exposes capabilities, not implementation details.** Clients must not access database tables or invoke internal runtime functions directly.
6. **The backend must be testable without a frontend.** API, storage, streaming, safety, and lifecycle behavior are validated with automated tests.

This document is an implementation contract. Before coding, inspect the current repository and adapt names and paths to the existing architecture. Do not replace existing abstractions merely to match the examples below.

---

## 2. Phase 12 outcomes

At completion, Athena should have:

- A versioned HTTP API under `/api/v1`.
- A unified, durable message-dispatch operation that creates or resumes agent runs safely.
- A typed, versioned event protocol for execution updates.
- Reconnectable SSE streams with event IDs and replay semantics.
- Run status, cancellation, and state-hydration APIs.
- Transaction-safe human approval decisions.
- Artifact metadata, immutable versions, diffs, and raw-content retrieval.
- REST APIs for existing supported domains: agents, users, workspaces, projects, sessions, goals, tasks, runs, memory, skills, routines, artifacts, approvals, events, tools, models, integrations, and MCP management.
- PostgreSQL implementations for applicable existing store interfaces, while retaining SQLite as the default.
- Storage parity tests for SQLite and PostgreSQL.
- OpenAPI 3.1 output generated from canonical schemas, plus a generated TypeScript API client where practical.
- Authentication, authorization, request validation, rate limits, CORS configuration, health checks, readiness checks, and structured errors appropriate to the supported deployment mode.
- An optional remote `ExecutionBackend` contract that does not make remote execution mandatory.
- CI checks proving that core and backend modules remain independent of frontend code.

Do not mark a capability complete merely because a route exists. It must be connected to the real service/store, validated, authorized, tested, and documented.

---

## 3. Architecture and dependency boundaries

### 3.1 Logical architecture

```text
HTTP Clients / CLI / Future UI
            |
            v
API Platform
  - routing and versioning
  - authentication and authorization
  - schema validation
  - rate limiting and request IDs
  - OpenAPI generation
            |
            +----------------------+
            |                      |
            v                      v
REST Controllers             Event Streaming
            |                - SSE subscriptions
            |                - replay and reconnect
            |                - heartbeat and backpressure
            +----------+-----------+
                       |
                       v
              Application Services
       - session/message dispatch
       - run lifecycle and cancellation
       - approvals and safety policies
       - goals/tasks and artifacts
       - memory, tools, integrations
                       |
                       v
                 Athena Core
       - agent runtime and orchestration
       - planning and delegation
       - tool execution and safety
       - observability and trajectory
                       |
                       v
                Store Interfaces
             src/storage/stores/types.ts
                       |
              +--------+--------+
              |                 |
              v                 v
       SQLite Adapters    PostgreSQL Adapters
       local default      optional deployment
```

The diagram is logical. Preserve current module boundaries and avoid duplicating existing services.

### 3.2 Dependency rules

- HTTP controllers may depend on application services and API schemas.
- Application services may depend on core services and store interfaces.
- Store implementations may depend on database drivers and database-specific queries.
- Core logic must depend on store interfaces, not concrete SQLite/PostgreSQL adapters.
- Event transport must not own agent business logic.
- OpenAPI generation must consume the canonical request/response schemas.
- The generated client is a consumer artifact, not a dependency of core runtime code.
- Frontend code, if added later, must consume the API and must not be imported by backend or core modules.

### 3.3 HTTP framework

Use **Fastify** as the proposed platform HTTP server unless the repository already has a well-established server that would make replacement unjustified. Do not add Fastify and Hono together.

Use a compatible schema-validation and OpenAPI integration. If Zod is selected, confirm that the chosen integration correctly supports the required OpenAPI 3.1 features. Avoid maintaining independent, handwritten copies of the same API schema.

Framework selection must prioritize maintainability, plugin compatibility, streaming correctness, and TypeScript ergonomics. Do not base the decision on unverified throughput claims.

---

## 4. Storage architecture: SQLite and PostgreSQL

### 4.1 Configuration

Use one explicit database driver setting:

```dotenv
DATABASE_DRIVER=sqlite
# DATABASE_DRIVER=postgres
```

SQLite is the default when the setting is absent, unless existing project configuration establishes another compatible default.

Example PostgreSQL configuration:

```dotenv
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME
```

Requirements:

- Never commit real credentials.
- Validate configuration at startup.
- Fail fast if PostgreSQL is selected but the URL is absent or invalid.
- Do not silently fall back from PostgreSQL to SQLite after a connection failure.
- Never silently create a second database because a configured database is unavailable.
- Redact credentials and sensitive connection parameters from logs.
- Document local SQLite setup and PostgreSQL setup separately.

### 4.2 Adapter implementation rules

1. Inspect every existing interface in `src/storage/stores/types.ts` and enumerate its implementation and call sites.
2. Map each interface to the existing SQLite implementation, if one exists, and its proposed PostgreSQL counterpart.
3. Preserve public interface behavior unless a deliberate interface change is reviewed and documented.
4. Keep SQL, database-specific types, and driver imports inside storage adapter modules.
5. Use parameterized queries or safe query-builder operations. Never interpolate untrusted input into SQL.
6. Use explicit transactions for multi-step mutations that must succeed or fail together.
7. Add migrations for PostgreSQL and keep migration history/versioning deterministic.
8. Define ordering for list queries; never depend on unspecified database row order.
9. Handle uniqueness conflicts, missing records, concurrent updates, and transaction failures consistently.
10. Use database-appropriate indexes based on actual query patterns.
11. Ensure store factory/composition logic selects the configured adapter consistently across all stores.
12. Ensure shutdown closes pools and database connections cleanly.

Do not assume every store should have a one-to-one SQL table or that all stores need the same schema. Inspect the current persistence model first.

### 4.3 Parity means behavioral parity

SQLite and PostgreSQL need not use identical SQL. They must satisfy the same observable store contract.

Create a reusable store conformance test suite that runs against both implementations where applicable. Include:

- Create, read, update, delete, and upsert semantics.
- Missing-record behavior.
- Uniqueness and duplicate handling.
- Filtering, pagination, and deterministic ordering.
- Transaction atomicity.
- Concurrent writes and optimistic concurrency, where supported.
- Timestamp precision and time-zone behavior.
- JSON serialization and deserialization.
- Nullability and default values.
- Migration from an empty database.
- Migration from a supported previous schema.
- Cleanup and connection lifecycle.
- Error mapping for expected database failures.

Use a real PostgreSQL instance for PostgreSQL integration tests, for example a disposable CI service/container. Do not treat SQLite tests or mocked PostgreSQL drivers as proof of PostgreSQL compatibility.

### 4.4 Cross-store consistency

If a single business operation writes to multiple stores, document its consistency model. Prefer a transaction when the operation uses one database and the affected data can be committed atomically. If cross-store atomicity is impossible, use an explicit recovery/outbox pattern or a compensating operation rather than pretending the writes are atomic.

For durable run dispatch, message persistence, run creation, and event publication must not leave the system in a permanently inconsistent state. Where event publication cannot participate in the database transaction, use a transactional outbox or an equivalent durable handoff.

### 4.5 Existing vector or file storage

Do not assume PostgreSQL automatically replaces every current storage backend.

- If semantic memory uses a vector database or a separate index today, preserve that capability behind its existing abstraction.
- If PostgreSQL/pgvector support is intended, treat it as an explicit adapter/capability with migrations, index strategy, and tests.
- Keep binary artifacts and large files out of ordinary metadata rows unless the existing architecture intentionally stores them there.
- Define a separate blob/file-storage abstraction if needed, with clear local and remote implementations.
- Do not introduce a new vector database or object store just because it appears in a generic production architecture.

### 4.6 Store inventory deliverable

Before implementation, produce a table covering every existing store interface:

| Store interface | Current implementation | PostgreSQL implementation | Migration | Conformance tests |
|---|---|---|---|---|
| Each interface in `src/storage/stores/types.ts` | Verified repository path | Planned path or N/A with rationale | Required / not required | Test location |

Fill this from repository inspection. Do not invent the inventory or declare stores complete based only on their names.

---

## 5. API conventions

### 5.1 Base path and versioning

All public endpoints use `/api/v1`.

Use plural resource paths and consistent naming. Keep route handlers thin; business rules belong in application services.

### 5.2 Request validation and errors

Validate path parameters, query parameters, headers, and request bodies at the API boundary.

Use a stable error envelope, for example:

```json
{
  "error": {
    "code": "APPROVAL_ALREADY_RESOLVED",
    "message": "This approval has already been resolved.",
    "requestId": "req_example",
    "details": {}
  }
}
```

Requirements:

- `code` is stable and machine-readable.
- `message` is safe to show to an API consumer.
- `requestId` supports diagnosis.
- `details` contains only safe, structured context.
- Never expose stack traces, secrets, SQL text, raw environment values, or private prompts in production errors.
- Use appropriate HTTP status codes consistently.
- Document all expected error responses in the OpenAPI contract.

### 5.3 Pagination and ordering

Use bounded pagination for sessions, messages, events, artifacts, memory results, runs, and other potentially large collections.

- Set a maximum page size.
- Define stable ordering and a deterministic tie-breaker.
- Prefer cursor pagination for large or continuously changing collections.
- Include pagination metadata or a next cursor.
- Do not return unbounded event histories or artifact contents from list endpoints.

### 5.4 Idempotency and concurrency

Support an idempotency key for operations that can create a run, perform a consequential action, or otherwise cause duplicate work when retried.

For a repeated key with the same logical request, return the original operation/result. Reject conflicting reuse of the same key with a different payload. Define retention and scoping for keys.

Use resource versions, conditional updates, or equivalent concurrency controls for approvals and artifact edits.

### 5.5 Request context and observability

Generate or accept a validated request ID. Propagate trace context where supported. Associate events and logs with relevant identifiers such as workspace, session, run, tool call, and approval, while excluding secrets and sensitive content from ordinary logs.

---

## 6. Unified message dispatch and run lifecycle

### 6.1 Submit a message

**Endpoint:** `POST /api/v1/sessions/:sessionId/messages`

Purpose:

- Validate session access and session state.
- Validate and normalize the user message.
- Persist the user message.
- Create a run or dispatch through the existing execution service.
- Persist a durable run identifier and initial lifecycle state.
- Ensure a durable handoff to execution.
- Return identifiers that let the caller observe the run.

Illustrative request:

```json
{
  "content": "Research the options and prepare a comparison.",
  "attachments": [],
  "metadata": {}
}
```

Illustrative response:

```json
{
  "messageId": "msg_example",
  "runId": "run_example",
  "status": "queued",
  "eventsUrl": "/api/v1/runs/run_example/events"
}
```

The actual message schema must follow existing Athena message and attachment models. Do not accept arbitrary tool instructions or privileged execution parameters through unvalidated metadata.

Requirements:

- Require an idempotency key for run-creating submissions.
- Do not run the same logical request twice after an HTTP retry.
- Persist the user message and run state before acknowledging successful durable dispatch.
- Do not keep the POST request open for the entire agent run as the only way to receive output.
- Return a run identifier even if execution continues in the background.
- Define behavior when the session is invalid, archived, busy, or inaccessible.
- Define queueing and concurrency rules for multiple messages in one session.
- Preserve the existing runtime's orchestration and safety checks.

### 6.2 Session state

**Endpoint:** `GET /api/v1/sessions/:sessionId/state`

Return a bounded hydration view containing:

- Session metadata and current status.
- Recent messages with pagination/cursor information.
- Active or most recent run summary.
- Current run state and progress summary.
- Pending approvals visible to the caller.
- Relevant active task/subagent summaries if those concepts exist in the current core.
- References to artifacts and other resources needed to restore the view.

Do not return the full unbounded history, full trajectory, all memory, or all artifacts in one response.

### 6.3 Run state

Define and document a stable run lifecycle. Suggested states:

- `queued`
- `running`
- `waiting_for_approval`
- `cancelling`
- `succeeded`
- `failed`
- `cancelled`

Adapt these states to the existing runtime rather than creating contradictory parallel state machines. Define legal transitions, terminal states, retry semantics, and how partial results are represented.

### 6.4 Get and cancel runs

- `GET /api/v1/runs/:runId`: authoritative run state and summary.
- `POST /api/v1/runs/:runId/abort`: request cancellation.
- `GET /api/v1/runs/:runId/replay`: bounded or paginated execution trajectory.
- `GET /api/v1/runs/:runId/events`: live/reconnectable event stream.

Cancellation is a request, not a guarantee that an arbitrary external tool stops instantaneously. Report the true state and define cancellation boundaries for running tools. Never mark a run cancelled while a non-cancellable operation is still actively running unless the status model explicitly distinguishes requested cancellation from confirmed termination.

---

## 7. Versioned event protocol and SSE

### 7.1 Canonical event envelope

Define a canonical, runtime-validated event envelope shared by the event store, publisher, SSE transport, and generated TypeScript types.

Illustrative TypeScript shape:

```typescript
type AthenaEventEnvelope<TType extends string, TData> = {
  eventId: string;
  schemaVersion: 1;
  type: TType;
  timestamp: string;
  workspaceId?: string;
  sessionId?: string;
  runId?: string;
  data: TData;
};
```

The final contract should use the repository's ID types and schema conventions. IDs and timestamps must be generated/validated by trusted backend code.

### 7.2 Initial event types

Define events according to real backend capabilities. Candidate event families:

- `run.queued`
- `run.started`
- `run.progress`
- `run.waiting_for_approval`
- `run.cancellation_requested`
- `run.completed`
- `message.started`
- `message.delta`
- `message.completed`
- `agent.progress`
- `tool.started`
- `tool.progress`
- `tool.completed`
- `subagent.started`
- `subagent.progress`
- `subagent.completed`
- `approval.required`
- `approval.resolved`
- `artifact.created`
- `artifact.updated`
- `task.updated`
- `heartbeat` (transport-level if appropriate)

Use a small, documented event vocabulary. Do not emit events for features the runtime does not actually support. A tool result should include safe summaries and references, not secrets or unlimited raw output.

Do not expose private chain-of-thought. `agent.progress` should contain concise, user-facing progress summaries, current stage, and observable actions, not hidden internal reasoning.

### 7.3 SSE endpoints

- `GET /api/v1/runs/:runId/events`
- `GET /api/v1/sessions/:sessionId/events` for session-scoped events not limited to one run, if needed.

The run stream is the primary execution stream. Avoid maintaining multiple competing event protocols.

### 7.4 Delivery and reconnect semantics

SSE must support:

- `Content-Type: text/event-stream`.
- Event IDs compatible with `Last-Event-ID`.
- Reconnection without resubmitting the message.
- Replay of retained events after the last acknowledged ID.
- A documented retention window and behavior when the requested cursor is too old.
- Heartbeats to keep supported connections alive.
- Backpressure and bounded buffering.
- Cleanup when a client disconnects.
- Authorization on initial connection and every resource scope.
- A terminal run event or a clear way to discover terminal state.
- Event ordering guarantees within the defined scope.
- Duplicate-safe event processing.
- A recovery path using `GET /runs/:id` when replay is no longer possible.

Do not claim exactly-once network delivery. Use durable event IDs, at-least-once delivery where applicable, and idempotent consumers to achieve reliable behavior.

### 7.5 Durable publication

Critical lifecycle events must not be lost between database commit and event publication. Use a transactional outbox or an equivalent durable publication mechanism where event persistence and publication are separate.

Define how the event publisher retries, marks published records, handles poison events, and avoids unbounded backlog.

---

## 8. Human approval and safety APIs

### 8.1 Endpoints

- `GET /api/v1/approvals/pending`
- `GET /api/v1/approvals/:approvalId`
- `POST /api/v1/approvals/:approvalId/decision`

Optional list filters may include workspace, run, status, and cursor.

### 8.2 Decision contract

Illustrative request:

```json
{
  "status": "approved",
  "reason": "Approved for this task",
  "modifiedParams": {}
}
```

`modifiedParams` must be validated against the specific action's schema and safety policy. Do not accept arbitrary modifications just because the field is JSON.

Requirements:

- Authorize access to the approval and the underlying workspace/run.
- Validate the current approval state and expiry.
- Make the decision atomic using a transaction or compare-and-set/version check.
- Ensure only one competing decision can succeed.
- Make repeated identical requests safe where appropriate.
- Return a conflict for already-resolved or stale approvals.
- Enforce expiry on the server, not only in the client.
- Record actor, decision, timestamp, reason, and applicable policy/version metadata.
- Emit a durable `approval.resolved` event.
- Resume or unblock the run through the existing execution/safety service only after a valid approved decision.
- Rejected, expired, or invalid approvals must not execute the protected action.

Approval events should be available through the run event stream. Session/workspace notifications may reference the same approval record.

---

## 9. Artifacts and version history

### 9.1 Endpoints

- `GET /api/v1/artifacts`
- `GET /api/v1/artifacts/:artifactId`
- `GET /api/v1/artifacts/:artifactId/versions`
- `GET /api/v1/artifacts/:artifactId/diff?fromVersionId=...&toVersionId=...`
- `GET /api/v1/artifacts/:artifactId/raw`

Add create/update endpoints only where they map to existing authorized artifact operations. Do not create a parallel artifact-writing path that bypasses core policy.

### 9.2 Artifact model requirements

Each artifact should have stable identity and metadata appropriate to the existing model, including where applicable:

- Artifact ID and workspace/session/run association.
- Name, kind, media type, and metadata.
- Current version ID.
- Created/updated timestamps and provenance.
- Content reference or storage location.
- Version history with immutable version IDs.
- Content hash or equivalent integrity metadata.

Treat artifact content separately from metadata when content is large. Apply size limits and stream raw content instead of loading arbitrarily large files into memory.

### 9.3 Version and diff semantics

- Versions are immutable.
- Diffs identify exact source and target version IDs.
- Missing or inaccessible versions return stable errors.
- Rollback creates a new version based on an older version rather than deleting history.
- Concurrent writes must detect stale base versions or use explicit conflict resolution.
- Define diff formats and size limits.
- Avoid computing expensive diffs synchronously for arbitrarily large files; introduce bounded processing or asynchronous jobs if needed.

### 9.4 Raw-content security

- Authorize every content request.
- Prevent path traversal and arbitrary filesystem reads.
- Do not expose internal absolute paths.
- Set correct content types and safe download headers.
- Apply file size and range-request rules as appropriate.
- Treat generated content and uploaded content as untrusted input.

---

## 10. REST resource surface

Implement endpoints for the resources Athena actually supports today. Reuse existing services and stores; do not fabricate new subsystems to satisfy a route checklist.

Proposed resource families:

| Resource family | Minimum API surface | Notes |
|---|---|---|
| Agents | List/get and supported configuration operations | Do not expose secrets or internal runtime objects. |
| Users/workspaces | Read/create/update and membership operations where supported | Authorization must be enforced on every scoped resource. |
| Projects | List/get/create/update as supported | Preserve existing project model. |
| Sessions/messages | List/get/create and message dispatch | Include pagination and stable run association. |
| Goals | List/get/create/update and pause/resume if supported | Enforce legal lifecycle transitions. |
| Tasks | List/get and supported task operations | Return dependency and status information consistently. |
| Runs | List/get/cancel/replay/events | Run state must be authoritative. |
| Memory | Search/get and existing review/validation/quarantine actions | Respect scope, provenance, and safety rules. |
| Skills | List/get and supported lifecycle/configuration operations | Do not allow untrusted skill content to bypass policy. |
| Routines | List/get/create/update and run controls if supported | Validate schedules and execution permissions. |
| Artifacts | List/get/versions/diff/raw | See artifact contract above. |
| Approvals | Pending/get/decision | Transaction-safe, audited, expiring decisions. |
| Events | Scoped event history where authorized | Bounded and paginated; do not expose internal secrets. |
| Tools | Discover/list/get and supported configuration | Separate metadata from invocation permissions. |
| Models | List available configured models and safe metadata | Never expose provider credentials. |
| Integrations | List/status/configuration operations supported by the current system | Secret values must be write-only or redacted. |
| MCP | Server/connection management and tool filtering | Enforce allowlists, permissions, and safe lifecycle controls. |

For each resource family, document the methods, request/response schemas, authorization rule, pagination behavior, expected errors, and integration tests.

Do not implement speculative CRUD operations when the core has no corresponding capability. Mark them as deferred or return a documented unsupported capability response where appropriate.

---

## 11. MCP management and tool filtering

MCP server configuration and tool exposure are security-sensitive.

Requirements:

- Distinguish configured servers, connected servers, discovered tools, and permitted tools.
- Use explicit allowlists or equivalent policy controls for tools exposed to a given agent/run.
- Validate server configuration and connection lifecycle.
- Keep credentials and secret parameters out of API responses and logs.
- Prevent one workspace from changing or invoking another workspace's integrations without permission.
- Apply execution policy at the backend, not only in client-side filters.
- Record tool identity, source server, permission decision, and safe execution outcome in the event/trajectory record.
- Define timeouts, failure handling, and disconnect behavior.
- Do not let remote MCP metadata override system safety policy or API authorization.

---

## 12. Browser and terminal execution APIs

Implement these only where supported by the existing browser/terminal services.

### 12.1 Browser

Proposed endpoints:

- `GET /api/v1/browser/profiles`
- `GET /api/v1/browser/sessions/:browserSessionId`
- `GET /api/v1/browser/sessions/:browserSessionId/snapshot`

For continuous visual updates, select a transport appropriate to the existing browser implementation. Avoid pushing high-frequency base64 frames through SSE by default.

Requirements:

- Authorize access to the browser profile/session.
- Expose only safe metadata and permitted visual output.
- Do not expose browser cookies, storage secrets, authentication tokens, or unrestricted profile filesystem paths.
- Define snapshot size and update limits.
- Make browser lifecycle and navigation observable through structured events.
- Document whether a browser session is read-only, controllable, or both.

### 12.2 Terminal

Proposed endpoints:

- `GET /api/v1/runs/:runId/terminal/stream` or an equivalent run-scoped log stream.
- A dedicated bidirectional WebSocket or terminal protocol only if interactive stdin/resize is a real supported requirement.

Requirements:

- Prefer a run-scoped stream for stdout/stderr and execution status.
- Enforce output limits, redaction, and retention.
- Do not expose arbitrary host shell access to remote clients by default.
- Bind terminal access to a specific authorized execution context.
- Validate interactive input and define terminal lifecycle semantics.
- Close sessions and clean up resources after termination.
- Document isolation boundaries for local and remote execution.

SSE is suitable for one-way logs. Use WebSocket only for actual bidirectional requirements, not simply because it is available.

---

## 13. Execution replay and telemetry

### 13.1 Replay

**Endpoint:** `GET /api/v1/runs/:runId/replay`

Return a bounded, ordered trajectory of observable execution steps, with pagination where necessary. Reuse the existing replay/trajectory store.

A replay record may reference:

- Run and step IDs.
- Timestamp and step type.
- Tool invocation/result references.
- Safe model request/response metadata.
- State-change summaries.
- Artifact version references.
- Approval events.
- Error and retry information.

Do not expose provider credentials, secrets, or hidden chain-of-thought. Apply redaction policies to prompts, tool outputs, and sensitive data. Distinguish missing data from a step that did not occur.

### 13.2 Telemetry

**Endpoint:** `GET /api/v1/telemetry/metrics`

Scope results by authorization and time range. Where supported, include:

- Run success/failure/cancellation counts.
- Model latency and token usage.
- Tool latency and failure rates.
- Queue delay and event-delivery lag.
- Estimated cost, with source and estimation semantics.
- Storage or integration health.

Do not invent precision or return metrics that the instrumentation does not collect. Apply bounded queries and aggregation to avoid expensive unrestricted scans.

---

## 14. Remote ExecutionBackend contract

Add an optional `ExecutionBackend` plug-in contract only after examining the existing execution model.

The contract should define:

- Capability discovery.
- Submit/start behavior.
- Execution identifier mapping.
- Status and result retrieval.
- Cancellation request and terminal-state reporting.
- Log/event delivery.
- Timeouts and failure semantics.
- Resource cleanup.
- Authentication and isolation requirements.
- Health checks and graceful shutdown.

Requirements:

- Local execution remains available according to current behavior.
- The agent runtime must not depend on a specific remote provider.
- Remote execution must not bypass safety policies, approval gates, tool permissions, or workspace authorization.
- Avoid putting transport-specific logic in agent planning code.
- Test with a deterministic fake backend and at least one real backend only if that backend is actually being delivered in this phase.
- Do not claim remote execution is production-ready just because the interface exists.

---

## 15. Authentication, authorization, and production security

Choose authentication according to the supported deployment model. A single-user local mode and a remotely accessible multi-user server have different threat models; document both. Do not expose a development server to a network without appropriate protection.

Required controls:

- Validate credentials on protected routes.
- Enforce workspace/resource ownership and membership server-side.
- Use least-privilege permissions for approvals, integrations, MCP, browser, terminal, and remote execution.
- Configure CORS with explicit allowed origins; do not use wildcard origins with credentialed requests.
- Apply rate limits to expensive operations and authentication-sensitive routes.
- Limit request body sizes, upload sizes, event buffers, and execution output.
- Validate uploaded file types/content where applicable.
- Redact secrets and sensitive values from logs, telemetry, errors, and traces.
- Protect against path traversal, injection, SSRF through integrations/browser tools, and cross-workspace access.
- Define request timeouts, execution timeouts, and graceful shutdown behavior.
- Keep provider secrets server-side and redact them in API responses.
- Record audit events for security-sensitive changes and approval decisions.

Do not build custom cryptography or invent an authentication scheme. Prefer established libraries and mechanisms compatible with the deployment model.

---

## 16. Configuration, health, and lifecycle

Validate environment variables once during startup and expose a sanitized configuration summary for diagnostics.

Provide:

- `GET /health/live`: process liveness.
- `GET /health/ready`: readiness based on required dependencies.
- Optional dependency/diagnostic details behind authenticated or internal-only access.

Readiness must check the configured storage driver and other required dependencies. Do not expose environment values, database URLs, or secrets in health responses.

Also implement:

- Graceful shutdown of HTTP server, event publisher, workers, and database pools.
- Cleanup of abandoned SSE subscriptions.
- Recovery of queued/running executions according to documented runtime semantics.
- Startup migration policy that avoids unsafe concurrent migration runs.
- Structured logs with request/run correlation.
- Production-safe error handling.
- Explicit configuration documentation and examples.

---

## 17. OpenAPI 3.1 and generated TypeScript client

### 17.1 Canonical contract

- Define request/response schemas once.
- Generate or derive OpenAPI 3.1 from the canonical schemas.
- Validate incoming requests and outgoing responses where practical.
- Generate a TypeScript client from the published schema.
- Keep generated files reproducible and CI-checked.
- Document authentication, pagination, errors, idempotency, and concurrency semantics.
- Include examples that match the actual implementation.

### 17.2 Event contracts

OpenAPI does not fully define the runtime behavior of SSE or WebSocket streams. Define the event envelope and event payload schemas independently but in the same canonical contract package. Generate or share TypeScript types from those schemas.

Document event IDs, reconnect behavior, replay limits, ordering guarantees, and terminal-state behavior.

### 17.3 Contract tests

CI should fail when:

- The generated OpenAPI differs from the committed/generated artifact unexpectedly.
- A route accepts a payload that violates its declared schema.
- A response violates the documented response contract.
- The generated client no longer compiles against examples or contract tests.
- Event payloads do not validate against their declared event schemas.

Do not promise “100% typed hooks” from OpenAPI alone. The generated client can type HTTP calls; application-specific hooks and streaming behavior require deliberate implementation.

---

## 18. Testing strategy

### 18.1 Unit tests

Test:

- Application service behavior.
- Run lifecycle transitions.
- Idempotency handling.
- Approval decision policy.
- Artifact version/conflict logic.
- Event schema validation and serialization.
- Authorization decisions.
- Error mapping and configuration validation.

### 18.2 Storage conformance tests

Run applicable shared store tests against both SQLite and PostgreSQL. Include migration tests and concurrency cases. PostgreSQL tests must use PostgreSQL.

### 18.3 API integration tests

Test:

- Authentication and unauthorized access.
- Request validation and consistent errors.
- Message submission and duplicate retry.
- Durable run creation and execution handoff.
- Session state hydration and pagination.
- Run status and cancellation.
- SSE event delivery, reconnect, replay, and retention-expiry recovery.
- Approval races, expiry, rejection, and successful resume.
- Artifact versioning, diffs, raw content, and access control.
- MCP/tool permission enforcement.
- Upload validation, if upload support is implemented.
- Health/readiness behavior.
- Rate limits and request-size limits.

### 18.4 Failure-injection tests

Test at least:

- Database unavailable at startup.
- Database disconnect during a mutation.
- Process termination after run persistence but before dispatch.
- Process termination after event persistence but before publication.
- Event publisher unavailable or behind.
- Client disconnect during SSE.
- Duplicate message submission.
- Two approval decisions racing.
- Cancellation while a tool is running.
- Stale artifact version update.
- Remote execution backend timeout or disconnect, if enabled.

The system must recover or return an explicit failure state; it must not silently lose work.

### 18.5 UI independence check

Even though frontend implementation is out of scope, add automated checks that:

- Core and storage modules do not import React, DOM APIs, or frontend-only packages.
- API/platform modules do not import frontend components.
- Core unit tests run without a browser environment.
- Backend integration tests run without starting a frontend dev server.

---

## 19. Suggested implementation sequence

Work incrementally. Inspect the repository and establish a baseline before changing code.

### P12.0 — Repository audit and design decisions

- Read `athena_v2_build_plan.md`.
- Inspect all existing store interfaces and implementations.
- Inspect current runtime, session/message/run lifecycle, event/trajectory store, approvals, artifacts, browser/terminal tools, and execution abstractions.
- Identify what already exists and what is missing.
- Produce a gap matrix with file paths and tests.
- Record any API/architecture decisions that differ from this specification.

**Exit criteria:** no speculative rewrite plan; every planned change maps to an existing module or a clearly justified new module.

### P12.1 — Platform foundation

- Add/complete HTTP server and route registration.
- Establish request IDs, validation, standardized errors, configuration validation, and health endpoints.
- Define authorization middleware/policy interfaces appropriate to the deployment model.
- Establish canonical API and event schemas.
- Add baseline integration tests.

**Exit criteria:** a minimal protected API starts and shuts down cleanly with validated configuration.

### P12.2 — PostgreSQL adapter and migrations

- Inventory the existing stores.
- Implement PostgreSQL adapters behind existing interfaces.
- Add migrations and deterministic adapter selection.
- Build shared store conformance tests.
- Verify SQLite remains the default and continues to pass all relevant tests.

**Exit criteria:** applicable store contracts pass against both databases; no core rewrite is needed.

### P12.3 — Message dispatch and run lifecycle

- Implement durable/idempotent message submission.
- Connect it to the real execution service.
- Define and expose run lifecycle state.
- Implement session state hydration, run retrieval, and cancellation.
- Add durable dispatch recovery.

**Exit criteria:** a message creates one durable run, duplicate retries do not create duplicate work, and run state can be recovered independently of an HTTP connection.

### P12.4 — Event persistence and SSE

- Define the event envelope and supported event union.
- Connect runtime events to a durable event log/outbox as appropriate.
- Implement run/session streams, event IDs, replay, heartbeat, backpressure, and reconnect behavior.
- Add disconnect and failure-injection tests.

**Exit criteria:** clients can reconnect and recover retained events without resubmitting the message.

### P12.5 — Approvals and artifacts

- Implement approval listing, retrieval, atomic decisions, expiry, auditing, and run resume.
- Implement artifact retrieval, immutable versions, diff, raw-content streaming, and conflict detection.
- Add access-control and concurrency tests.

**Exit criteria:** approval races cannot execute a protected action twice, and artifact history is stable and recoverable.

### P12.6 — Remaining supported resource APIs

- Add routes for goals, tasks, memory, skills, routines, tools, models, integrations, MCP, browser, telemetry, and replay according to existing capability.
- Implement pagination, permissions, schemas, and tests.
- Mark unsupported or deferred capabilities explicitly.

**Exit criteria:** no route is merely a stub presented as a completed feature.

### P12.7 — OpenAPI, generated client, and CI

- Generate OpenAPI 3.1 and the TypeScript API client.
- Add contract validation and generation checks.
- Add frontend-independence checks.
- Document local SQLite and PostgreSQL setup.
- Document API, event, security, and migration contracts.

**Exit criteria:** generated contracts are reproducible and CI catches drift.

### P12.8 — Production hardening

- Validate startup and shutdown behavior.
- Add request and execution limits, security checks, rate limits, logging redaction, and dependency readiness.
- Run full SQLite/PostgreSQL, API, streaming, and failure-injection suites.
- Verify the local quickstart works without PostgreSQL.

**Exit criteria:** all required checks pass, documented limitations are explicit, and no unimplemented feature is represented as production-ready.

---

## 20. Definition of Done

Phase 12 is complete only when all applicable criteria are satisfied:

- [ ] Existing architecture and store interfaces were audited before implementation.
- [ ] SQLite remains the default and local quickstart works without PostgreSQL.
- [ ] PostgreSQL is selected explicitly and fails clearly when misconfigured.
- [ ] Applicable stores pass shared behavioral conformance tests against SQLite and PostgreSQL.
- [ ] Migrations work on a fresh database and supported upgrades.
- [ ] Message dispatch is durable and idempotent.
- [ ] Run state and cancellation semantics are documented and tested.
- [ ] Events use a canonical, validated, versioned envelope.
- [ ] SSE reconnect and replay work within documented retention limits.
- [ ] Event publication cannot silently lose critical lifecycle events.
- [ ] Approval decisions are authorized, atomic, audited, and expiry-aware.
- [ ] Artifact versions are immutable and diff requests identify exact versions.
- [ ] Browser/terminal access uses explicit authorization and appropriate transports.
- [ ] Resource endpoints use validation, pagination, consistent errors, and permissions.
- [ ] OpenAPI 3.1 and generated client output are reproducible.
- [ ] Authentication, secrets handling, health checks, limits, and graceful shutdown are tested.
- [ ] Remote execution remains optional and respects the same safety boundaries.
- [ ] CI proves backend/core independence from frontend code.
- [ ] Unit, integration, storage, streaming, security, and failure-injection tests pass.
- [ ] Documentation accurately distinguishes implemented, optional, deferred, and unsupported capabilities.

---

## 21. Explicit non-goals for this phase

Do not implement these as part of the backend specification unless repository inspection reveals an existing requirement that must be completed:

- A React/Vite frontend or any visual redesign.
- Frontend-specific hooks, component state, layout, or design tokens.
- A new agent runtime or orchestration rewrite.
- A mandatory PostgreSQL/pgvector dependency for local use.
- A mandatory Redis dependency without a demonstrated architectural need.
- A new vector database or object store without a requirement from existing storage contracts.
- WebSockets for every event stream.
- A remote execution provider merely to prove the interface exists.
- Speculative CRUD routes unsupported by actual Athena capabilities.
- Exposure of private chain-of-thought, credentials, raw secrets, or unrestricted host execution.
- Claims of production readiness based solely on endpoint existence or mocked tests.

---

## 22. Required deliverables

At the end of Phase 12, the repository should contain the applicable items below, using the existing naming conventions:

1. Updated `athena_v2_build_plan.md` with Phase 12 scope and acceptance criteria.
2. A storage inventory and SQLite/PostgreSQL parity report.
3. Database migrations and adapter implementations.
4. HTTP API routes, application-service integration, and validation schemas.
5. Canonical event schemas and SSE/replay implementation.
6. Approval and artifact API implementations.
7. Generated OpenAPI 3.1 specification and TypeScript client.
8. Automated unit, integration, conformance, contract, and failure-injection tests.
9. Environment/configuration examples without real secrets.
10. API, event, storage, security, and local setup documentation.
11. A clear list of deferred capabilities and known limitations.

**Implementation instruction:** Before making changes, inspect the current repository and report the existing implementation, exact gaps, affected files, and test strategy. Then implement in the sequence above. Reuse working code, avoid speculative rewrites, preserve SQLite local-first behavior, and do not begin frontend implementation in this phase.
