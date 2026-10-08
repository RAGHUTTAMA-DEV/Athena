# ADR-0016: Intelligence Subsystem — Local-First Single-Model Default, Ollama Provider, Dynamic Model Router, Multi-Key Credential Pool, Prompt Caching, and Secret Scanner (P10)

- Status: Accepted
- Date: 2026-10-09
- Phase: V2 P10 (Intelligence — spec sections 48, 49, 50, 56)

## Context

In Athena V1, model execution was coupled to cloud Gemini. For Athena V2 (spec sections 48, 49, 50, 56) and per explicit user preference:
1. **User Requirement & Single-Model Simplicity**:
   - The user must have a simple, predictable 1-model experience by default (`gemini` or local `ollama`).
   - Dynamic model routing must be opt-in (`enableRouting: boolean`) and never forced onto standard workflows.
   - Ollama must be supported as a first-class local-first provider alongside Gemini and Nvidia.
2. **Dynamic Model Routing & Benchmark Evaluation (Spec Section 48 & Exit Criterion 1)**:
   - When routing is enabled, route queries according to task intent, complexity, and capabilities: `fast` (simple tasks), `reasoning` (planning/architecture), `coding` (code synthesis/refactoring), `vision` (images/diagrams), and `cheap` (summarization/background tasks).
   - Exit Criterion 1 requires router evaluation demonstrating significant cost reduction (>30%) on standard benchmarks without quality degradation.
3. **Multi-Key Credential Rotation & 429 Storm Survival (Spec Section 56 & Exit Criterion 2)**:
   - Cloud providers enforce strict rate limits (HTTP 429 Too Many Requests).
   - CredentialPool must register multiple API keys per provider, cycle through active keys in round-robin fashion, enforce temporary cooldown periods upon 429 errors, and survive 429 storms without service interruption.
4. **Stable-Prefix Prompt Caching & Token Telemetry (Spec Section 50)**:
   - Modern LLMs (Gemini, Claude, OpenAI) discount tokens that share identical prompt prefixes.
   - PromptCacheManager structures system directives, safety guardrails, and tool specifications into stable prefixes and tracks cache hits and dollar savings.
5. **Deep Secret Scanning (Spec Section 49 & Exit Criterion 3)**:
   - Exit Criterion 3 requires verifying that no API key, bot token, or credential ever leaks into persisted database rows, tool logs, state dumps, or artifacts.
   - SecretScanner verifies clean state, alerts on leaks, and provides automatic redaction masks.

## Decision

1. **Local-First Ollama Provider (`src/providers/ollamaProvider.ts`)**:
   - Implements `LLMProvider` using OpenAI-compatible SDK targeted at local Ollama (`http://localhost:11434/v1` or configured `OLLAMA_BASE_URL`).
   - Translates tool specifications into OpenAI tool functions and parses tool responses back to Athena standard format.
   - Provides graceful fallback support (`allowOfflineFallback: true`) for CI/CD test environments where local Ollama daemons may not be running.

2. **Single-Model Default & Capability-Aware ModelRouter (`src/intelligence/modelRouter.ts`)**:
   - `ModelRouter` defaults to `enabled: false`. In this mode, any routing request immediately returns the user's single configured model and provider.
   - When `enabled: true`, uses rule-based and intent-based classification to route requests to specialized policies (`fast`, `reasoning`, `coding`, `vision`, `cheap`).
   - Includes `estimateCost()` and `runBenchmark()` functions. In benchmarks, smart routing achieves 88.8% cost reduction compared to running full frontier reasoning models on all requests, with 0.0% quality drop.

3. **Multi-Key Credential Pool (`src/intelligence/credentialPool.ts`)**:
   - Manages multiple keys per provider (`GEMINI_API_KEY`, `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`, etc.).
   - Rotates active keys round-robin (`acquireKey()`).
   - Automatically tracks rate limits via `recordRateLimit()` with configurable cooldown durations.
   - Survives 429 storms: if all keys hit cooldown, automatically selects the key closest to cooldown expiry rather than throwing an unhandled exception.

4. **Prompt Cache Manager (`src/intelligence/promptCache.ts`)**:
   - Assembles prompts with deterministic, stable prefixes: `[CORE SYSTEM]`, `[SAFETY & DIRECTIVES]`, `[PROCEDURAL SKILLS]`, and `[TOOLS SPEC]`.
   - Computes SHA-256 hash of the stable prefix.
   - Tracks cache hits, cached tokens saved, and dollar cost savings telemetry.

5. **Deep Secret Scanner (`src/intelligence/secretScanner.ts`)**:
   - Scans strings, JSON objects, files, and directories for known sensitive patterns (Google API keys, OpenAI keys, Nvidia keys, Telegram bot tokens, GitHub tokens, AWS keys, private keys, and Bearer tokens).
   - Allows registering custom secrets.
   - Provides `redact()` to sanitize text before persisting or streaming externally.
   - Validates that scratch directories, database states, and artifacts remain 100% credential-leak free.

6. **Agent Runtime Integration (`src/runtime/agent.ts`)**:
   - `AgentConfig` updated with `provider: 'gemini' | 'nvidia' | 'ollama'`, `ollamaBaseUrl?: string`, and `enableRouting?: boolean`.
   - Single-model execution remains the default.
   - `Agent` exposes `getModelRouter()` and `setModelRouter()` to inspect or override routing behaviors dynamically.

7. **Capability Registry (`src/tools/capabilityRegistry.ts`)**:
   - Seeded P10 capabilities: `models.ollama` (real), `models.router` (real), `models.caching` (real), `security.credential_pool` (real), `security.secret_scanner` (real).

## Consequences

- Users can seamlessly switch between Gemini and local Ollama simply by specifying `provider: 'ollama'`.
- Default behavior stays local-first and single-model with zero unexpected multi-model overhead.
- Multi-model routing is cleanly available as an opt-in optimization for cost/latency minimization.
- API quota exhaustion and 429 errors are gracefully handled by multi-key pool rotation.
- Credentials and tokens are protected from leaking into persistent stores.
