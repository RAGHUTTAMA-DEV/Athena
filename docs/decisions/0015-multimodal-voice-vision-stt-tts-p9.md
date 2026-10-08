# ADR-0015: Multimodal & Voice Subsystem — Vision, STT, TTS, Multimodal Artifacts, Voice-to-Goal Routing, and Closed-Loop Browser Verification (P9)

- Status: Accepted
- Date: 2026-10-09
- Phase: V2 P9 (Multimodal and Voice — spec sections 46, 47)

## Context

In Athena V1, interactions were strictly text-based. In Athena V2, multimodal and voice intelligence are required as native capabilities of the single persistent core (spec sections 46 & 47):
1. **Vision Intelligence (Spec Section 46)**:
   - Visual inspection of screenshots, documents, and application windows.
   - Text extraction (OCR) and UI element bounding box / landmark detection.
   - Grounding visual feedback to guide autonomous agent actions.
2. **Audio & Voice Processing (Spec Section 47)**:
   - Speech-to-Text (STT): High-fidelity transcription of spoken speech with confidence metrics and language identification.
   - Text-to-Speech (TTS): Speech synthesis returning valid PCM WAV audio buffers.
   - Audio and visual media persistence: Recording all multimodal inputs and outputs in a durable store.
3. **Voice Request to Core Goal Path (P9 Exit Criterion 1)**:
   - Voice audio must not run a disconnected toy loop; it must transcribe via STT, route through Athena core, and create a persistent goal with planned tasks in SQLite (`goals` and `tasks` tables).
4. **Screenshot → Browser → Verify E2E (P9 Exit Criterion 2)**:
   - Athena must inspect a visual state via screenshot, navigate or interact via the browser engine, capture a new verification screenshot, and confirm that the intended action succeeded.
5. **Capability Honesty**:
   - Reflect real multimodal capabilities (`multimodal.vision`, `multimodal.stt`, `multimodal.tts`, `multimodal.image_generation`, `multimodal.voice_goal_routing`, `multimodal.screenshot_browser_loop`), experimental capabilities (`multimodal.realtime_voice_duplex`), and unsupported hardware dependencies (`multimodal.video_streaming`).

## Decision

1. **Schema Migration 11 (`v2_p9_multimodal_voice`)**:
   - `multimodal_artifacts`:
     - `id`: TEXT PRIMARY KEY
     - `media_type`: TEXT ('image', 'audio', 'pdf', 'video')
     - `mime_type`: TEXT NOT NULL
     - `file_path`: TEXT NOT NULL
     - `source`: TEXT (e.g., 'voice_input', 'screenshot', 'stt_transcription', 'tts_synthesis')
     - `transcription`: TEXT
     - `caption`: TEXT
     - `metadata`: TEXT (JSON)
     - `created_at`: INTEGER NOT NULL
   - Indexes: `idx_multimodal_media_type`, `idx_multimodal_source`, `idx_multimodal_created_at`.

2. **Storage Layer**:
   - Store interface in `src/storage/stores/types.ts`: `MultimodalStore`, `MultimodalArtifact`, `MediaType`.
   - SQLite implementation in `src/storage/stores/sqlite/sqliteMultimodalStore.ts`: `SqliteMultimodalStore`.
   - Wired into `SqliteStores` and `EpisodicMemory` facade getters (`getMultimodalStore()`, `getMultimodalEngine()`).

3. **Multimodal Providers (`src/multimodal/providers/`)**:
   - Vision: `GeminiVisionProvider` (cloud multimodal with Gemini API) with automatic fallback to `MockVisionProvider` (offline/test UI element detection).
   - STT: `GeminiSTTProvider` (cloud audio transcription) with automatic fallback to `MockSTTProvider`.
   - TTS: `SynthesizedTTSProvider` (generates valid 16-bit 16kHz PCM WAV with standard 44-byte RIFF header) and `CloudTTSProvider`.
   - Image Generation: `MockImageGenProvider` (generates valid 1x1 base64 RGBA PNG buffer) and `CloudImageGenProvider`.

4. **MultiModalEngine Facade (`src/multimodal/multimodalEngine.ts`)**:
   - High-level coordinator orchestrating vision, STT, TTS, image generation, and SQLite artifact persistence.
   - `processVoiceRequest(audioInput, agent, options)`:
     - Transcribes audio input via STT.
     - Persists inbound audio artifact in `MultimodalStore`.
     - Extracts title and description and creates persistent `Goal` via `agent.createGoal()`.
     - Decomposes goal into structured `Task` entries via `agent.planGoal()`.
     - Synthesizes spoken audio confirmation response via TTS and stores outbound artifact.
   - `handleScreenshotToBrowserAction(screenshot, actionIntent, browserEngine)`:
     - Vision analysis on initial screenshot.
     - Navigates / executes browser actions via `BrowserEngine`.
     - Takes new verification screenshot.
     - Performs verification vision analysis and validates success outcome.

5. **Multimodal Tools (`src/tools/multimodalTools.ts`)**:
   - `imageInspect`: Inspect images and screenshots, extracting OCR text and UI elements.
   - `imageGenerate`: Generate image assets and store artifacts.
   - `voiceTranscribe`: Transcribe speech audio to text with confidence.
   - `voiceSpeak`: Synthesize speech audio from text to WAV files.
   - `voiceGoalCreate`: Convert voice audio input to persistent Athena goal and planned tasks.
   - Registered in `src/tools/index.ts`, `DEFAULT_TOOL_MANIFESTS` in `toolRuntime.ts`, capability keywords in `toolDiscovery.ts`, and `TOOL_ALIASES` in `agent.ts`.

6. **Capability Registry (`src/tools/capabilityRegistry.ts`)**:
   - Seeded 8 P9 capabilities:
     - `multimodal.vision`: `real`
     - `multimodal.stt`: `real`
     - `multimodal.tts`: `real`
     - `multimodal.image_generation`: `real`
     - `multimodal.voice_goal_routing`: `real`
     - `multimodal.screenshot_browser_loop`: `real`
     - `multimodal.realtime_voice_duplex`: `experimental` (requires bidirectional low-latency audio stream setup)
     - `multimodal.video_streaming`: `unsupported` (requires continuous camera pipeline and hardware)

## Consequences

- Voice and multimodal operations are now native first-class citizens of Athena's persistent architecture.
- Voice requests immediately reflect in SQLite `goals` and `tasks` tables, enabling the autonomous agent to execute them like any other goal.
- Screenshot-to-browser loops provide end-to-end visual verification without relying on external UI frameworks.
- 100% test pass rate maintained with comprehensive automated coverage in `npm run test:v2p9` and zero regressions across earlier phases.
