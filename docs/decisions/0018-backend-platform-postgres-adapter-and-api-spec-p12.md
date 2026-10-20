# ADR-0018: Backend Platform, PostgreSQL Storage Adapter, Canonical Event Streaming, and Comprehensive REST API Surface (Phase 12)

- Status: Accepted
- Date: 2026-10-12
- Phase: V2 P12 (Platform & PostgreSQL Backend — spec `athena_v2_phase12_backend_postgres_spec.md`)

## Context

To support a decoupled, production-grade frontend and distributed integrations without compromising Athena's lightweight local developer experience:
1. **Zero-Configuration Local Default**: SQLite must remain the zero-config default for standalone developers and CLI environments.
2. **Enterprise / Shared Storage**: PostgreSQL must be available as an optional, high-concurrency storage adapter behind identical store interfaces (`src/storage/stores/types.ts`).
3. **HTTP Platform & API Layer**: Fastify server hosting versioned `/api/v1` routes with OpenAPI 3.1 Swagger documentation, CORS, rate limits, request IDs, and structured error envelopes.
4. **Canonical Event Streaming**: Type-safe SSE event streams (`GET /api/v1/runs/:runId/events`) supporting `Last-Event-ID` reconnection, bounded ring-buffer replay, and transport heartbeats.
5. **Durable Message Dispatch & Hydration**: Idempotent message submission (`POST /api/v1/sessions/:sessionId/messages`) preventing duplicate execution on HTTP retry, paired with bounded single-roundtrip state hydration (`GET /api/v1/sessions/:sessionId/state`).
6. **Atomic Human Approvals**: Compare-and-set approval resolution preventing race conditions, unblocking durable `RunWait` records.
7. **Artifact Lifecycle & Security**: Immutable versions, line diff generation, and safe path-traversal-guarded raw content streaming.
8. **Subsystem Coverage**: Complete REST coverage across all Athena capabilities (Sessions, Runs, Approvals, Artifacts, Goals, Tasks, Harness, Computer Use, Browser, Research/RAG, Multi-Agent Teams, Learning/Skills, Communication/Calendar, Proactive/Webhooks, Reliability, Tools/MCP, Models/Intelligence, System/Health).
9. **UI Independence**: Backend code must contain zero imports of React, DOM APIs, or frontend frameworks.

## Decisions

1. **Storage Adapter & Factory Architecture**:
   - Implemented `PostgresDatabase` with pooling (`pg.Pool`), `withTransaction` isolation, and sequential migration runner in `src/storage/postgres/postgresDatabase.ts`.
   - Created all 12 PostgreSQL schema migrations in `src/storage/postgres/postgresMigrations.ts` mapping 1:1 with SQLite migrations.
   - Built PostgreSQL implementations for all stores in `src/storage/postgres/postgresStores/index.ts` conforming strictly to `src/storage/stores/types.ts`.
   - Built `StoreFactory` (`src/storage/storeFactory.ts`) selecting between `sqlite` (default) and `postgres` based on `DATABASE_DRIVER` environment variable. Fails fast if PostgreSQL is configured without a valid `DATABASE_URL`.
   - Storage parity verified: both adapters share identical interface contracts, status codes, and error semantics.

2. **Platform & Server (`src/api/server.ts`)**:
   - Used Express for robust, standard, and widely supported HTTP execution.
   - Configured `cors` middleware with configurable allowed origins.
   - Integrated OpenAPI 3.1 schema specification (`/api/v1/openapi.json`) and interactive Swagger UI documentation at `/docs`.
   - Added global request-ID tracing (`x-request-id`) and structured error envelopes (`{ error: { code, message, requestId, details } }`).
   - Implemented `/health/live` and `/health/ready` checking storage connectivity.

3. **Canonical Event Protocol & SSE Streaming**:
   - Canonical envelope `AthenaEventEnvelope<TType, TData>` defined in `src/api/events/eventEnvelope.ts` with strict schema versioning.
   - `SseConnectionManager` in `src/api/events/sseManager.ts` managing client lifecycles, ring-buffer event replay from `Last-Event-ID`, and periodic heartbeats.

4. **Durable Dispatch, Hydration, Approvals, and Artifacts**:
   - `DispatchService` (`src/api/services/dispatchService.ts`): Deduplicates run creation using client idempotency keys, stores initial message, and returns durable run tracking URLs.
   - `HydrationService` (`src/api/services/hydrationService.ts`): Assembles complete session view (session metadata, recent messages, active run, pending approvals, tasks, artifacts) in a single bounded payload.
   - `ApprovalService` (`src/api/services/approvalService.ts`): Enforces atomic decision recording, rejecting duplicate resolutions with `409 Conflict`, and resolves paused `RunWait` states.
   - `ArtifactService` (`src/api/services/artifactService.ts`): Computes line-by-line diffs between immutable versions, guards raw downloads against directory traversal attacks.

5. **Resource Routes (`src/api/routes/`)**:
   - Dedicated modules covering all 20 subsystems with consistent authorization headers (`Authorization: Bearer <key>`, `x-workspace-id`).

6. **Generated Client SDK & UI Independence Checker**:
   - Produced standalone typed SDK client `AthenaClient` in `src/api/client/athenaClient.ts`.
   - Automated CI verification script in `src/tests/checkUiIndependence.ts` enforcing zero frontend code in backend modules.

## Consequences & Verification

- **Verification**: Verified via `npm run test:v2p12` passing 10/10 comprehensive tests.
- **Backwards Compatibility**: All existing V1 and V2 tests (including P11 Reliability and P1 Core) continue to pass without modifications. SQLite continues as default.
- **Frontend Readiness**: The frontend team can build modern React/Next.js/desktop UIs using the OpenAPI specification and typed `AthenaClient` without tight coupling to backend runtime internals.
