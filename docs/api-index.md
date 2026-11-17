# ploykit API Index (a progressive-disclosure intermediary page)

> The index only points the way; it does not duplicate signatures — signatures live in each domain's `hooks.go`, and semantics and applicable scenarios are carried in the table below.

## Hook master table (26 existing, covering the six hook-bearing domains; semantics quick reference at the end of the table)

| Hook | Location | Semantics | What products use it for |
|---|---|---|---|
| OnRegisterTx | identity/hooks.go | Transactional | Bind roles and other must-succeed-with-the-user state inside the registration transaction (password register, admin create only — the JIT paths have no caller transaction) |
| AfterRegister | identity/hooks.go | Observational (post-commit; failure is logged at ERROR, surfaced as `LoginResult.ProvisioningPending`, re-fired on the account's next login) | Provision personal workspace / welcome email / onboarding credits after commit on EVERY registration path (password, admin create, OAuth JIT, code JIT) — must be idempotent; never bind rollback-required state here (use OnRegisterTx) |
| AfterLogin | identity/hooks.go | Observational | Post-login analytics / risk control |
| OnLoginFailed | identity/hooks.go | Observational | Alert on failed-login risk signals |
| AfterPasswordChange | identity/hooks.go | Observational | Notify other devices that they have been logged out |
| ChainHooks | identity/chain.go | Combinator (not a hook itself) | `ChainHooks(hooks ...IdentityHooks)` composes several IdentityHooks into the one value WithHooks accepts — the extension points are composition magnets (provisioning + legal acceptance evidence both take AfterRegister/AfterLogin) and without a chain one product hook silently shadows the other; field semantics follow the rows above (OnRegisterTx runs in argument order and short-circuits on first error; observational fields run every chained hook, join errors with hook-index attribution, never short-circuit; nil args/fields skipped) |
| AfterCreate | workspace/hooks.go | Transactional | Seed default projects / boards / agents inside the workspace-creation transaction |
| BeforeDelete | workspace/hooks.go | Validating | Block deletion when open orders or active resources exist |
| OnTeardown | workspace/hooks.go | Cleanup | Cascade cleanup on workspace deletion (cancel active tasks, etc.) |
| AfterMemberJoin | workspace/hooks.go | Transactional | Send a welcome notification when a member joins (unified entry for invites/share codes) |
| BeforeMemberRemove | workspace/hooks.go | Validating | Block removing members with unfinished tasks |
| OnMemberRemoved | workspace/hooks.go | Cleanup | Cascade cleanup: revoke PATs → cancel tasks → delete subscriptions → archive sessions |
| BeforeOwnerChange | workspace/hooks.go | Validating | Block ownership transfers that fail preconditions (e.g., the target has unsettled billing) |
| OnOwnerTransfer | workspace/hooks.go | Observational | Notify the old and new owners after a successful ownership transfer |
| OnImpersonation | admin/hooks.go | Observational | Send security alerts after impersonation / feed external risk control |
| OnNearLimit | quota/hooks.go | Observational | Remind at 80% usage (fires on every threshold crossing; "once per month"-style dedup is the hook implementer's responsibility) |
| OnExhausted | quota/hooks.go | Observational | Guide plan upgrades on quota exhaustion (fires on every rejection; "once ever"-style dedup is the hook implementer's responsibility) |
| OnGrant | quota/hooks.go | Observational | Celebrate milestone unlocks (idempotency dedup is the hook implementer's responsibility) |
| OnReservationExpired | quota/hooks.go | Observational | Reconcile / alert / leave a trail when a two-phase reservation is expired and reclaimed by the TTL sweeper (once per row) |
| BeforeCheckout | billing/app/hooks.go | Validating | Custom eligibility validation before checkout (may block payment, e.g., "a phone number must be bound") |
| OnPlanChanged | billing/app/hooks.go | Observational | Provision or downgrade premium features after a plan change and send confirmation emails |
| OnPlanChangedTx | billing/app/hooks.go | Transactional | Record ledger entries inside the plan-change write transaction (the proration recording point; the formula belongs to the product) — division of labor with OnPlanChanged: Tx = rollback-safe ledger entries, OnPlanChanged = after-the-fact notification |
| OnPaymentFailed | billing/app/hooks.go | Observational | Send dunning notifications on payment failure |
| OnSubscriptionRenewed | billing/app/hooks.go | Observational | Refresh quota cycles and send renewal confirmations after a successful subscription renewal |
| OnMeteredOverage | billing/app/hooks.go | Observational | Send overage billing notifications / manual payment entry after the first overage order is billed |
| OnDeliveryFailed | webhooks/hooks.go | Observational | Raise alerts and dead-letter notifications on terminal delivery failure (retries exhausted / straight to terminal state) |
| OnSubscriptionDisabled | webhooks/hooks.go | Observational | Send a notification after a subscription is disabled |

Semantics quick reference: Transactional = returning an error rolls back the entire operation; Observational = logging only; Validating = may block the operation; Cleanup = best-effort cleanup where a single item's failure does not block.

## video domain (example product domain, Agent video studio)

HTTP endpoints (full contract in docs/openapi.yaml; workspace context via X-Workspace-Id, writes CSRF-protected, PAT scopes video:read / video:write / video:render):

| Endpoint | Semantics |
|---|---|
| GET /api/video/projects | List video projects in the workspace (updated_at desc) |
| POST /api/video/projects | Create a project (empty IR, version=1) |
| GET /api/video/projects/{id} | Project detail: metadata + full IR + optimistic-lock version (the version appears both inside `project` and at the envelope top level — same value) |
| PUT /api/video/projects/{id}/ir | Full IR replacement; `expected_version` required — 409 E_VIDEO_VERSION_CONFLICT on mismatch |
| DELETE /api/video/projects/{id} | Delete a project (renders cascade via DB) |
| GET /api/video/templates | Template + theme catalog for the script-to-video generator (`{templates, themes}`; each template carries a `layout` text description — G-08a). Returns empty catalogs (200, not 5xx) when the composer is unwired |
| POST /api/video/projects/{id}/compose | One-shot compose: script + template + theme → full renderable IR (server-side split / keyword-highlight / timing-window pipeline, optimistic lock version++). 503 E_NOT_CONFIGURED when the composer is unwired; unknown template/theme keys and out-of-range card counts are 400 E_VIDEO_IR_INVALID |
| GET /api/video/projects/{id}/preview.html | Single-projection preview HTML (iframe embed; same projection the render worker consumes) |
| POST /api/video/projects/{id}/renders | Submit a render → **201 + the full Render object** (`id, project_id, status, frames_done, frames_total, output_url?, thumb_url?, error?` — not the legacy `{render_id, status}` envelope). River `video` queue; snapshots ir_snapshot; video_renders_monthly quota; 503 E_NOT_CONFIGURED when capx lacks Chrome/ffmpeg. Optional `Idempotency-Key` header (trimmed to 128 chars): a retry with the same key replays the first submission's render — no second row, no second quota charge |
| GET /api/video/projects/{id}/renders | Render history for the project |
| GET /api/video/renders/{id} | Render status / progress / output (polling fallback; live progress rides WS scope "video") |
| POST /api/video/assets | Upload an asset (multipart; `project_id` form field **required**; content-addressed storagex key, idempotent on identical bytes). **Two channels, two caps**: REST multipart ≤ **50MiB** (`UploadLimitLarge`, paired with main.go's single-layer `BodyLimitExcept` exemption + a 120s timeout tier), MCP base64 `video_upload_asset` ≤ **700KB** (`UploadLimit`, sized to the /mcp body limit) — same registration path, only the cap differs |
| GET /api/video/files/{key} | Authorized download with Range support (membership checked off the key's workspace prefix, plus the video_asset / video_render registration row; mp4 seeking requires 206) |

Agent face: **21 `video_*` MCP tools today** and growing (count verified by `grep -c "mcpAdd(" example/internal/video/adapters/mcp/tools.go`; the registry there is the source of truth — the count is deliberately not frozen in docs), **PAT-only**: `requireToolScope` rejects browser-session principals and enforces the per-tool scope (`video:read` / `video:write` / `video:render`). `/mcp` routes are contract-exempt (ADR 0014), so these tools do not appear in openapi.yaml. Rationale and the PAT-only decision: ADR 0017 (§5, D6).

Hooks: **video has no hooks in v1** — hook extension slots are reserved in the
`app/service.go` hooks shape (the domain's service layer is the single mutation entry; when
the first hook need appears, follow the existing domain `hooks.go` pattern).

## Other API surfaces

| Surface | Source of truth |
|---|---|
| HTTP endpoints | docs/openapi.yaml (drift guarded by tools/check_api.py) |
| Frontend components / hooks | packages/ui/src/index.ts, packages/client/src/index.ts, packages/hooks/src/index.ts |
| audit Recorder (Record fire-and-forget / **RecordTx in-transaction**; same SQL source) | audit/audit.go godoc |
| Platform packages | godoc of each platform/<pkg> package |
