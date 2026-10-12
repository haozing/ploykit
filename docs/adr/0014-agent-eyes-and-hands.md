# ADR 0014 · Agent eyes and hands: mountable dev surface (logring / devx / mcpx)

**Status:** Accepted (2026-10-12). Batch: platform/logring + logx.WrapHandler + events.Client + platform/mcpx + platform/devx + example wiring (agent control plane, five doctor checks, Drain 45s fix). Closes the "llms.txt / MCP server" and re-scopes the "agentlog" deferral rows of docs/agent-native.md §5.

## Background

Products built on ploykit are developed by coding agents (five product feedback rounds to date). Agents fail in two recurring ways: they cannot SEE the running app they are developing (logs scattered on stdout, failed river jobs invisible), and they have no HANDS (no way to retry a job, provision a dev tenant, or run a wiring self-check other than re-reading source). Industry convergence (Stripe/Supabase/Sentry MCP servers, Sentry error-artifact pattern, riverui's API bundle) plus our own session evidence fired the deferral triggers recorded in docs/agent-native.md §5: external agent consumers exist.

The key framing decision: ploykit is a framework, not a hosted service. "The framework's MCP server" is therefore a **mountable component inside each product's app** (the agent connects to the product it is developing), not a ploykit-hosted control plane — the mcp-grafana / riverui shape, not the Stripe-hosted shape.

## Decision

Three new platform packages, all env-gated and **off by default** (silent degradation, same contract as platform/metrics):

1. **platform/logring** — capture: a slog.Handler wrapper (installed via the new `logx.Options.WrapHandler`) that mirrors every emitted record into an in-memory ring, indexed per request id (`webx.RequestIDFromCtx`) with LRU eviction, plus a global tail window. Strings are scrubbed through redactx by default. Pure library, no HTTP.
2. **platform/devx** — surfaces: `Mount` (GET /dev/logs, GET /dev/jobs, GET /dev/jobs/{id}, POST /dev/jobs/{id}/retry, POST /dev/jobs/{id}/cancel, GET /dev/doctor), the `Doctor` check registry (with five built-in checks for the classic boot failures), and `RegisterTools` (MCP tools over the same service layer). Mutating operations reach audit via the injected `AuditHook` — platform cannot import the audit domain (A1), so the product injects its Recorder.
3. **platform/mcpx** — hands: the official MCP Go SDK (`github.com/modelcontextprotocol/go-sdk`) behind a `metrics`-shaped mount (`NewMount(Config{Enabled, Path})` + `.Handler()` at `.Path()`). Products and framework packages register intent-level tools via `RegisterTools` / `Mount.Server()`.

Authorization model: the surfaces mount **behind the global `webx.Authenticate`**; PAT callers are scope-bounded by `webx.RequireScope` with two new scopes — `dev:observe` (reads) and `dev:operate` (retry/cancel). Browser sessions pass scope checks untouched (role checks stay with the product), mirroring the existing `RequireScope` semantics.

Transport decision for /mcp: **stateless mode** (every POST is self-contained). This is load-bearing: it puts the HTTP request context — Principal, request id — into every tool handler's ctx, so tool-level scope checks read the same `webx.Principal` the HTTP routes see. The sessionful transport would strand auth in headers the handlers never see.

## Boundary and non-goals

- **Development-stage tooling, not a production observability stack.** logring is process-local, bounded, and lost on restart. Production log shipping stays the product's decision; the JSON log format + request_id correlation keep that door open (logx already provides both).
- /dev/* and /mcp answer 404 when their env flag is off (route not mounted), and the endpoints answer 404 with an explicit "not enabled / not wired" body when compiled in but their backing service is nil — degradation is diagnosable, never silent-empty.
- /mcp follows the mount convention (like /metrics): not in openapi.yaml; the tool list is self-describing via MCP initialize/tools/list. /dev/* are plain REST and ARE in the contract (check_api scans platform/devx).
- Doctor checks are opt-in per product wiring; the five built-ins cover only the failures recorded in AGENTS.md's operational gotchas that a process can self-verify (river schema, seal key, cookie/shape consistency, drain window, health probes).
- No llms.txt, no agent-identity model, no CLI binary in this batch — those keep their own triggers (docs/agent-native.md §5).

## Consequences

Positive
- An agent developing a product gets "one artifact per failure" (request id → full log context) and intent-level hands (list_failed_jobs → get_job → retry_job, run_doctor) without any product code.
- The doctor turns the AGENTS.md gotchas (which exist because agents kept hitting them) into executable, queryable diagnostics.
- Example wiring dogfoods: the drain-window check drove the Drain(10s) → Drain(45s) fix in example/cmd/app.

Negative
- Two more dependencies enter the framework module: the MCP Go SDK (vendor-neutral, spec 2026-07-28) and, transitively, its schema/oauth stack. Accepted for mcpx only — logring/devx stay on the stdlib + river.
- The doctor's drain-window check reads a wiring constant, not the live shutdown decision; a product that changes Drain without updating the check constant can make the check lie. Mitigated by wiring both from one place in example and documenting the contract.

Non-goals
- Per-workspace job scoping (river rows carry no workspace column); the dev surface is operator-grade by design.
- Tool-call rate limiting (the /mcp path inherits nothing today; revisit when an agent-facing product ships).
