# Wiring the Coding Harness into Athena as a Coding Sub-Agent

Same pattern OpenClaw uses with pi-agent: the coding harness runs as its own
independent, headless CLI process. Athena shells out to it, waits for a
structured JSON result, and treats it like any other tool call. No shared
code, no in-process import — full isolation between the two projects.

---

## Architecture — what we're actually building

```
User: "add input validation to signup.ts"
        |
        v
  Athena (parent agent)
    - LLM decides: this is a coding task
    - calls delegateCodingTask({ task, cwd })
        |
        v
  execa spawns subprocess:
    harness --task "add input validation to signup.ts" --cwd /path/to/repo
        |
        v
  Coding Harness (headless mode)
    - runs its OWN agent loop internally
    - has its own tools: filesystem, terminal, edit, etc.
    - no interactive prompts, no manual permission confirms
    - auto-confirms or fails safe on destructive actions
    - runs to completion or hits internal timeout/max-iterations cap
        |
        v
  Prints ONE JSON blob to stdout:
    { status, output, filesChanged, error? }
        |
        v
  Athena parses stdout -> returns as the tool_result
    - parent LLM continues its own loop with that result
    - parent never sees the harness's internal reasoning/tool calls,
      only the final structured result
```

**Why subprocess instead of importing the `Agent` class directly:**
- Version-independent — each project can evolve/deploy separately
- Crash isolation — a broken coding run can't take down Athena's main loop
- Matches the sub-agent contract already designed for Athena (scoped task in,
  structured result out) — just implemented across a process boundary
  instead of in-memory
- Tool scoping is automatic — Athena can't reach into the harness's internal
  tools, and the harness can't call back into Athena

**Safety boundary:** `delegateCodingTask` keeps `requiresConfirmation: true`
on the Athena side — it can write and execute code, so it should never fire
without going through the existing permission-confirmation flow.

---

## Project 1 — Coding Harness (the sub-agent itself)

### 1. Add a headless / non-interactive mode
Currently interactive (REPL-style, live permission prompts). Add a flag that
runs one task to completion with no interactive prompts:
```ts
new Agent({ cwd, headless: true, autoConfirm: true })
```

### 2. Add a CLI entry point that takes flags, not stdin
```
harness --task "..." --cwd /path/to/repo --trace-id abc123
```
Parse:
- `--task` (required) — the task description
- `--cwd` (required) — absolute path to the target repo
- `--trace-id` (optional, for later) — for nested observability
- `--max-iterations` (optional) — safety cap since nothing's watching interactively

### 3. Print exactly one structured JSON result on stdout
```ts
{
  status: "success" | "failed",
  output: string,
  filesChanged: string[],
  error?: string
}
```
Redirect all internal logging to stderr or a log file — any stray output on
stdout breaks the parent's `JSON.parse`.

### 4. Publish it as an installable CLI binary
```json
{
  "name": "@you/coding-harness",
  "bin": { "harness": "./dist/cli/headless.js" }
}
```
```bash
npm link   # or: npm install -g . while developing locally
```
Now `harness --task "..."` is callable from anywhere — this is what Athena
shells out to.

### 5. Enforce a timeout / max-iterations cap internally
Don't rely only on the caller's timeout — add a hard cap inside the agent
loop itself, so a runaway loop doesn't hang forever if the parent's `execa`
timeout is ever misconfigured.

### 6. (Later — after core wiring works) Accept `--trace-id`
Once Langfuse/observability gets wired up, this lets the harness create
child spans/observations nested under the parent Athena trace instead of
running as an untracked black box.

**Test standalone before wiring anything else up:**
```bash
harness --task "add a test file" --cwd ./some-repo
```
Confirm the JSON output is clean and nothing else leaked onto stdout.

---

## Project 2 — Athena (the parent agent)

### 1. Add `execa` as a dependency
(Likely already present if the terminal tool is built.)

### 2. Write the `delegateCodingTask` tool
```ts
import { execa } from 'execa';
import { Tool } from '../core/types.js';

export const delegateCodingTaskTool: Tool = {
  definition: {
    name: 'delegateCodingTask',
    description: 'Delegate coding tasks (write/fix/refactor code, run tests) to the dedicated coding sub-agent. Use this instead of terminal/filesystem tools for any non-trivial code change.',
    parameters: {
      type: 'OBJECT',
      properties: {
        task: { type: 'STRING', description: 'Clear description of the coding task to perform.' },
        cwd: { type: 'STRING', description: 'Absolute path to the repo/project directory to work in.' }
      },
      required: ['task', 'cwd']
    }
  },
  requiresConfirmation: true,
  execute: async (args: { task: string; cwd: string }) => {
    try {
      const { stdout } = await execa('harness', ['--task', args.task, '--cwd', args.cwd], {
        timeout: 5 * 60 * 1000 // 5 min cap, tune as needed
      });
      return JSON.parse(stdout);
    } catch (err: any) {
      return { status: 'failed', error: err.message };
    }
  }
};
```

### 3. Register it in the tool list
```ts
export const tools: Tool[] = [
  webSearchTool,
  browserNavigateTool,
  browserObserveTool,
  browserClickTool,
  browserTypeTool,
  delegateCodingTaskTool,
  // ...
];
```

### 4. Update the system prompt
```
For any task involving writing, editing, or debugging code, use
delegateCodingTask instead of terminal/filesystem tools directly.
Give it a clear, self-contained task description and the absolute
path to the target repo.
```
Without this, the parent model may try to hand-roll file edits with its own
generic filesystem tool instead of delegating.

### 5. Keep `requiresConfirmation: true`
It can write and execute code — should never fire unattended, always route
through the existing permission-confirmation flow.

### 6. Handle the failure path explicitly
`execa` throws on non-zero exit or timeout — wrap it (as above) so a
hung/crashed harness returns `{ status: "failed", error }` cleanly instead
of crashing Athena's whole loop.

---

## What NOT to do

- Don't `import` the harness's `Agent` class directly into Athena — breaks
  version independence and crash isolation
- Don't let the coding sub-agent call `delegateTask`/spawn its own
  sub-agents — it's a separate fixed-tool-set process, no recursion needed
  and no cross-wiring back into Athena

---

## Build order

1. Headless mode in the harness (Project 1, steps 1–3) — test standalone
   from the terminal first
2. `npm link` it so it's callable as `harness` globally
3. Build the `delegateCodingTask` tool in Athena (Project 2)
4. Wire it into the tool list + system prompt
5. Test end-to-end: give Athena a prompt that should trigger delegation,
   confirm the subprocess spawns and the JSON result comes back correctly
6. (Later) Add `--trace-id` passthrough once observability (Langfuse) is
   wired up, so coding sub-agent runs show up nested under the parent trace
