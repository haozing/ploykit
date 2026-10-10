# ploykit Platform API Index (consult before writing code)

> The index only points the way; it does not duplicate full content — signature essentials and one-line purposes live here, while complete signatures, semantic details, and evidence live in each package's godoc.
> This is the "**check before write**" anti-corruption anchor: before writing any middleware, helper, port adapter, or contract endpoint, first check whether the platform already offers the capability;
> it pairs with the internal/arch example anti-reinvention test (`example_reinvention_test.go`) — hand-written equivalents on the product side will be flagged red by tests.
> **Maintenance obligation**: the same batch that adds/changes an exported API must add/update entries in this table in lockstep (discipline on par with tools/check_api.py guarding openapi.yaml).

## platform/webx (HTTP fundamentals)

### Route registration and introspection

| Symbol | Signature essentials | Purpose |
|---|---|---|
| Router | `Router` interface: `Handle(pattern, h)` / `HandleFunc(pattern, f)` | The route-registration surface every framework `Mount` function accepts; `*http.ServeMux` satisfies it, so std-mux wiring keeps compiling unchanged |
| Mux | `NewMux() *Mux`; `Handle` / `HandleFunc` (record + delegate), `Routes() []RouteInfo`, `ServeHTTP` | Recording mux wrapping `*http.ServeMux` — the route introspection the std mux lacks (the chi.Walk equivalent): serving behavior is the delegated std mux unchanged, while every registered pattern is recorded |
| RouteInfo | `RouteInfo{Method, Path, Pattern}` | One registered route: `Method` is the pattern's leading HTTP method (`""` for method-less mounts/catch-alls — not endpoints, skip them); `Path` is the pattern minus the method prefix, wildcards kept literal |

Runtime contract-test pattern for products: build the production mux as `webx.NewMux()`, mount through the real `Mount` functions, take `mux.Routes()`, skip entries with `Method == ""` (mounts are not endpoints), and diff the remaining `Method + Path` set against the parsed `paths:` object of the OpenAPI spec — fail on any route present on only one side, and pin the total count to the number `tools/check_api.py` reports (the static twin guard). Reference implementation: `example/cmd/app/routes_contract_test.go`. Domains that mount an internal sub-mux under a StripPrefix expose their absolute sub-route infos separately (workspace: `SubrouteInfos()`) — include those in the runtime side.

### Middleware

| Symbol | Signature essentials | Purpose |
|---|---|---|
| CORS | `CORS(allowedOrigins []string, allowCredentials bool)` | Admits cross-origin requests via an Origin allowlist; with credentials, `*` is forbidden in favor of exact echo. **Never hand-write Access-Control-Allow-Origin** |
| Timeout | `Timeout(d time.Duration)` | Falls back to 504 E_TIMEOUT when the deadline arrives with no write started; the handler finishes in its own goroutine and late writes are dropped; must not wrap /ws upgrades or SSE |
| TimeoutExcept | `TimeoutExcept(d, exemptPrefixes ...string)` | Same as Timeout but exempts by path prefix — the passthrough for long-lived routes (/ws, SSE); products previously hand-wrote these exemptions |
| BodyLimit | `BodyLimit(n int64)` | Only wraps MaxBytesReader, no pre-reading; 413 semantics are translated uniformly by DecodeJSON |
| RateLimit | `RateLimit(l Limiter, dimension string, perMinute int, keyFn)` | Rate-limits by the keyFn dimension; over-limit returns 429 E_RATE_LIMITED + Retry-After; inject redisx.GCRALimiter as the backend |
| Recover | `Recover(log *slog.Logger)` | Catches handler panics → logs + 500, so connections are never dropped raw |
| AccessLog | `AccessLog(log, trustedProxies ...*net.IPNet)` | Logs method/path/status/ms/ip/user_id/request_id/client_* with severity leveled by status code; must sit inside RequestIDMiddleware |
| SecurityHeaders | `SecurityHeaders(next)` | nosniff / X-Frame-Options DENY / Referrer-Policy / CSP default-src 'none' |
| RequestIDMiddleware | `RequestIDMiddleware(next)` | Generates/passes through X-Request-Id (uuid v7), writes it back to the response header and injects it into ctx |
| ClientMetadata | `ClientMetadata(next)` | Extracts X-Client-Platform/Version/OS and injects them into the request context |
| Authenticate | `Authenticate(cfg *AuthConfig, sessions SessionStore, pats PATLookup)` | Dual-channel global authentication (Bearer tk_ → PAT; Cookie → DB validation + sliding renewal); anonymous requests pass through, protected routes additionally mount RequireAuth/P |
| RequireAuth / RequireHuman | `RequireAuth(next)` / `RequireHuman(next)` | Rejects anonymous requests with 401; RequireHuman restricts to browser sessions (PAT/system → 403), dedicated to sensitive operations |
| RequireRecentAuth | `RequireRecentAuth(maxAge)` (mounted after Authenticate) | Step-up (sudo mode): only browser sessions with a fresh `PasswordConfirmedAt` pass; stale or never-confirmed → 403 `E_REAUTH_REQUIRED` + `details.max_age_seconds`, the client stamps via `POST /auth/confirm-password` and retries; PAT/system always 403. No default window — pick explicitly per mount site (ADR 0011; protocol in docs/api-conventions.md) |
| ParseOrigins / ParseTrustedProxies / ClientIP | Parses comma-separated Origin / CIDR lists; ClientIP only trusts X-Forwarded-For from trusted proxies (skipping trusted segments right-to-left) | Input-parsing companions for CORS and AccessLog |

### Authentication and Principal

| Symbol | Signature essentials | Purpose |
|---|---|---|
| Principal | `Principal{UserID, Name, Email, Source, SessionID, PATID, WorkspaceID, Role, Project, Scope, AgentID, IsPlatformAdmin, ImpersonatedBy, PasswordConfirmedAt}` | Unified carrier of identity + workspace context; the core of decoupling business domains from identity (arch rule). `PasswordConfirmedAt` (zero = never): the password-proof timestamp, the freshness fact behind RequireRecentAuth (`.PasswordConfirmedWithin(maxAge, now)` predicate) |
| WithPrincipal / PrincipalFrom / PrincipalFromRequest | ctx injection / retrieval (nil = anonymous) | The Principal context channel |
| Source | `session` / `pat` / `system` constants | Authentication provenance |
| ProjectScope | `ProjectScope{ID, Role}` | Optional second-level scope beneath workspace (the entity is owned by the product) |
| CredentialScope | `.AllowsWorkspace(id)` / `.AllowsPermission(perm)`; three states: nil = unconstrained, empty set = reject all; permission points support "domain:*" wildcards | PAT credential scope narrowing |
| SessionStore / PATLookup | `CreateSession(ctx, in SessionCreate)` (SessionCreate{UserID, IPHash, UserAgent, PasswordConfirmed, Now}) + Verify/Renew/Revoke / `ResolvePAT` | Authentication ports implemented by pgrepo; `PasswordConfirmed=true` births the session already confirmed (password login / registration / password-change paths) |
| PrincipalHolder | The `PrincipalHolder()` middleware (outermost → AccessLog → … → Authenticate) | Allocates a per-request PrincipalCell injected into ctx: Authenticate fills it upon successful auth, and the outer AccessLog reads user_id through the cell (the fix for ctx-derived values not flowing back out); when the cell is absent, AccessLog falls back to reading ctx — behavior unchanged |
| AuthConfig | Cookie name/domain, SessionTTL / AbsoluteTTL, Secure, IPHashSecret (required in production; a first call with an empty salt logs a one-time warning), PATPrefix (empty = DefaultPATPrefix "tk_"); `DefaultAuthConfig()`, `.SetSessionCookie` / `.ClearSessionCookie` | Session cookie configuration and issuance/clearing; the PAT prefix is injected from the same source as the identity side |
| DefaultPATPrefix | The `"tk_"` constant — **the canonical PAT token prefix** | Default PAT token prefix and the single canonical constant of the PAT chain: wsx.DefaultPATPrefix aliases it, identity/domain.DefaultPATPrefix mirrors it (domain purity — pure stdlib, no framework import), and the internal/arch parity test pins all three to the same `"tk_"` anchor so drift fails the build; when changing the prefix, inject the same value into identity TokenService and pgrepo Config.PATPrefix |
| MintToken / HashToken / HashIP | 32-byte random hex / sha256 digest for storage / salted IP fingerprint | Session and PAT token infrastructure |
| Limiter / FailOpenLimiter | The `Allow(ctx, key, perMinute)` abstraction; FailOpen always allows | Rate-limit backend interface and the no-backend fallback |
| P | `P(fn func(w, r, p *Principal)) http.HandlerFunc` | Standard business handler signature: authenticated + Principal injected |

### CSRF and /config

| Symbol | Signature essentials | Purpose |
|---|---|---|
| CSRFConditional | `CSRFConditional(cfg *CSRFConfig, secure bool)` | Enforces CSRF on session requests (JSON envelope errors), exempts PATs; secure=false for local http development |
| CSRFConfig | `Key`, `TrustedOrigins` (host[:port] cross-origin submissions, exact match), `TrustLocalhostAnyPort` (dev convenience: trust `localhost` / `127.0.0.1` / `[::1]` on any port), **`ExemptPrefixes` (exempts all methods under a prefix, for server-to-server callbacks such as /webhooks/billing/)**, `PATPrefix` | The CSRF configuration |
| DeriveCSRFKey | `DeriveCSRFKey(signingSecret []byte)` | Derives an independent CSRF key from the session signing secret, preventing key reuse |
| CSRFMaskedToken | `CSRFMaskedToken(r)` | Returns the masked token for the current request (used by /config and template injection) |
| RequireScope | `RequireScope(required ...string)` | **The default PAT-scope enforcement gate** for machine-facing endpoints (shapes that bypass authz): a PAT missing any required permission domain -> 403; sessions and anonymous requests pass. Mount right after Authenticate. Skipping it while building your own actor = every PAT passes with full power (risk-engine #12) |
| RequireWorkspaceScope | `RequireWorkspaceScope()` | PAT workspace bounding for fixed single-workspace contexts (outside the declared list -> 403); request-derived workspaces still go through authz.CanIn in the handler |
| ConfigHandler | `ConfigHandler(d ConfigDeps) http.HandlerFunc` | The GET /config handler: always outputs `{csrf_token, oauth_providers, billing_channels}` — the hard contract behind @ploykit/client CSRF bootstrap |
| ConfigDeps | `OAuthProviders` / `BillingChannels` function injection (nil → empty arrays); `Extra func() map[string]any` — returned key-value pairs are merged verbatim into the response body (Extra wins on conflicts; nil-safe) | Optional extension surface of /config; platform does not import business domains; public settings-domain configuration such as announcements/maintenance mode is delivered through `Extra` |

### Health and connection pool

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewHealth | `NewHealth() *Health`; `.AddCheck(name, CheckFunc)` chainable | Health check aggregator |
| Health.Liveness / Readiness | Liveness always returns 200; readiness runs all checks concurrently with a 2s per-item timeout and on failure returns 503 listing the failed items | Probes for /healthz and /readyz |
| PoolStats | `PoolStats(pool *pgxpool.Pool) (acquired, idle, total int32)` | Connection pool counters, surfaced by /readyz |

### Responses and the apperr constructor family

| Symbol | Signature essentials | Purpose |
|---|---|---|
| WriteJSON / WriteError | `WriteJSON(w, status, v)` / `WriteError(w, status, code, message, details)` | Unified JSON egress |
| ErrorBody | `{error, message, details?}` | The framework-wide error body contract (docs/openapi.yaml) |
| DecodeJSON | `DecodeJSON(w, r, &dst) bool` | Strict decoding: unknown fields are errors; BodyLimit exceeded → 413 E_PAYLOAD_TOO_LARGE |
| WriteErr | `WriteErr(w, err)` | Maps webx.Error by its status code; everything else becomes 500 and logs the original error |
| Error / NewError | `Error{Status, Code, Message}` | Structured business errors at the service layer |
| NewValidation / NewUnauthenticated / NewForbidden / NewNotFound / NewConflict / NewRateLimited / NewQuotaExceeded | 400 / 401 / 403 / 404 / 409 / 429 / 402 + fixed codes | The apperr constructor family (returned by the service layer, materialized by handlers via WriteErr) |
| ErrUnauthenticated / ErrForbidden / ErrNotFound / ErrValidation / ErrConflict / ErrInternal / ErrTimeout / ErrPayloadTooLarge / ErrUnavailable | Common code + status pairings written straight to the response | Handler-side error shorthand family |
| Code* constants | `E_UNAUTHENTICATED`…`E_UNAVAILABLE`, 12 in total | The cross-stack shared error-code vocabulary |

### Request identification and client metadata

| Symbol | Signature essentials | Purpose |
|---|---|---|
| HeaderRequestID / RequestIDFromCtx / RequestID | The `"X-Request-Id"` constant / ctx retrieval ("" before the middleware) / direct request-header read | Request identification readers (for audit and log correlation) |
| HeaderClientPlatform / HeaderClientVersion / HeaderClientOS, ClientUnknown, ClientMetadataFrom | X-Client-* header constants and ctx reads (default "unknown") | Readers for client self-reported metadata |

## platform/wsx (WebSocket realtime layer)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewHub | `NewHub(log *slog.Logger) *Hub` | Room registry + gorilla upgrader; the single entry point for hub construction |
| Hub.BroadcastEvent | `BroadcastEvent(ctx, scope, event string, payload []byte, eventID string) error` | The public broadcast entry for products (the payload rides a public wswire.Frame — products import platform/wswire directly for the type); an empty eventID auto-generates a UUIDv7 |
| Hub.Broadcast / SendToUser / DeliverRemote | Delivers by scope (also publishes outward when a Relay is attached) / unicast to a user room / remote messages are dispatched locally only (the second gate of loop suppression) | Frame-level operations (most products only need BroadcastEvent) |
| Hub.ServeWS / Rooms / RoomSize | Upgrade entry (Origin validation: same-origin is always allowed, allowlist next) / room count / room size | Route mounting and monitoring observability |
| WorkspaceScope / UserScope | `WorkspaceScope(workspaceID)` / `UserScope(userID)` → `"workspace:<id>"` / `"user:<id>"` | Scope key construction. **Never hand-assemble the "workspace:" prefix** (guarded by arch tests) |
| MemberGate | `MemberGate(lookup func(ctx, workspaceID, userID) (bool, error)) WorkspaceMember` | Workspace room membership gate: p==nil / lookup error → false (fail-closed); platform admins exempt |
| WorkspaceMember / PATResolve / Authorize types | Three closure-injection ports | The injection surface decoupling the hub from business domains (composed at the root with the workspace repository / identity token service) |
| RegisterScope / RegisterCapability / Capabilities | Lexical validation ([a-z0-9_], ≤32), errors on reserved names and duplicate registration, not concurrency-safe; `Capabilities()` = framework built-ins + product registrations (lexicographic) | Product-defined room scopes and capability words |
| Hub assembly fields | `Log` `Metrics` `Authorize` `WorkspaceMember` `PATResolve` `PATPrefix` `OnSubscribe` `OnUnsubscribe` `AllowedOrigins` `Capabilities` `Relay` | The composition-root assembly surface; Relay is an inline interface (`PublishOut(ctx, scope, frame)`, wired to relayx); PATPrefix must be injected from the same source as the identity side |
| DefaultPATPrefix | Aliases `webx.DefaultPATPrefix` (`"tk_"`) | The fallback for the Hub.PATPrefix option when empty (option semantics unchanged); the internal/arch parity test pins mint (identity/domain), parse (webx) and this WS auth gate to the same anchor |
| Broadcaster / Metrics interfaces | `Broadcast + SendToUser` / `Incr + Gauge` | The minimal dependency surface for event-bridge and metrics injection |

## platform/wswire (WebSocket wire vocabulary)

The WS wire protocol vocabulary is a public platform package so that products building typed WS clients share one source of truth with the framework instead of vendoring drift-prone copies. Products register their own scope/capability names via RegisterScope/RegisterCapability; the framework reserves the scope names workspace/user and the capability names batch/notification/workspace. wsx re-exports RegisterScope/RegisterCapability for convenience.

| Symbol | Signature essentials | Purpose |
|---|---|---|
| Frame | `Frame{Type, Payload json.RawMessage, EventID}` (JSON: `type` / `payload` / `event_id`) | The wire frame every WS peer sends and receives — shared by the wsx Hub, the relayx envelope, and product-side typed WS clients |
| Ctrl* constants / ConnectedFrameType | `CtrlAuth` / `CtrlSubscribe` / `CtrlUnsub` / `ConnectedFrameType` = `"connected"`; `ConfirmPrefix` = `"confirmed:"` / `RejectedPrefix` = `"rejected:"` | Control-frame type vocabulary plus the server hello and subscribe ack/nack prefixes |
| Scope* / Cap* constants | `ScopeWorkspace` = workspace / `ScopeUser` = user; `CapBatch` / `CapNotification` / `CapWorkspace` | Framework-reserved scope and capability names — rejected by the registration functions |
| RegisterScope / RegisterCapability / IsRegisteredScope | Lexical validation ([a-z0-9_], ≤32, leading lowercase letter), errors on reserved names and duplicate registration, not concurrency-safe; `IsRegisteredScope` probes product registrations (built-ins do not count) | Product-defined room scopes and capability words; register at assembly time |
| Capabilities | `Capabilities() []string` | Framework built-ins (batch, notification, workspace) plus product registrations, lexicographic |
| ScopeKey | `ScopeKey(prefix, id)` → `"<prefix>:<id>"` | Scope-key assembly; wsx.WorkspaceScope / UserScope build on it — never hand-assemble the "workspace:" prefix |
| WSName | `WSName(dotEvent)` → `"a.b"` becomes `"a:b"` | Dot-form event name → WS frame-type name mapping |

## platform/renderx (Rendering: SSR / prerender / SEO)

### Build and assets

| Symbol | Signature essentials | Purpose |
|---|---|---|
| BuildSSRBundle | `BuildSSRBundle(opts BuildOptions) ([]byte, error)` | esbuild Go API producing a single-file IIFE bundle (parameters such as neutral/iife/jsx automatic are hard-coded and non-configurable, §5.3) |
| BuildOptions | `EntryPoints` / `AbsWorkingDir` / `NodePaths` / `Alias` | The only mutable surface of the build chain |
| DefaultSSRAliases | `DefaultSSRAliases(webDir, packagesDir string) map[string]string` | Pins the react family / react-query / @ploykit/* to a single physical copy — guards against duplicate react (hook crashes, Contexts not interoperating) |
| ParseViteManifest | `ParseViteManifest(data []byte, entryKey string) (ViteAssets, error)` | Parses vite manifest.json for hydration assets (empty entryKey = "index.html") |
| ViteBuildID / OutputVersion | `ViteBuildID(data []byte) string`; `OutputVersion` const | Build identifier = sha256 of (`OutputVersion` + manifest): a frontend rebuild or a renderer-output change both rotate the ID, so caches never survive either |
| ViteAssets | `{CSS []string, JS []string}` | The data source for the template injection slots {{CSS_LINKS}}/{{HYDRATE_SCRIPT}} |
| RenderOnce | `RenderOnce(ctx, r Renderer, pageID, location string, props json.RawMessage, lang string, assets ViteAssets) (CacheEntry, error)` | **One-shot render entry**: single page -> complete HTML (no cache/HTTP layer); the same assembly prerender / handler misses / cache backfill share. Draft previews, email rendering and debugging call it directly - semantics identical to the prerender pipeline (props normalization, empty-output and <title> checks) |

### Engine and runtime

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewEnginePool | `NewEnginePool(bundle []byte, opts PoolOptions) (*EnginePool, error)` | Pre-warms the QuickJS sandbox instance pool; any instance failing fails the whole pool (explodes at startup) |
| PoolOptions / DefaultPoolSize | `Size` / `MemoryLimit` / `RenderTimeout` / `Prelude`, zero values take defaults (min(NumCPU,4) / 512MB / 3s / DefaultPrelude) | Pool tuning |
| EnginePool.Render / Routes / Close | Renders one page (directives are collected with per-render isolation) / queries the bundle's route table / drains | The Renderer interface implementation, shared by runtime and build time |
| Handler | `Handler(deps HandlerDeps) http.Handler` | Four-layer runtime matching: embed exact → static cache GetOrLoad → poison-page blacklist/stale fallback → SPA fallback (the delegation point for product handlers; may include its own asset serving). **The HTML ETag is a composite BuildID fingerprint** `sha256(buildID+NUL+page fingerprint)` — a pure props fingerprint is invariant across builds, and after a redeploy a 304 would hold stale HTML referencing deleted assets, hence the BuildID must be composited |
| HandlerDeps | `PrerenderFS` `SPA` `Cache` `Renderer` `Routes` `BuildID` `CacheControl` `ErrorPage` `Warn` `Assets` `Lang` `Registry` `PoisonTTL` | The mounting dependency surface (panics when Cache/Renderer/BuildID is missing). SPA product-side discipline: missing assets (last segment contains a dot) must 404, never fake success with a 200 shell page |
| NewDevHandler | `NewDevHandler(deps DevHandlerDeps) (*DevHandler, error)` | Dev mode: mtime-polling rebuild of bundle sources + memory-only cache; what you refresh is what you see |
| Invalidate / Refresh (incl. Service) | `Invalidate(ctx, pattern, params)` walks the invalidation-graph closure clearing memory + disk; `Refresh` = invalidate + async re-render writing the cache | Post-release invalidation and warming; `RegisterService(s *Service)` registers the global service (later registrations override) |

### Data-plane registry

| Symbol | Signature essentials | Purpose |
|---|---|---|
| RegisterPaths / RegisterLoader / RegisterDep | `RegisterPaths(pattern, PathsFn)` / `RegisterLoader(pattern, LoaderFn)` / `RegisterDep(pagePattern, dependsOnPattern)` (convenience entries on the default registry; `NewRegistry()` for instance isolation) | The data-plane trio (§5.7): Paths enumeration, Loader data fetching, invalidation graph edges |
| Reconcile | `Reconcile(routes []RouteSpec) error` | Reconciles registered keys against the route table character by character — drift explodes at startup, not at render time |
| ReconcileEngine | `ReconcileEngine(ctx, r Renderer) error` | The reconciliation entry on the bundle route-table projection side |
| RouteSpec / Params / PagePath / Match / ExpandPath / ValidParamValue / ValidateParams | `RouteSpec{Path, PageID, Render Mode}`; :param matching/backfill/allowlist validation (prevents path traversal and cache poisoning) | Parameterized routing infrastructure |
| Mode | The two values `ModeStatic` / `ModeCSR` | The render field of the route table (in v1 the configuration surface equals the capability surface) |

### Cache

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewLayeredCache | `NewLayeredCache(cfg CacheConfig) (*LayeredCache, error)` | In-memory LRU (default 1024 pages) layered over disk; buildId versioning + singleflight against miss storms |
| CacheConfig / CacheEntry | `BuildID` (required) / `MemPages` / `TTL` / `Disk *storagex.LocalBackend`; entry = HTML + PropsSHA256 + BuiltAt + BuildID | Layered configuration and entry shape (ETag / reconciliation material) |
| LayeredCache methods | `Get` / `GetOrLoad` / `GetStale` / `Put` / `Delete` / `EvictMatching` / `Keys` / `PurgeForeign` | The cache operation surface (GetStale feeds the Handler stale fallback) |
| PropsSHA256 | `PropsSHA256(propsJSON []byte) string` | The props fingerprint |

### Directives and SEO

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewSink / Directive / HeadEntries | `NewSink() *DirectiveSink` appends with per-render isolation; `Directive{Kind, Payload, Seq}` (head/status); `HeadEntries(dirs)` parses | The directive channel (§5.5); override/dedup policy belongs to @ploykit/ui |
| Prerender | `Prerender(ctx, deps PrerenderDeps) (PrerenderManifest, error)` | Build-time pipeline: full rendering of static pages without Loaders + Warm preheating + built-in consistency assertions + render-manifest.json |
| SitemapHandler | `SitemapHandler(routes, baseURL, SitemapOptions) http.Handler` | /sitemap.xml: all static routes plus parameterized routes enumerated via Paths, generated per request |
| IndexNow | `IndexNow(ctx, deps IndexNowDeps, urls []string) error` | Publish hook that pushes URLs to search engines (DefaultIndexNowEndpoint) |
| Error sentinels | `ErrPageNotFound` `ErrPatternNotFound` `ErrPatternMismatch` `ErrMissingPaths` `ErrInvalidParam` `ErrInvalidDirective` `ErrInvalidHeadTag` `ErrInvalidCacheKey` `ErrBuildIDMismatch` `ErrPropsTooLarge` `ErrRenderTimeout` `ErrPoolClosed` `ErrEmptyRenderOutput` `ErrMissingTitle` | Judge with errors.Is; never match error text. `ErrPageNotFound` = the Loader determined the content does not exist (missing page) → 404 + SPA fallback |

## platform/events (Transactional events, ADR 0003)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| Event | `Event{Kind, WorkspaceID, Payload, IDempotencyKey}` | One business event pending delivery (at-least-once) |
| New | `New(pool, wks *workers.Workers, opts ...Option) (*Emitter, error)`; wks=nil = emit-only, no consuming | Assembles the River client and optionally attaches it to the workers registry |
| Migrate | `Migrate(ctx, pool *pgxpool.Pool) error` | **River schema bootstrap** (river_job and friends; idempotent): call once at product boot after events.New and before workers.Start; deliberately NOT part of ploykit migrations (river schema follows the river library version sequence). Skipping it makes the first transactional event fail with relation "river_job" does not exist |
| Emitter.Emit | `Emit(ctx, tx pgx.Tx, ev Event, opts ...river.InsertOpts) error` | **Enqueues inside the caller's transaction** (outbox semantics: commit guarantees delivery, rollback dies together); a returned error must roll back the entire transaction |
| Emitter.EmitAt | `EmitAt(ctx, tx pgx.Tx, ev Event, at time.Time) error` | One-shot scheduled delivery (typed sugar over river ScheduledAt): use for "do X once at time T"; recurring plans still go through the schedule domain |
| Subscribe | `Subscribe(kind string, h Handler)` | Registers subscriptions at assembly time; panics on registration after worker start / duplicate registration of the same kind; **idempotency is the subscriber's contract** |
| Handler / Option | `func(ctx, Event) error` (error → exponential backoff retry; **a failed final attempt escalates to Error-level logging** — discarded dead-letters remain visible in the logs; same-kind events may run concurrently (MaxWorkers=10), so handlers must be thread-safe); `Option func(*river.Config)` as the escape hatch | Subscription signature and River configuration customization |
| QueueEvents | The `"events"` constant | The dedicated event queue, isolated from the default queue of product-built River clients |

## platform/cronx (cron expressions)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| Next | `Next(expr, tz string, after time.Time) (time.Time, error)` | Five-field cron expression + IANA time zone; computes the next trigger time (shared by the schedule domain and product scheduling) |

## platform/workers (Background worker registry)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewWorkers | `NewWorkers(log *slog.Logger) *Workers` | Worker registry constructor |
| Workers.Add / AddFunc | `Add(w Worker)` / `AddFunc(name, run)`, chainable | Registers at assembly time; panics on registration after Start / duplicate names (registration races are strangled at startup) |
| Workers.Start / Drain / AllHealthy / AnyCrashed | `Start(ctx)` runs each worker in its own goroutine; `Drain(timeout)` waits for wind-down (gives up on timeout); `AllHealthy()` = all workers still running (a normal exit also removes the green; used by /readyz); `AnyCrashed()` = whether anyone panicked (for post-shutdown forensics) | The four lifecycle ports (AllHealthy is probe semantics, always false after Drain). Drain timeout alignment: pick `timeout` >= the events soft-stop window (`SoftStopTimeout` 30s + 15s margin = 45s default) — a shorter Drain force-kills in-flight event handlers mid-work (aiblog A2/D4) |
| Worker interface | `Name() string` + `Run(ctx) error` (blocks until ctx is cancelled) | The minimal worker contract |

## platform/logx (Structured logging)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| New | `New(Options{Level, Format, Writer, ReplaceAttr}) *slog.Logger` | Format: `""` (auto: TTY → tint, otherwise text; honors NO_COLOR/TERM=dumb) / `auto` / `tint` / `text` / `json` (lenient about case/whitespace); timestamps are uniformly UTC RFC3339Nano; ReplaceAttr is a pre-write hook shared by the three forms (the redactx redaction wiring point; composing it does not override time normalization); panics on invalid configuration |
| Component | `Component(l, name) *slog.Logger` | A sub-logger with the `component=name` attribute added |

## platform/pg (Connection pool + transactions + RLS channel)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| Connect | `Connect(ctx, dsn string, opt Options) (*DB, error)` | Retry dialing (3min startup budget) + the three-piece pool keep-alive set + a self-healing watchdog (on by default; ExitOnWedge configurable); optional ReplicaDSN |
| DB methods | `Pool` / `Ping` / `Reset` / `Close` / `Acquire` / `Begin` / `Within(ctx, fn)` (idempotent transaction) / `Tx(ctx)` (reuses the transaction in ctx) / `Read(ctx, fn)` (replica reads + circuit-breaks back to primary) | The transaction and connection operation surface |
| WrapPool | `WrapPool(pool *pgxpool.Pool) *DB` | Wraps a bare pool into a DB (for tests / external assembly) |
| WithTenant | `WithTenant(ctx, db Beginner, id Identity, fn) error` | The RLS tenant transaction channel: Begin → set_config(SET LOCAL) → fn → Commit; GUCs apply only within this transaction; nesting is rejected |
| WithService | `WithService(ctx, db, fn) error` | The explicit tenant-less escape hatch (background jobs / data repair); mutually exclusive with WithTenant, and it does not bypass RLS by itself |
| Identity / Beginner / DBTX | `{WorkspaceID, UserID uuid.UUID}` / the minimal Begin dependency / Exec+Query+QueryRow | The channel type surface (both *DB and a bare pool satisfy Beginner) |
| AsNotFound | `AsNotFound(err, msg) error` | Foreign key 23503 → a NotFound semantic error |
| IsUniqueViolation | `IsUniqueViolation(err, constraint) bool` | Unique-violation 23505 detection (errors.As semantics, wrapped errors work); when constraint is non-empty it requires an exact constraint/index name match — distinguishing same-code different-origin cases (idempotency-key conflict vs number race). **Never hand-write "23505" checks** (guarded by arch tests) |
| AsDuplicate | `AsDuplicate(err, dup) error` | 23505 → the caller's semantic error (e.g., each domain's ErrDuplicate, 409); everything else passes through — the 23505 sibling of AsNotFound |

## platform/pgmigrate (fs.FS SQL migrations)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| New | `New(pool, fsys fs.FS, subdir) *Migrator` | Migrator over any fs.FS migration source (embed.FS remains the canonical wiring; os.DirFS / fstest.MapFS work for tests, tools and external migration dirs) |
| Migrator.Up / Down / Status | `Up(ctx, limit) ([]string, error)` / `Down(ctx, limit) ([]string, error)` / `Status(ctx) ([]StatusRow, error)` | Bounded migrate / rollback / status reconciliation (serialized by advisory lock) |
| RegisterPreHook / Hook | `RegisterPreHook(version, Hook)`; `Hook func(ctx, conn *pgxpool.Conn) error` | Pre-execution hook for a given version (seeding / warm-up) |
| Up (top-level) | `Up(ctx, pool, fsys, subdir) error` | The one-line migration entry (migrate:all); `fsys` is an `fs.FS`, so an `embed.FS` passes straight through |
| StatusRow | `{Version, Applied, AppliedAt, Orphan}` | The reconciliation row; a `-- migrate:no-transaction` first-line marker opts out of transactional execution |

## platform/pgpart (Rolling monthly partition maintenance, ADR 0009 companion)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| Table | `Table{Pool, Parent, RetentionMonths}` (Parent must be the partitioned parent table created by migrations; partitions are named `<parent>_YYYY_MM`; RetentionMonths ≤0 takes the default 12) | Description of the monthly RANGE-partitioned table to maintain |
| Table.Maintain | `Maintain(ctx, now) (Round, error)` | One maintenance round: grabs the advisory lock (yields with Round.Skipped when another instance is running) → EnsureForward pre-creates → DropExpired retires |
| Table.EnsureForward / DropExpired | `EnsureForward(ctx, now) ([]string, error)` (current month + EnsureAhead=2 future months, CREATE TABLE IF NOT EXISTS) / `DropExpired(ctx, now) ([]string, error)` (DETACH+DROP expired partitions) | Partition roll-forward and retirement by retention window |
| MonthStart | `MonthStart(now) time.Time` | Start of the UTC calendar month (the partition-boundary convention) |
| Round | `Round{Skipped, Created, Dropped}` | The result of one maintenance round (for worker log observability) |

## platform/sealx (Credential sealing)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| New / Sealer | `New(key []byte) (*Sealer, error)` (32-byte AES-256-GCM); `.Encrypt` / `.Decrypt` | Raw AEAD sealing (the envelope scheme is unchanged: a single 32-byte master key supplied directly from env remains the direct path) |
| DeriveKey | `DeriveKey(base, domain string) []byte` | HMAC-SHA256 domain-separated derivation of a 32-byte key (length satisfies New/NewSecrets) — the standard helper for products that keep ONE master secret and derive per-purpose keys (credential sealing, IP-hash salt) from it |
| NewSecrets / NewSecretsFromEnv | `NewSecrets(key)` / `NewSecretsFromEnv()` (reads PLOYKIT_SEAL_KEY, base64; missing key → nil,nil None form) | **The mandatory path for persisting tenant credentials** (AGENTS.md hard constraint) |
| Secrets.Seal / Unseal | `Seal(plain)` adds the `sealed:v1:` prefix (no key → ErrNoKey rejects new ciphertext writes); `Unseal(stored)` on a plaintext row → ErrPlaintext (plaintext-row reads have been removed; reconfiguring credentials is the only way forward) | The persist / read pair for ciphertext strings |
| SealedPrefix / EnvKey / ErrNoKey / ErrPlaintext | `"sealed:v1:"` / `"PLOYKIT_SEAL_KEY"` / sentinel for an unset key / sentinel for plaintext rows | Contract constants |

## platform/ids (UUID)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewV7 / NewV4 | `uuid.UUID` (Must semantics, panics on failure) | Time-ordered / random UUID shortcuts (RequestID and the rest of the framework share this source) |

## platform/metrics (Process metrics)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| New | `New(opts ...Option) *Registry` | The OTel collection surface + a private prometheus registry (never touches globals); dual-track counters/gauges (atomic mirrors support synchronous Snapshot) |
| Registry methods | `Counter` / `Incr` / `Add` / `IncrAttrs` / `Observe` / `ObserveAttrs` / `Gauge` / `Snapshot` / `Handler` / `HandlerWithToken` / `InstallGlobal` | The instrumentation surface (satisfies the Metrics interface declared by wsx) and the /metrics egress |
| WithHistogramBuckets | The `WithHistogramBuckets(name, buckets)` Option | Histogram bucket customization |
| NewMount | `NewMount(Config{Enabled *bool, Path, Token}, opts ...) *Mount` | The mountable assembly surface: Enabled=false is a zero-overhead no-op (env-gated silent degradation); a failed Token gate answers 404 |
| Mount methods | `.Handler()` / `.Path()` / `.Registry()` / `.Middleware(next)` (request latency/counters with controlled route-label cardinality) | The four mounting ports; `WithRegistry(r)` reuses an existing Registry |
| DefaultDurationBuckets | Second-scale default buckets | Defaults for request-latency histograms |

## platform/relayx (WS cross-instance relay)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewRelay | `NewRelay(self string, tp Transport, log) *Relay` | Relay constructor (self is used for origin filtering and loop suppression; an empty self auto-generates a uuid v7 and logs a warning, preventing two empty-origin instances from dropping each other's frames) |
| Relay.PublishOut / Run | `PublishOut(ctx, scope, frame)` publishes wrapped in an Envelope; `Run(ctx, deliver)` subscribes and consumes (delivers only messages not originating from this instance) | The implementation side of wsx.Hub.Relay |
| Transport / Envelope | The `Publish + Subscribe` interfaces; `Envelope{Origin, Scope, Frame}` (the v1 wire format) | The transport abstraction and envelope |
| NewRedisTransport / Channel | `NewRedisTransport(cli redis.UniversalClient) Transport`; Channel = `"ploykit:relay:v1"` | Production cross-instance transport (re-subscribes with unlimited backoff on disconnect + a Warn log each attempt; exits only on ctx cancellation) |
| NewMemoryTransport | `NewMemoryTransport() *MemoryTransport` | Single-instance / testing transport |

## platform/redisx (Redis client and rate limiting)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| New | `New(ctx, url) (redis.UniversalClient, bool)` | Missing URL / failed Ping → (nil, false) silent degradation (the env-missing form of the wiring discipline) |
| ParseUniversalOptions | `ParseUniversalOptions(raw) (*redis.UniversalOptions, error)` | Parses redis:// and sentinel-style URLs (for rediss+cluster/sentinel, an empty TLS ServerName is derived per node) |
| NewGCRALimiter | `NewGCRALimiter(cli) *GCRALimiter`; `.Allow(ctx, key, perMinute)` | The GCRA rate limiter, **implements webx.Limiter**, feeds RateLimit directly |

## platform/storagex (Object storage)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| Store interface | `Put / Open / Delete / DeleteMulti / URL / Presign` | The backend-agnostic storage contract |
| Object | `{Key, ContentType, Size, SHA256}` | Object metadata |
| NewLocal | `NewLocal(root) (*LocalBackend, error)` | Local disk backend (URL = /uploads/<key>, Presign passthrough) |
| NewS3 | `NewS3(ctx, S3Options) (*S3Backend, error)` | S3-compatible backend (with Presign) |
| ValidKey | `ValidKey(key) bool` | Key allowlist (no `..`, backslashes, colons, leading/trailing slashes, or >512) — the shared line of defense across backends |

## platform/redactx (Log redaction)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| String | `String(s) string` | 16 classes of credential regexes (AWS/GitHub/OpenAI/Stripe/JWT/connection strings…) → `[REDACTED:kind]` |
| Any | `Any(v any) any` | Deep recursion (≤32 levels) redaction over map/slice/any; run once before logs are written |
| Sanitize / SanitizeDeep | `Sanitize(s)` / `SanitizeDeep(v)` | Strips NUL and invalid UTF-8 sequences (cleans characters Postgres rejects) |

## platform/egressx (Outbound SSRF protection)

| Symbol | Signature essentials | Purpose |
|---|---|---|
| NewGuard / DefaultGuard | `NewGuard(extraAllowCIDRs []string) (*Guard, error)` / `DefaultGuard()` | Built-in denial of private/loopback/link-local ranges (15 ranges each for IPv4/IPv6 plus the NAT64 local range; see BlockedCIDRs for the full set); AllowCIDRs explicitly allows ranges back in |
| Guard.ValidateURL | `ValidateURL(ctx, raw) error` | Outbound URL pre-check (resolves the domain and then checks each IP, guarding against DNS rebinding; any http/https parse failure is fail-closed) |
| NewHTTPClient | `NewHTTPClient(Opts{Timeout, AllowCIDRs, DisableEnvProxy, Resolver}) (*http.Client, error)` | Controlled outbound client: the Control hook (dial layer) + RoundTrip (every hop; redirects are re-checked hop by hop) for two-layer SSRF defense; Timeout defaults to 30s; DisableEnvProxy turns off HTTP(S)_PROXY environment proxies (honored by default; security-sensitive deployments should disable it explicitly) |
| GuardOf | `GuardOf(c *http.Client) *Guard` | Retrieves the guard from a client (reusing validation for webhook delivery retries and the like) |
| BlockedCIDRs / PrivateAllowCIDRs | `BlockedCIDRs() []string` / `PrivateAllowCIDRs() []string` (both return copies) | The full set of built-in denied ranges and its mirrored allow list — the assembly inputs (NewGuard's extraAllowCIDRs) for local-dev private-network escape hatches (WEBHOOK_ALLOW_PRIVATE_TARGET and friends); consumed by webhooks/oidcfed, which no longer keep manually-synced copies |

---

Semantics quick reference: platform packages always follow the one-way "product → framework" dependency (platform/* has zero business dependencies, enforced by arch tests); external-service capabilities (redisx/metrics/relayx/sealx…) follow "silent degradation when env is missing". If this table has no entry before you write code and platform truly lacks the capability, grow the capability on the framework side first (wiring it into example in the same batch), then consume it from the product side — never hand-write an equivalent in example.
