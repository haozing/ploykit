# ADR 0016 · Personal-workspace provisioning as a framework capability

**Status:** Accepted (2026-10-17). Companion to the identity hooks split (same batch). Field evidence: shuijing production panic from a copied AfterRegister hook (nil-tx deref on the OAuth JIT path) and a silently half-provisioned account (hook failure = WARN only, login proceeds, no signal, no self-heal).

## Background

Every B2C product needs the same ~20 lines after registration: create the user's personal workspace, bind the owner membership, grant onboarding credits — idempotently. Each product hand-writes it against the raw `AfterRegister(ctx, tx, userID)` hook, and the hook's transaction semantics differ by registration path (password/admin fire inside the creation transaction; OAuth/verification-code JIT fire post-commit with `nil`). The knowledge lives only in test assertions; copying between products explodes in production.

## Decision

1. **Hooks split by lifecycle, not by transport** (`identity/hooks.go`):
   - `OnRegisterTx(ctx, tx, userID)` — fires inside the user-creation transaction; only paths that create a user in one transaction (password register, admin create). Error rolls the registration back.
   - `AfterRegister(ctx, userID)` — no tx parameter, fires after commit on **all** registration paths. Must be idempotent; failure never rolls the user back; logged at ERROR and surfaced as `LoginResult.ProvisioningPending`.
   - `LoginResult` gains `Registered`, `ProvisioningPending` (wire) and `ProvisioningError` (in-process only) so products and UIs can see and recover from half-provisioned accounts.

2. **`provisioning/` — a top-level composition package** (sanctioned composition layer, same shape as `admin/adapters/bridge`; NOT inside `identity` — composing identity+workspace+quota inside a domain would violate the lateral-import rule). `provisioning.PersonalWorkspace(cfg) identity.IdentityHooks` returns hooks that ensure one personal workspace per user:
   - `workspace.kind` column (`'team'` default, `'personal'`) with a **partial unique index on `created_by WHERE kind='personal'`** — idempotency is a database invariant, not code discipline.
   - Deterministic slug derived from the user id (`my-<uuid-hex>`).
   - Onboarding credits via `quota.Service.GrantTx` (insert on the caller's transaction, no hook side-fire) inside the same transaction as the workspace + membership insert.
   - The factory wires BOTH `AfterRegister` and `AfterLogin`: registration ensures once; **every login re-ensures** (one indexed lookup), so JIT half-provisioning, crashes mid-provision, and any failure converge on the next login — no retry table, no pending-flag column.
   - Slug/id collision or lost race on the unique index resolves to "already provisioned" (nil error).

3. **Quota gains `GrantTx`** — same idempotent insert as `Grant` on a caller-provided transaction, deliberately WITHOUT the `OnGrant` hook side-fire (the caller owns the transaction; hook timing inside a foreign transaction is not definable).

## Boundary and non-goals

- The factory provisions **one personal workspace**; teams/invitations stay explicit product flows.
- No email, no onboarding page, no API surface — hooks only. Products own their UX.
- Framework migrations (001–999) gain only the `workspace.kind` column + index; RLS policy choices remain product-side.
- Quota is required only when onboarding credits are configured — products running their own credit ledger leave `Credits`/`Quota` empty and provision the workspace + membership only.

## Adoption with existing users

Migration 048 marks every pre-existing workspace `'team'`. A product that
already hand-provisioned personal workspaces and now adopts the factory must
classify those legacy rows **before** wiring the hooks — otherwise `ensure`
finds no `kind='personal'` workspace for existing users and provisions a
second (empty) one on their next login, with credits landing in the empty
bucket. The classification is a product migration (which legacy workspaces
are "personal" is a product decision the framework cannot guess):

```sql
UPDATE workspace SET kind = 'personal' WHERE <product predicate>;
```

Alternatively a product may deliberately accept the second workspace (fresh
personal space, legacy data stays in the old workspace) — that is a product
decision, but it must be a decision, not a surprise. Products without
pre-existing users are unaffected.

## Consequences

Positive: the nil-tx trap is structurally gone (the no-tx hook has no tx parameter); half-provisioned accounts self-heal on next login; B2C wiring drops to one line.
Negative: breaking change to `IdentityHooks` (all consumers re-point); a new top-level package with lateral imports requires the arch-test sanctioned exception; the login-time re-ensure adds one indexed query per login (accepted — it is the convergence mechanism).
