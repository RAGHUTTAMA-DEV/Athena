# ADR-0004: Permission model as the primary layer over V1's hardcoded rules

- Status: Accepted
- Date: 2026-10-07
- Phase: V2 P1 (Agent Foundation)

## Context

V1's `PolicyEngine` is a hardcoded switch of regex rules (sensitive paths,
destructive commands, workspace boundary). The V2 spec requires a *data-driven*
permission model: agent permissions, user permissions, and tool permissions that
feed PolicyEngine — while V1's proven guardrails must keep working unchanged and
the full V1 security suite must not regress.

## Decision

1. **Composition**: `composePermissionModels(agent, user)` flattens the two models
   into one ordered rule list. Ordering guarantees safety:
   user denies → agent denies → user confirmations → agent confirmations →
   user allows → agent allows. First match wins, so **a user deny always
   outranks an agent allow**. `fileWriteRoots` are unioned; `maxRiskLevel` takes
   the stricter of the two.
2. **Layering**: `PolicyEngine.evaluateToolCall(toolName, args, toolPermissions?)`
   evaluates the composed model **first**:
   - `deny` → blocked immediately (`PERMISSION_MODEL_DENIED`);
   - `require_confirmation` → allowed but flagged (`PERMISSION_MODEL_CONFIRMATION`)
     for the executor;
   - `allow` → falls **through** to the V1 hardcoded rules (an allow can never
     bypass a V1 destructive-command or sensitive-path block).
   Rule patterns match a tool name (`executeCommand`), a manifest permission
   category (`fs:write`, `cmd:exec`, `browser`, ...), or `*`, evaluated in
   composed order — not by match-type priority.
3. **Empty model = V1 behavior**: an `Agent.init()` that composes empty models
   installs `null`, so PolicyEngine behaves exactly as in V1 (default-allow +
   hardcoded rules) when no permissions are configured.
4. **Confirmation is enforced once**: `ToolExecutor` is the single enforcement
   point for `require_confirmation` (it calls `context.confirm` and returns
   `POLICY_CONFIRMATION_DENIED` on refusal). The agent's run loop passes a
   serialized, memoized confirm callback (keyed by tool+args) so a tool that
   matches both a risk-level gate and a permission-model rule prompts the user
   only once per run.
5. **Filesystem**: `fileWriteRoots` from the permission model grant explicit
   write access outside the active workspace root (`PERMISSION_MODEL_WRITE_ROOT`);
   read access and the workspace-boundary deny are otherwise unchanged.

## Consequences

- Identity/workspace/profile permissions become enforceable without touching V1
  rule code; later phases (HITL approvals in P11) extend the same path.
- `evaluateToolCall` gained an optional third parameter — backward compatible for
  all existing call sites.
- Rule ordering is now semantically load-bearing: anything that reorders the
  composed list can flip deny/allow outcomes. Covered by tests (user deny beats
  agent allow; allow does not bypass `DESTRUCTIVE_COMMAND_BLOCKED`).
- The confirmation memoization lives in the run loop; direct
  `ToolExecutor.execute()` calls (tests, other tools) still prompt each time,
  which is the conservative default.
