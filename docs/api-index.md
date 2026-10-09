# ploykit API Index (a progressive-disclosure intermediary page)

> The index only points the way; it does not duplicate signatures — signatures live in each domain's `hooks.go`, and semantics and applicable scenarios are carried in the table below.

## Hook master table (25 existing, covering the six hook-bearing domains; semantics quick reference at the end of the table)

| Hook | Location | Semantics | What products use it for |
|---|---|---|---|
| AfterRegister | identity/hooks.go | Transactional | Seed initial data inside the registration transaction / send welcome emails |
| AfterLogin | identity/hooks.go | Observational | Post-login analytics / risk control |
| OnLoginFailed | identity/hooks.go | Observational | Alert on failed-login risk signals |
| AfterPasswordChange | identity/hooks.go | Observational | Notify other devices that they have been logged out |
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

## Other API surfaces

| Surface | Source of truth |
|---|---|
| HTTP endpoints | docs/openapi.yaml (drift guarded by tools/check_api.py) |
| Frontend components / hooks | packages/ui/src/index.ts, packages/client/src/index.ts |
| Platform packages | godoc of each platform/<pkg> package |
