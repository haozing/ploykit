# ADR 0011 · Step-up reauthentication layering: machinery lives in webx; authorization.Challenge keeps only computed escalation

Status: accepted & implemented (2026-10-10); landed within the same change: migration 044 + webx (Principal.PasswordConfirmedAt / RequireRecentAuth / E_REAUTH_REQUIRED) + identity (ConfirmPassword service + POST /auth/confirm-password) + workspace Deps.StepUp + example reference wiring (workspace delete / transfer ownership, 15-minute window).

## Background

authorization/ (the strong profile) treats challenge as a first-class decision (allow/deny/challenge) with two built-in step-up rules (assurance / recent-auth) — but the package has zero consumers (shelved per ADR 0005). An external survey on 2026-10-10 (Go authorization libraries, full-stack frameworks, open-source multi-tenant SaaS starters, commercial authorization platforms) produced three layers of evidence:

1. **Step-up is a market-validated real need**: Clerk (Reverification), WorkOS (auth_time claim + max_age; the vendor's stated driver is SOC 2/HIPAA/PCI compliance), Laravel (password.confirm middleware), GitHub (sudo mode).
2. **The industry uniformly puts the machinery in the authentication layer**: all four are isomorphic — the session/access token carries the freshness fact (timestamp claim), the server compares freshness before sensitive operations, and failure is a two-phase protocol (403/redirect challenge → reauthenticate → retry the original request). Not one places it inside the authorization decision engine.
3. **Nobody sells step-up as a third decision value of an authorization package**; and across a dozen SaaS starters step-up appears zero times — it is an authorization-platform feature, not starter equipment.

ploykit's own structural constraints had already paid for half of the decision: rule A6 forbids authorization/ from importing anything — it structurally cannot own the reauthentication flow (it cannot touch sessions or render a confirmation page). And all current consumers of the simple profile (authz: example, aiblog, risk-engine) should not be forced onto the catalog evaluator just to get sudo mode.

## Decision

**Split by concern — it is not either/or:**

1. **Freshness fact + reauthentication flow + static route-level policy live in webx/identity (the auth layer):**
   - `webx.Principal.PasswordConfirmedAt` — the password-proof timestamp (sessions born from password login / registration / password change start confirmed; code login, third-party login, and impersonation start unconfirmed);
   - `webx.RequireRecentAuth(maxAge)` — route-level middleware: stale or never-confirmed → **403 `E_REAUTH_REQUIRED`** + `details.max_age_seconds` (RFC 9470's insufficient_user_authentication semantics adapted to the cookie + error-envelope shape; 403, not 401 — the caller IS authenticated, only the assurance is stale, and a 401 would wrongly steer SPAs into full re-login). Machine callers (PAT/system) always get a plain 403: they cannot reauthenticate interactively, so scoped PATs must not reach actions reserved for a present human;
   - `POST /auth/confirm-password` (identity) — the second phase of the protocol: verify the password (through the same attempt limiter as login, so a hijacked session cannot brute-force), stamp the current session, client retries the original request;
   - **Composition-order contract: the permission check is outermost (role denial is terminal), the step-up challenge is inner (recoverable)** — an unauthorized member must not be coaxed through a reauthentication only to find out they can never pass the permission gate (workspace `Deps.sensitive` enforces the order; test-pinned).
2. **authorization.Challenge is reserved for *computed* step-up**: catalog/rule-driven dynamic policy ("require it only for production resources", "only when touching someone else's data") is what needs a third decision value; its REAUTH projection (`ErrReauthenticationRequired`) is glued by the product onto the webx reauthentication flow. Static route-level needs stop at middleware, isomorphic to the industry four.
3. **webx step-up does NOT fire ADR 0005 restart trigger #1**: that trigger is explicitly scoped to "with challenge as a first-class decision" (the strong-profile form). Auth-layer static step-up is a generic capability for all simple-profile consumers and unrelated to the strong-profile catalog evaluator; ADR 0005's shelving stands.
4. **The window length is product policy** (GitHub 2h / Laravel 3h / this wiring 15min): `RequireRecentAuth(maxAge)` forces an explicit choice per mount site and deliberately ships no package default — also correcting the authorization package's overreach of hardcoding `RecentAuthWindow = 600s`.

Implementation note: `webx.SessionStore.CreateSession` / `app.Repo.CreateSession` / admin `SessionMinter.CreateSession` signatures uniformly changed to a `SessionCreate` struct parameter (carrying `PasswordConfirmed`) — this repo is v0.x with no external implementers, and the change was closed out in one pass per "clean over compatible" (the rationale in ADR 0008 decision item 2 — "leave the signature untouched" — no longer holds; recorded here).

## Boundary and non-goals

- **No MFA freshness** (AAL2 / recent-mfa): the session records only the password-confirmation time; an MFA stamp would be a second fact column + a second confirmation endpoint — deferred until a real consumer exists (not even a ROADMAP entry; YAGNI).
- **The authorization package gets zero code changes in this batch**: its built-in recent-auth/assurance rules keep reading facts via FactsProvider — the same session column webx stamps, so the data source is consistent by construction; the package only gains a README convention (double-mounting on the same operation is forbidden).
- **No frontend confirmation modal in this batch**: the example frontend has no workspace-deletion page, and the client's `ApiError.details` already carries `max_age_seconds`; the first real frontend consumer should follow the Clerk modal pattern (catch 403 → modal → confirm-password → auto-retry the original request).

## Consequences

- Positive: all three existing consumers (simple profile) gain sudo-mode capability without touching the strong profile; the strong profile's challenge narrows to its genuinely unique value (computed policy), making the restart-trigger semantics more precise; the 403/401 semantics align with the industry (Clerk also uses 403).
- Negative: the `CreateSession` signature change ripples through every implementer and test fake (one-time, compiler-backed); step-up semantics now live across two packages (webx machinery / authorization computation), requiring README cross-references to prevent mis-mounting — pinned by the double-mount prohibition and the composition-order test.
