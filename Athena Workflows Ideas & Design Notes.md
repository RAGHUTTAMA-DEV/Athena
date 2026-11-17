# Athena Workflows: Ideas & Design Notes

Consolidated brainstorm for adding an n8n-style agentic workflow system to Athena (single-user, local-first). This is raw material for the real plan: edit freely, cut what you don't want, and send it back for review.

## 1. The Idea in One Paragraph

Athena already has a strong core agent loop (Phases 1-8). The new feature lets a user create **saved, editable workflows** (for example a "research agent"), configure them through settings and a visual canvas, connect services like Gmail with a simple sign-in button, and run them from chat, from the UI, or on triggers (cron/webhook). A workflow is a DAG where the existing agent loop is one node type among several.

## 2. Positioning

**Not** "an n8n clone." n8n is deterministic automation with an AI node bolted on, backed by 7+ years of work and 400+ integrations. Athena should be the reverse: **agent-native, with deterministic workflow structure as the safety rail.**

Pitch: *"An agentic workflow runtime with checkpointed resume, policy gates, replay debugging, and CI-regressed trajectory evals."*

### Where n8n is far ahead (don't chase)

| n8n strength | Our answer |
| --- | --- |
| 400+ hand-built integrations | MCP servers give hundreds of tool sets for free |
| OAuth/credential management at scale | Small encrypted vault, Gmail + GitHub first |
| Expression language and data-mapping UI | Keep simple `{{ }}` templates, let the LLM do mapping |
| Queues, workers, multi-user infra | Already have WorkerPool, job leases, checkpoints; single-user anyway |
| Templates and community | Local `templates/` folder only |

### Where Athena can win

1. Chat-to-workflow: describe it in chat, get a draft, refine on the canvas.
2. Self-repair and verification gates (failed nodes get diagnosed and retried, not just flagged red).
3. Real machine access: terminal, filesystem, browser, Python sandbox.
4. Memory and learning: scoped memory plus procedural skills improve runs over time.
5. Trajectory evals and replay: workflows regression-tested in CI.
6. Governance: PolicyEngine, PromptDefense, cascading budgets.

## 3. What Already Exists (Reuse, Don't Rebuild)

| n8n concept | Athena component |
| --- | --- |
| Execution engine | `PlanDAG` / `PlanStep` (Phase 4) |
| Each node's run | Child run via `parentRunId` / `rootRunId` (Phase 1) |
| Triggers | `Scheduler` + `EventBus` (Phase 6) |
| Node permissions | Tool manifests + `PolicyEngine` (Phases 3, 7) |
| Execution history and debugging | `run_events` + `/replay` (Phase 8) |
| Human approval node | Existing HITL confirm flow |
| Budgets | `RunState` budget engine (Phase 1) |
| Node isolation / scoped agent | `delegate_task` scoping logic |
| Integrations | `MCPManager` + `CircuitBreakerRegistry` |
| Live run view | `AgentEvent` stream |

New work is only: a persisted workflow definition, a data-passing layer between nodes, the integrations/OAuth layer, and the UI plus chat entry points.

## 4. Architecture

```
        ┌──────────── Frontend (React Flow editor) ────────────┐
        │  drag nodes · edit prompts · pick tools · set inputs │
        └───────────────┬──────────────────────────────────────┘
                        │ saves JSON
                        ▼
              ┌──────────────────────┐
 chat ───────▶│  WorkflowRegistry    │◀──── LLM drafts workflow
 "run my      │  (SQLite, versioned) │      from natural language
 research     └─────────┬────────────┘
 workflow"              │
   cron / webhook ──▶ WorkflowExecutor ──▶ topo-sort, run ready nodes in parallel
                        │
     ┌──────────┬───────┼──────────┬───────────┐
     ▼          ▼       ▼          ▼           ▼
  trigger    agent    tool     condition   approval
  node       node     node     / map       (HITL)
             │
             └─ existing Agent loop (scoped tools, budget, memory scope)
                every node = child run → telemetry + replay for free
```

## 5. Node Types (Core Agentic & Deterministic Set)

| Node | Purpose |
| --- | --- |
| **trigger** | Entry point: manual, cron, webhook, or chat |
| **agent** | Autonomous single agent with its own prompt, tool allowlist, budget, and model |
| **orchestrator** | **(Master-Worker)** Lead coordinator agent that dynamically plans, creates contracts, delegates to specialized child agents, and supervises execution |
| **collector** | **(Aggregation Barrier)** Gathers outputs from parallel specialist agents using deterministic strategies (merge, voting consensus, or debate synthesis) |
| **tool** | Deterministic single tool call, no LLM (cheap and predictable) |
| **condition** | Branch on an expression or an LLM evaluation |
| **map** | Fan out over a list (e.g. 5 search queries in parallel, spawning worker agents) |
| **approval** | Pause the run until the human confirms (HITL) |
| **sub_workflow** | Invoke another saved workflow as a modular, nested agent component |

Key principle: not every step needs an LLM. The agent-vs-tool split keeps workflows reliable and cheap, while dedicated multi-agent orchestration primitives prevent chaotic agent sprawl.

---

## 5b. Deep-Dive: Multi-Agent Architecture & Management

Multi-agent execution in Athena Workflows operates under two distinct, first-class paradigms:

```
        ┌─────────────────────────────────────────────────────────────┐
        │                 TWO MULTI-AGENT PARADIGMS                    │
        ├──────────────────────────────┬──────────────────────────────┤
        │  TYPE 1: MASTER-WORKER       │  TYPE 2: CHOREOGRAPHED PEERS │
        │  (Hierarchical Orchestration)│  (Specialist Swarm / DAG)    │
        ├──────────────────────────────┼──────────────────────────────┤
        │ • 1 Master Orchestrator Agent│ • Multiple distinct agents   │
        │ • Dynamic runtime delegation │ • Deterministic DAG edges    │
        │ • Master decides subtasks    │ • Parallel or pipeline       │
        │ • Re-evaluates on failure    │ • Merged by Collector node   │
        └──────────────────────────────┴──────────────────────────────┘
```

### Type 1: Master-Worker (Dynamic Hierarchical Orchestration)
- **Role**: Used when the exact decomposition of a task cannot be fixed ahead of time.
- **Components**:
  - `OrchestratorNode`: Given a goal, system prompt, and a roster of available `SpecialistDef[]` (e.g., Researcher, Coder, Reviewer).
  - **Delegation Contract Engine**: Wires directly into Athena's `DelegationContractEngine` (`src/multiagent/delegationContract.ts`). Every dynamic dispatch produces a validated `DelegationContract` enforcing:
    1. Bounded lifetime (`maxTurns: 1-20`, `timeoutMs`).
    2. Strict tool isolation (e.g. Reviewers cannot have destructive write tools).
    3. Depth limits (`MAX_DELEGATION_DEPTH = 3`) and concurrency caps (`MAX_SUBAGENTS_PER_GOAL = 5`).
  - **Supervision & Re-delegation**: The Master inspects the return payload. If the worker's output is incomplete or hallucinatory, the Master invokes `clarify` or re-delegates to a different specialist.

### Type 2: Choreographed Specialist Team (Parallel Peers & Swarms)
- **Role**: Used when specialized roles and data flows are known (e.g., Code Review: Security + Logic + Style).
- **Parallel Fan-out**: Independent `AgentNode`s execute concurrently via `Promise.all` in the topo-sort executor.
- **The Collection & Aggregation Problem ("How are we collecting and managing them?")**:
  Parallel agents produce heterogeneous outputs. Athena solves this with a dedicated **`CollectorNode`**:
  1. **`structured_merge`**: Merges outputs into a unified typed dictionary without LLM cost:
     `{ security: nodes.sec.output, logic: nodes.logic.output, style: nodes.style.output }`
  2. **`consensus_voting`**: Evaluates verdicts (e.g. PR approval: `unanimous`, `majority`, or `weighted_threshold`).
  3. **`debate_refine`**: Two peer agents critique each other iteratively (e.g. Proposer vs Critic) for up to $N$ rounds before passing to the next step.
  4. **`synthesis_agent`**: A dedicated LLM synthesizer receives all collected peer findings with prompt injection defense (`PromptDefense`) and writes a cohesive briefing.

### Agent Addressing, Mailbox & Blackboard Management
1. **Agent Addressing**:
   Each agent instance is assigned an addressable ID: `${workflowRunId}:${nodeId}:${instanceIndex}` registered in `TeamManager`.
2. **Inter-Agent Mailbox (A2A Messaging)**:
   Long-running or peer agents communicate via `AgentMailbox` (`src/multiagent/agentMailbox.ts`), allowing async message exchange (`request`, `response`, `question`, `handoff`, `blocked`).
3. **Shared Blackboard (`WorkflowBlackboard`)**:
   Instead of passing massive 50KB git diffs or database dumps through LLM prompts (causing token bloat and truncation), artifacts are stored in an execution-scoped SQLite blackboard. Downstream agents pass references:
   `{{ blackboard.git_diff }}`.
4. **Failure & Quorum Policies**:
   - `quorum`: Step succeeds if $M$-of-$N$ specialists finish (e.g. 3 of 4 reviewers succeed; slow laggards are pruned).
   - `fail_fast`: Any specialist failure aborts the fan-out.


## 6. Workflow Definition (JSON)

Example: the research agent.

```json
{
  "id": "research-agent",
  "version": 3,
  "inputs": { "topic": { "type": "string", "required": true } },
  "settings": { "maxCostUsd": 0.5, "maxTimeMs": 300000, "model": "gemini-2.5-flash", "memoryScope": "project" },
  "nodes": [
    { "id": "plan", "type": "agent",
      "prompt": "Break '{{inputs.topic}}' into 4 search queries. Return JSON array.",
      "tools": [], "output": "json" },
    { "id": "search", "type": "map", "over": "{{nodes.plan.output}}",
      "node": { "type": "agent", "prompt": "Research: {{item}}",
                "tools": ["searchWeb", "browser"], "budget": { "maxTurns": 6 } } },
    { "id": "write", "type": "agent",
      "prompt": "Write a cited report from: {{nodes.search.output}}", "tools": ["writeFile"] },
    { "id": "review", "type": "approval", "message": "Report ready, send it?" }
  ],
  "edges": [["plan","search"],["search","write"],["write","review"]]
}
```

Settings the user controls: input schema, model, budgets (cost, time, turns), tool allowlist per node, memory scope.

## 7. Types and Executor Sketch

```ts
// src/workflows/types.ts
export type WfNode =
  | { id: string; type: 'agent'; prompt: string; tools: string[]; budget?: Partial<Budget>; output?: 'text' | 'json'; outputSchema?: any }
  | { id: string; type: 'orchestrator'; systemPrompt: string; specialists: SpecialistDef[]; tools: string[]; budget?: Partial<Budget> }
  | { id: string; type: 'collector'; strategy: 'structured_merge' | 'consensus_voting' | 'debate_refine' | 'synthesis_agent'; sources: string[]; config?: any }
  | { id: string; type: 'tool'; tool: string; args: Record<string, any> }
  | { id: string; type: 'condition'; expr: string; trueBranch: string; falseBranch: string }
  | { id: string; type: 'map'; over: string; node: Omit<WfNode, 'id'>; maxConcurrency?: number }
  | { id: string; type: 'approval'; message: string; timeoutMs?: number }
  | { id: string; type: 'sub_workflow'; workflowId: string; version?: number; inputs: Record<string, any> };

export interface Workflow {
  id: string; version: number;
  name: string;
  agentProfile?: { systemPrompt: string; name: string; description: string; publishAsAgent: boolean; toolName?: string };
  inputs: Record<string, any>;
  settings: Partial<Budget> & { model?: string; memoryScope?: string };
  nodes: WfNode[]; edges: [string, string][];
}
```

```ts
// src/workflows/executor.ts (multi-agent & aggregation sketch)
export class WorkflowExecutor {
  constructor(
    private agentFactory: AgentFactory,
    private tools: ToolRuntime,
    private db: Db,
    private mailbox: AgentMailbox,
    private blackboard: WorkflowBlackboard
  ) {}

  async run(wf: Workflow, inputs: any, parentRunId: string, token: CancellationToken) {
    const ctx = { inputs, nodes: {} as Record<string, { output: any }>, blackboard: this.blackboard };
    const done = new Set<string>();
    const deps = buildDeps(wf.edges);

    while (done.size < wf.nodes.length) {
      token.throwIfCancelled();
      const ready = wf.nodes.filter(n => !done.has(n.id) && (deps[n.id] ?? []).every(d => done.has(d)));
      if (!ready.length) throw new Error('Cycle or unreachable node');

      await Promise.all(ready.map(async n => {
        const run = this.db.createChildRun(parentRunId, n.id);
        ctx.nodes[n.id] = { output: await this.execNode(n, ctx, run, token) };
        this.db.saveNodeOutput(parentRunId, n.id, ctx.nodes[n.id]);
        done.add(n.id);
      }));
    }
    return ctx;
  }

  private async execNode(n: WfNode, ctx: Ctx, run: Run, token: CancellationToken) {
    switch (n.type) {
      case 'agent': {
        const agent = this.agentFactory.create({ tools: n.tools, budget: n.budget, parentRunId: run.id });
        const res = await agent.run(render(n.prompt, ctx), token);
        return n.output === 'json' ? JSON.parse(res.text) : res.text;
      }
      case 'orchestrator': {
        // Master Agent dynamically delegates to specialists using DelegationContractEngine
        return this.execOrchestrator(n, ctx, run, token);
      }
      case 'collector': {
        // Aggregates peer outputs using structured merge, consensus voting, or synthesis
        return this.execCollector(n, ctx, run, token);
      }
      case 'tool':
        return (await this.tools.call(n.tool, deepRender(n.args, ctx))).data;
      case 'map': {
        const items = evalPath(n.over, ctx);
        return Promise.all(items.map(item => this.execNode({ ...n.node, id: n.id } as WfNode, { ...ctx, item }, run, token)));
      }
      case 'approval':
        return this.requestApproval(run, render(n.message, ctx));
      case 'sub_workflow':
        return this.run(await this.db.getWorkflow(n.workflowId, n.version), deepRender(n.inputs, ctx), run.id, token);
    }
  }
}
```

## 8. SQLite Tables

```sql
workflows(id, version, name, definition_json, created_at)          -- immutable per version
workflow_runs(run_id, workflow_id, version, inputs_json, status)
workflow_node_outputs(run_id, node_id, output_json, status)        -- enables resume from checkpoint
workflow_blackboard(run_id, key, value_json, updated_at)           -- shared inter-agent context store
credentials(service_id, encrypted_tokens, expires_at, scopes)      -- integrations vault
```

## 9. Chat Integration

Two new tools in the registry:

1. **`runWorkflow({ id, inputs })`**: run a saved workflow from chat ("run my research workflow on RAG evals"). Use `confirm` risk if the workflow contains write or exec nodes.
2. **`createWorkflow({ description })`**: the LLM drafts workflow JSON from natural language, it is validated, then opened in the frontend editor for review. **Chat to draft, canvas to refine** is the signature flow.

CLI and Telegram commands: `/workflows`, `/workflow run <id>`, `/workflow edit <id>`.

## 10. Integrations and "Connect Gmail" (Simple for the User)

**Goal:** the user never edits JSON. They click **Connect**, sign in with Google, and that service's tools appear in the node editor.

```
[Integrations page]
  Gmail      [Connect]
  GitHub     [Connect]
  Notion     [Connected ✓]  [Disconnect]
```

### Flow

```
Click "Connect Gmail"
   │
   ▼
Backend builds Google auth URL (PKCE + state) ──▶ opens browser
   │                                              user clicks "Allow"
   ▼                                                    │
http://localhost:PORT/oauth/callback?code=... ◀─────────┘
   │
   ▼
Exchange code for access + refresh token
   │
   ▼
Encrypt + store in SQLite (credentials table)
   │
   ▼
Start the Gmail MCP server with that token injected
   │
   ▼
Its tools appear in the node editor's tool picker
```

Because Athena is local, the redirect goes to localhost; no public server needed.

### An integration is one registry entry

```ts
// src/integrations/registry.ts
export const integrations = {
  gmail: {
    name: 'Gmail',
    auth: {
      type: 'oauth2',
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/gmail.modify'],
      clientId: process.env.GOOGLE_CLIENT_ID,
    },
    mcp: { command: 'npx', args: ['-y', '<gmail-mcp-server>'], envFromToken: 'GMAIL_ACCESS_TOKEN' },
  },
  github: { name: 'GitHub', auth: { type: 'oauth2' /* ... */ }, mcp: { /* ... */ } },
  brave:  { name: 'Brave Search', auth: { type: 'apiKey', field: 'BRAVE_API_KEY' }, mcp: { /* ... */ } },
};
```

### Generic OAuth handlers

```ts
app.get('/oauth/start/:id', (req, res) => {
  const cfg = integrations[req.params.id].auth;
  const { verifier, challenge } = makePkce();
  const state = crypto.randomUUID();
  pending.set(state, { id: req.params.id, verifier });
  res.redirect(`${cfg.authUrl}?` + new URLSearchParams({
    client_id: cfg.clientId, redirect_uri: REDIRECT, response_type: 'code',
    scope: cfg.scopes.join(' '), state, code_challenge: challenge,
    code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent',
  }));
});

app.get('/oauth/callback', async (req, res) => {
  const p = pending.get(req.query.state as string);
  if (!p) return res.status(400).send('bad state');
  const tokens = await exchangeCode(p, req.query.code as string);
  await credentialVault.save(p.id, tokens);   // AES-GCM encrypted
  await mcpManager.startServer(p.id);         // tools show up in the picker
  res.send('Connected! You can close this tab.');
});
```

### Things to get right

- **Token refresh:** refresh before expiry, centralized in `CredentialManager`. A workflow dying at 2am from an expired token is the classic failure.
- **Encryption:** AES-GCM at rest, key from env or OS keychain. The recursive redactor must also scrub tokens from traces and replays.
- **Google specifics:** create your own Google Cloud OAuth client. Gmail scopes are sensitive/restricted, so a public app needs Google verification; personal use can stay in testing mode with yourself as test user. In testing mode refresh tokens can expire after about 7 days, so verify against Google's current docs and plan for re-auth prompts.
- **Don't hand-build every provider.** Consider a managed OAuth layer (Composio, Nango, Pipedream Connect) for breadth. Hand-build Gmail and GitHub for the demo and keep the registry interface swappable.
- **Remote MCP servers** (e.g. Notion's) often run their own OAuth, so the Connect button just launches that flow.

## 11. Decisions Already Made

- **Single-user only.** No accounts, teams, roles, or shared credentials. Big simplification: one vault, one workspace, local callbacks.
- **Marketplace:** skip a public one. Cheap substitute: a local `templates/` folder with 5-6 starter workflows (research agent, daily email digest, GitHub PR reviewer...) and a "Use template" button.
- **Custom code nodes:** skip for MVP. See below.

### About custom code nodes

A node where the user writes a JS or Python snippet that runs as a step, used for glue logic like filtering, reshaping JSON, or math.

```json
{ "id": "clean", "type": "code", "language": "python",
  "code": "emails = input['search']\nreturn [e for e in emails if 'invoice' in e['subject'].lower()]" }
```

Why skip for now: agent nodes already cover this (a prompt, or a `tool` node calling `executePython`), and arbitrary user code is a security surface (`node:vm` is not a real sandbox). If added later: a thin wrapper over `executePython` with input/output as JSON, subprocess with timeouts and no network, `PolicyEngine` checks, `confirm` risk level (about 40 lines).

## 12. Pitfalls and Risks

- **Output contracts:** agent nodes feeding other nodes should declare `output: json` plus a schema; the executor validates and retries or self-repairs. Otherwise one flaky node breaks the chain.
- **Policy per node:** each node's tool allowlist must pass through `PolicyEngine`; a workflow must never grant more than the user has. Treat `{{node.output}}` flowing into the next prompt as untrusted content (`PromptDefense`), since it may contain scraped web text.
- **Budget cascade:** workflow budget is the parent, node budgets are children, so a `map` over 20 items can't blow the cost cap.
- **Versioning:** runs pin to a workflow version; editing mid-run must not affect it.
- **Resume:** per-node checkpoints let `/resume <runId>` skip completed nodes. A real advantage over n8n for long agent runs.
- **Scope creep:** breadth of integrations is a trap; depth (reliability, replay, evals) is the differentiator.

## 13. Suggested Build Order

1. Types, DB tables, executor with `agent`, `tool`, and sequential edges. Test the research workflow from the CLI.
2. Add `map`, `condition`, `approval`.
3. `runWorkflow` and `createWorkflow` chat tools plus `/workflow` commands.
4. Triggers: hook cron and webhook into the existing Scheduler and EventBus.
5. Integration registry, generic OAuth flow, credential vault with refresh (Gmail and GitHub only).
6. Frontend: workflow list, then React Flow canvas with node config sidebar, then live run view from `AgentEvent`, then Integrations page and MCP tool picker.
7. Per-node retry/timeout/on-error settings; sub-workflows.
8. Templates folder.
9. Evals: workflow cases in `eval:benchmark` so the CI gate covers them.

## 14. MVP Slice (Demo-able in 1-2 Weeks)

**Chat → drafts research workflow → canvas → run with live node status → replay.**

Minimum: executor (`agent`, `tool`, `map`, `approval`), `createWorkflow`/`runWorkflow` tools, simple React Flow view, run history with per-node I/O.

## 15. Open Questions for You to Decide

- Which integrations are in the first cut (Gmail, GitHub, Notion, Slack)?
- Hand-built OAuth vs a managed layer (Composio / Nango / Pipedream Connect)?
- Where do workflows live: SQLite only, or also exported as files in the repo?
- Should the editor support raw JSON editing as an advanced mode?
- How strict should output schema validation be (hard fail vs auto-repair)?
- Do workflows get their own memory scope, or share the project scope?
- Which triggers matter first: cron, webhook, email-received, chat?
- Frontend stack for the canvas: React Flow vs alternatives, and how does it talk to the Athena backend (HTTP, WebSocket, SSE)?
- How to position this in the README and on the resume?

## 16. Notes for the Reviewer

When you send your finished plan back, it helps to flag: what's firm vs. tentative, deadlines or constraints, and what you'd like challenged (scope, security, architecture, or sequencing).
