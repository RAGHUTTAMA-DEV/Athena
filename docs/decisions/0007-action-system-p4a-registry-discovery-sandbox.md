# ADR-0007: Action System P4A — Registry, Discovery, Execution Backend, Filesystem, and Terminal

- Status: Accepted
- Date: 2026-10-08
- Phase: V2 P4A (Action System: Registry, Discovery, Execution Backend, Filesystem, Terminal)

## Context

In Athena V1, tools were registered in a static in-memory Map (`toolsRegistry`) and filtered via hardcoded keyword dictionaries (`ToolSelector`). Filesystem operations and shell execution ran directly on the host operating system without an execution backend abstraction or sandboxing layer. This presented three core limitations:
1. **Schema context explosion**: As the number of tools grew to 100+ (via MCP integrations, custom plugins, and subagent tools), putting all tool schemas directly into prompt context exceeded token limits and degraded LLM reasoning.
2. **Lack of execution isolation / sandboxing**: Background tasks or untrusted operations could potentially execute destructive commands, escape directories via relative paths (`..`) or symlinks, or leak host environment secrets (`.env`, `id_rsa`, cloud API keys).
3. **Restricted background autonomy**: Phase 2 enforced `BACKGROUND_SAFE_TOOL_RESTRICTION` denying all write/exec tools during background execution because no safe sandbox backend existed to isolate them.

## Decision

1. **Full `ToolDefinition` & Manifest Schema (`src/tools/toolTypes.ts`)**:
   - Upgraded `ToolDefinition` to standardize: `name`, `description`, `capabilities`, `inputSchema`, `outputSchema`, `permissions`, `risk`, `timeout`, `sideEffects`, `idempotent`, `parallelSafe`, and `tags`.
   - Maintained backward-compatibility aliases (`parameters` $\leftrightarrow$ `inputSchema`) for seamless Gemini and OpenAI function declaration integration.

2. **Searchable Tool Registry & 5-Stage Discovery Pipeline (`SearchableToolRegistry` / `ToolDiscoveryPipeline`)**:
   - `SearchableToolRegistry`: Maintains an inverted index over tool names, tokens, capabilities, and tags.
   - `ToolDiscoveryPipeline`: Executes a 5-stage pipeline:
     1. `Capability Detection`: Detects required capabilities (`fs:read`, `fs:write`, `cmd:exec`, `net:http`, `browser`, `system`, `memory`) from user intent and working context.
     2. `Search & Discovery`: Indexes query tokens against the inverted index with capability and tag scoring.
     3. `Ranking`: Applies relative score cutoffs and prunes destructive tools unless explicitly relevant.
     4. `Permission & Security Check`: Enforces `PolicyEngine` rules and sandbox restrictions.
     5. `Prompt Budgeting`: Bounds selected tool definitions to $\le 2000$ prompt tokens, ensuring that even with 100+ registered tools, prompt sizes remain strictly bounded.

3. **`ExecutionBackend` Abstraction & Sandboxing (`ExecutionBackend` / `SandboxedExecutionBackend`)**:
   - `LocalExecutionBackend`: Native host execution with process tree tracking, timeouts, and signal dispatch.
   - `SandboxedExecutionBackend`:
     - Virtual workspace mount strictly confining operations to `sandboxRoot`.
     - Jail boundary validation: path traversal (`..`) and symlink escapes (canonical target resolution outside the workspace) are rejected.
     - Environment variable sanitization: strips sensitive credentials and host keys (`AWS_*`, `GITHUB_*`, `GEMINI_*`, `OPENAI_*`, `TOKEN`, `KEY`, `SECRET`).
     - Resource limits: bounds execution timeouts and output buffers.
   - **Background Execution Integration**: Background runs (`isBackground: true`) may now use exec/write tools **only** inside the sandbox backend.

4. **Obfuscation Detection Engine (`ObfuscationDetector`)**:
   - Unmasks command injection evasion attempts:
     - Base64 shell pipes (`echo ... | base64 -d | sh`)
     - PowerShell `-EncodedCommand` (UTF-16LE decoding)
     - Windows `cmd.exe` caret insertions (`d^e^l`)
     - Hex and octal escape sequences (`\x72\x6d` $\rightarrow$ `rm`)
   - Decoded payloads are re-evaluated against `PolicyEngine` destructive patterns.

5. **Scoped Filesystem Engine (`FilesystemEngine`)**:
   - Standardized operations: `readFile`, `writeFile`, `editFile`, `searchFiles`, `moveFile`, `copyFile`, `deleteFile`, `watchPath`, `inspectPath`.
   - Symlink protection: resolves canonical paths to prevent reading or writing outside allowed roots via symlinks.

6. **Terminal Process Manager (`ProcessManager`)**:
   - Process lifecycle management for foreground and background processes.
   - Ring-buffered output streaming to prevent memory leaks during long-running tasks.
   - Signal handling (`SIGINT`, `SIGTERM`, `SIGKILL`) and clean agent shutdown.

## Consequences

- **Security**: Symlinks, directory traversals, obfuscated shell commands, and host credential reads are blocked deterministically.
- **Autonomy**: Background tasks can safely execute shell commands and modify files inside the sandbox without threatening host integrity.
- **Scalability**: The agent effortlessly handles 100+ registered tools with bounded prompt sizes and accurate intent discovery.
- **Zero Regressions**: Passes all Phase 4A tests (6/6), Phase 3 tests (9/9), Phase 2 tests (11/11), Phase 1 tests (9/9), and Reliability/Security tests (6/6).
