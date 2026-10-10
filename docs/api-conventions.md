# API Conventions & Integration Pitfalls (read before integrating)

> Written conventions for API consumers (scripts, integrations, frontends), sourced from real
> integration field reports (risk-engine-server W1-W8, aiblog). Framework internals live in
> docs/architecture.md and docs/platform-api-index.md.

## CSRF lifecycle (the #1 integration pitfall)

The CSRF token is **bound to the session and rotates on session establishment**:

```
GET  /config                     -> csrf_token = T0 (anonymous token)
POST /auth/send-code    (T0)     -> 200
POST /auth/verify-code  (T0)     -> 200 -- session established here; token rotates to T1
POST /api/anything      (T0)     -> 403 E_FORBIDDEN "CSRF token missing or invalid"
POST /api/anything      (T1)     -> 200
```

**After a session-establishing response (verify-code / login / register), re-fetch `/config`
for the new token** - the old one is dead. This exists to prevent token fixation (sensible),
but the symptom is "login succeeded yet every write is 403" - easily misread as a permission
or middleware-ordering problem. Remember this line before debugging.

- The token travels in the `X-CSRF-Token` request header; `/config` always returns the
  currently valid (masked) token.
- **Local HTTP note**: the session cookie defaults to `Secure=false` so local/intranet
  logins work out of the box; production MUST opt in explicitly with `cfg.Secure = true`
  (example wires it to `SECURE_COOKIE`). The reverse default once made plain-HTTP
  deployments fail login with an opaque CSRF error whose root cause was two layers away
  (the cookie is never sent back over plain HTTP).
- **Origin drift note**: `TrustedOrigins` matches `host[:port]` exactly. A dev server that
  drifts off its port (vite 5173 -> 5176 when 5173 is taken) fails the origin check while
  login and reads keep working - the signature is "every write 403s", easily misread as a
  permission problem. In development set `TrustLocalhostAnyPort: true` (the example derives
  it from `PRODUCTION`): the loopback family (`localhost`, `127.0.0.1`, `[::1]`) is then
  trusted on any port. Production must enumerate exact origins. A failed origin check now
  self-describes - the 403 details carry `request_origin` and `trusted_origins` next to an
  "origin check failed" message, instead of hiding behind "token missing or invalid".
- **PAT (Bearer) requests are exempt from CSRF by design** - server-to-server integrations
  need no CSRF handling at all.
- For product-exposed **server-to-server APIs** (no browser session, own auth such as an
  API key), exempt the prefix in the CSRF middleware config:

```go
csrfMW := webx.CSRFConditional(&webx.CSRFConfig{
    Key: ..., TrustedOrigins: ...,
    ExemptPrefixes: []string{"/open/"}, // server-to-server API (own auth, no session)
}, authCfg.Secure)
```

- **Public-page cacheability (CDN)**: the middleware sets `ploykit_csrf` on the first GET
  and `Vary: Cookie` on every response it processes, so shared caches cannot serve anything
  behind it. For a public, read-only GET tree (feeds, published articles, marketing pages)
  exempt the prefix the same way — GET-only public content has no CSRF surface to protect,
  and exempted responses carry neither the cookie nor the Vary header:

```go
ExemptPrefixes: []string{"/open/", "/feed.xml", "/archives/"}, // server-to-server APIs + public GET tree
```

  Exemption is all-methods under the prefix: never exempt a prefix that also serves
  browser-session writes. Cached responses additionally need an explicit `Cache-Control`
  from the product — the framework does not set one.

## The two registration paths

| Path | Flow | Use when |
|---|---|---|
| **Code-as-login** (the quickstart path) | `POST /auth/send-code` -> `POST /auth/verify-code` (email+code) - verification creates the account if absent and establishes the session | The default human-facing flow, no passwords |
| **Email+password registration** | `POST /auth/register` (email+password+display_name; **does not accept a `code` field** - sending one yields E_BAD_JSON) -> login via password | Products that want a password system |

Common misconception: sending `code` to register. openapi.yaml is the field-contract source of truth.

## Error response semantics

```json
{ "error": "E_VALIDATION", "message": "invalid email" }
```

- The `error` field carries the **business code** (`E_*` enum; full list in the ErrorBody
  schema of openapi.yaml), not the human message.
- `message` is the human-readable description.
- The HTTP status / business code mapping is stable (400=E_VALIDATION/E_BAD_JSON,
  401=E_UNAUTHENTICATED, 403=E_FORBIDDEN, 404, 409=E_CONFLICT, 429=E_RATE_LIMITED) -
  **do not read `error` as a message, and do not branch business semantics on HTTP status**.

> Naming note: the Go field is `Code` with JSON name `error` - historical. Unchanged in 0.x
> (renaming breaks every existing consumer); the semantics above are the contract.

> Producer-side rule (aiblog D4 field report): never write raw driver errors to the HTTP
> surface — `http.Error(w, err.Error(), 500)` on a public page leaked the DB
> username/host/port to anonymous visitors during an outage. Handlers emit errors through
> `webx.WriteError(...)` / the `webx.ErrInternal(w)` shorthand (500 `E_INTERNAL`, no
> detail); the underlying error goes to the log with the request ID, never the body.

## Step-up reauthentication (E_REAUTH_REQUIRED, two-phase protocol)

Sensitive operations can require a fresh password confirmation (the Laravel
`password.confirm` / GitHub sudo-mode pattern). Server side this is
`webx.RequireRecentAuth(maxAge)` mounted after `Authenticate`; clients see:

```json
HTTP 403
{ "error": "E_REAUTH_REQUIRED", "message": "password confirmation required",
  "details": { "max_age_seconds": 900 } }
```

The recovery protocol is **two-phase, not a redirect**:

1. catch the 403 (note: **403, never 401** — the caller IS authenticated, only the
   assurance is stale; treating it as 401 wrongly steers SPAs into full re-login);
2. prompt for the password, `POST /auth/confirm-password` `{"password": "..."}`
   (sessions born from password login/registration/password change start confirmed;
   code/third-party logins start unconfirmed — see ADR 0011);
3. **retry the original request** — the confirmation stamps the current session, no
   new cookie is issued.

Machine callers (PAT / system) get a plain `E_FORBIDDEN` instead — they can never
reauthenticate interactively, so scoped PATs must not reach actions reserved for a
present human. Failed confirmations share the login attempt limiter (429 after the
configured window). The reference wiring lives in example (workspace delete /
transfer-ownership, 15-minute window, `workspacehttp.Deps.StepUp`).

## Route style (Go stdlib ServeMux pitfalls)

All action endpoints in the framework use the **slash style**: `POST /{id}/accept`,
`POST /{id}/transfer-ownership`. Keep it in products, because the intuitive colon style
panics at startup under Go 1.22+ ServeMux:

```go
// FAIL: parsing "POST /admin/v1/fields/{id}:disable": at offset 22:
//         bad wildcard segment (must end with '}')
mux.HandleFunc("POST /admin/v1/fields/{id}:disable", h)

// framework convention
mux.HandleFunc("POST /admin/v1/fields/{id}/disable", h)
```

Sibling pitfall: the **root fallback must be the bare `/`** - registering `GET /` conflicts
with existing patterns and panics.
