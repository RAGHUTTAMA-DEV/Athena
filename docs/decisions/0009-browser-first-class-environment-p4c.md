# ADR-0009: Browser as First-Class Environment (P4C)

- Status: Accepted
- Date: 2026-10-08
- Phase: V2 P4C (Browser as First-Class Environment — spec section 19)

## Context

In Athena V1, browser interaction was rudimentary: a single-shot `browseUrl` scraper and a simple interactive browser with a global singleton that wrote all session data to a single shared `.browser-session-data` directory. This caused state collisions where distinct agents and tasks shared cookies, storage, and history. Furthermore, there was no tab lifecycle management, no support for complex forms (dropdowns, checkboxes, file uploads), no download interception, no ARIA accessibility tree snapshots, and page text was returned directly to context without passing through PromptDefense.

Athena V2 Spec Section 19 requires:
1. Persistent browser profiles isolated per task/agent (never leaking cookies or session credentials across agents unless explicitly configured).
2. Tab and window management (list, new, switch, close).
3. Rich interactions: clicks, text entry, keyboard navigation, dropdown selection, checkboxes, file uploads, hover, scroll.
4. Managed downloads saved to profile-scoped storage.
5. Accessibility tree extraction (ARIA snapshots) and interactive element discovery.
6. **Hard security boundary**: All page content and extracted text passes through `PromptDefense` as untrusted data before entering agent context.
7. Honest capability registration in `CapabilityRegistry` (spec section 71).

## Decision

1. **Schema Migration 6 `v2_p4c_browser_profiles`** (`src/storage/migrations/index.ts`):
   - Table `browser_profiles`: `id`, `agent_id`, `task_id`, `name`, `user_data_dir`, `cookies_count`, `metadata`, `created_at`, `updated_at`.
   - Indexed on `agent_id`, `task_id`, and `name`.

2. **`BrowserProfileStore` interface & `SqliteBrowserProfileStore`** (`src/storage/stores/types.ts`, `sqlite/sqliteBrowserProfileStore.ts`):
   - Follows ADR-0001: store interface with SQLite implementation locally, prepared for PostgreSQL in P12.
   - Facade method `EpisodicMemory.getBrowserProfileStore()` delegates to the store bundle.

3. **`BrowserProfileManager`** (`src/browser/browserProfileManager.ts`):
   - Manages user data directories scoped under `scratch/browser_profiles/<profileId>`.
   - Resolves profiles deterministically (`agent_<agentId>`, `task_<taskId>`, or named). Two agents (e.g. `agent_alpha` and `agent_beta`) receive completely separate profile directories and storage boundaries.

4. **`BrowserEngine`** (`src/browser/browserEngine.ts`):
   - Manages Playwright persistent contexts (`launchPersistentContext`) keyed by profile ID.
   - Multi-tab management: unique tab IDs, `newTab`, `switchTab`, `closeTab`, `listTabs`.
   - Action support: click, double-click, right-click, hover, type, pressKey, selectOption, check, uncheck, scroll, uploadFile (`setInputFiles`).
   - Downloads management: catches download events, saves to `scratch/downloads/<profileId>/`, returns file metadata.
   - Accessibility & semantic extraction: extracts modern ARIA snapshot / accessibility tree alongside interactive element discovery with `data-athena-id`.
   - **PromptDefense Untrusted Boundary**: Every extraction and page summary runs through `PromptDefense.analyzeAndSanitize()`, neutralizing injection patterns (`INSTRUCTION_OVERRIDE`, `PROMPT_LEAK_REQUEST`, etc.) and wrapping the payload in `<untrusted_content origin="...">` with origin URL metadata.

5. **Capability Registry (`seedP4CCapabilities`)** (`src/tools/capabilityRegistry.ts`):
   - Registers 6 capabilities: `browser.playwright` (`real` if Chromium binary exists, `unsupported` if missing), `browser.profiles` (`real`), `browser.tabs` (`real`), `browser.interactive` (`real`), `browser.accessibility` (`real`), `browser.downloads` (`real`).

6. **Tool Suite & Backward Compatibility** (`src/tools/browserTools.ts`, `src/tools/interactiveBrowser.ts`):
   - Modernized tool set: `browserNavigate`, `browserAction`, `browserTabManage`, `browserSessionManage`, `browserExtract`, `browserScreenshot`.
   - Full manifests with permissions `browser`, `net:http`, timeout policies, and `confirm` risk level for destructive/form interactions.
   - Backward-compatible re-exports preserve compatibility with existing callers and tests.

## Consequences

- **Strict isolation**: Two agents or tasks never share cookies or local storage unless explicitly configured with the same profile name (verified in TEST 2).
- **Prompt defense guarantee**: Prompt injection payloads embedded in web pages cannot escape the untrusted boundary (verified in TEST 7).
- **Deterministic and offline-capable**: Full automated test suite runs against local HTTP server fixtures with zero flakiness.
- **Zero regressions**: All existing test suites (V2 P1, P2, P3, P4A, P4B, V1 baseline) remain green.
