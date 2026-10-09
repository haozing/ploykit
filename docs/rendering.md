# ploykit Rendering Layer Design (SSG Prerendering / Runtime Regeneration / SEO / Hydration)

> Basis: the platform-component principles in `docs/architecture.md`, the dependency principles in `docs/component-selection.md`, and the wiring in `example/` (route table `web/src/routes.tsx`, the two entries, `cmd/render` prerender, `cmd/app` serving). This document states current behavior; deferred work carries its trigger condition and is registered in `docs/ROADMAP.md`.

---

## 1. Goals and Non-Goals

### Goals

| # | Goal | Acceptance criterion |
|---|---|---|
| G1 | Product developers mark pages `render: 'static'` in a single route table; everything else is invisible to them | The example blog page carries zero renderx awareness (only the route-table line + `useSEO`) |
| G2 | `static` pages return **complete HTML** (including SEO metadata) to crawlers/users; zero render cost on cache hits | `curl /blog/hello-renderx` returns HTML containing `<title>` |
| G3 | **Published content goes live with zero builds**: publish an article in the admin → invalidate the cache → next request renders on the spot; no recompile/restart/Node | Refreshing the page within 1s after publishing shows the new content |
| G4 | Prerendered artifacts and build-time pages are `go:embed`ded into the single binary; the deployment model is unchanged | `make build` (example/) still produces one app.exe |
| G5 | Render defects (touching `window`, missing data, engine errors) **explode at build time or first render**, never silently serving empty pages to crawlers | Build failure = release failure; runtime render failures have degradation and alerting |
| G6 | Zero Node dependency in the production process: the rendering engine is embedded (wazero+QuickJS, no CGo) | `CGO_ENABLED=0 go build` unchanged |
| G7 | The underlying layer delivers a general "render directive channel"; SEO is just its first consumer | `useCanonical()`-style head-level additions grow in `@ploykit/ui` with no framework/pipeline changes; response-level extensions stay reserved on the channel |
| G8 | Full SEO companions: sitemap.xml + optional IndexNow push | `/sitemap.xml` lists all static pages; new URLs can be pushed after publishing |

### Non-goals (explicitly out of scope)

| # | Non-goal | Rationale |
|---|---|---|
| N1 | Per-request real-time SSR (personalized/real-time pages) | QuickJS has no JIT (30–120ms per page); per-request rendering would need pooling + SWR; not in the config surface (only `'static'`/`'csr'`) — re-evaluate only on a real product need |
| N2 | Streaming SSR (`renderToReadableStream`) | QuickJS has no Web Streams; only synchronous `renderToString` is used; static pages must not use unprefetched lazy/Suspense (the shim layer errors explicitly) |
| N3 | Render-time `fetch` (data fetching inside the sandbox) | All data goes through Go Loaders (§5.7); rendering is a pure function of (component, props) → HTML, replayable and verifiable |
| N4 | CSS-in-JS style collection for SSR | Limited to static CSS (the current Tailwind state); the directive channel reserves an extension slot |
| N5 | Replacing Vite | The client build chain (HMR, Tailwind 4) stays on Vite; esbuild only handles the SSR bundle |

---

## 2. Page Typing: Two Kinds of static, Two Paths

Mechanical criterion: **presence of a Loader**.

| Type | Criterion | Examples | Render timing | Storage |
|---|---|---|---|---|
| No Loader | props are always `{}` | / (the example's marketing landing page) | Prerendered at build time, **written into embed** | Read-only embed FS |
| With Loader | props come from a Go Loader | /blog/:slug | Build-time warm-up (optional) + **on-demand runtime rendering** | Runtime cache (memory → disk; a Redis shared tier is not implemented — see §5.8) |

Both types share one render pipeline (same bundle, same directive channel); only data fetching and the cache layer differ. The Handler makes no external distinction — both are "serve from cache when present, render on the spot when not". (If the pricing page needed plan data from billing, it would have a Loader and land in the runtime layer — typing is decided by the mechanical criterion, not semantic guesswork.)

---

## 3. Overall Architecture: Three Layers of Responsibility

```
┌─────────────────────────────────────────────────────────────────────┐
│ User layer (product, example/)                                      │
│   web/src/routes.tsx        route table source of truth:            │
│                             path + component + render mode          │
│   web/src/entry-client.tsx  handwritten once: SPA mount +           │
│                             static-page hydration                   │
│   web/src/entry-server.tsx  handwritten once: StaticRouter          │
│                             + renderToString                        │
│   web/src/pages/*.tsx       plain React components                  │
│                             (no framework awareness)                │
│   cmd/app renderx wiring    Loader/Paths registration +             │
│                             Handler mount (example/cmd/app)         │
├─────────────────────────────────────────────────────────────────────┤
│ Middle layer (npm, replaceable)                                     │
│   @ploykit/ui               useSEO — pure policy                    │
│   (merge/dedupe/og-prefix semantics all live at this layer;         │
│    the framework does not prescribe them)                           │
├─────────────────────────────────────────────────────────────────────┤
│ Bottom layer (framework, cannot be pushed down)                     │
│   platform/renderx (Go)     build/sandbox/cache/invalidation/serve  │
│   packages/runtime (npm)    isomorphic contract of the render       │
│                             directive channel (the only JS contract)│
│     ├─ server: calls the __ploykit_host__ injected by QuickJS       │
│     └─ browser: writes to document.head after hydration             │
└─────────────────────────────────────────────────────────────────────┘
```

Dependency direction: `example → @ploykit/ui → @ploykit/runtime`; `renderx` does not import any npm layer.

---

## 4. The User-Facing Surface: What Product Developers See

### 4.1 Route table `web/src/routes.tsx` (the only configuration point)

```tsx
// example/web/src/routes.tsx (excerpt; the landing-page component lives in the same file)
import { routeTable } from '@ploykit/runtime/routes'
import { BlogPost } from './pages/BlogPost'
import { Dashboard } from './pages/Dashboard'

export default routeTable({
  '/':            { component: Landing,   render: 'static' },  // no Loader → prerendered into embed
  '/blog/:slug':  { component: BlogPost,  render: 'static' },  // Loader → runtime cache rendering
  '/app':         { component: Dashboard },                    // defaults to csr; render may be omitted
})
```

- This is a plain TS module imported **simultaneously** by entry-client and entry-server — one source of truth, no generated artifacts, no separate config file, no evaluation pipeline.
- At build time and runtime, Go asks the sandbox for `__ploykit_routes__()` to get the JSON projection of the route table (§5.2).
- `render: 'static'` + a parameterized path ⇒ must be paired with a Go-side `Paths` enumerator (§5.7); missing it fails startup reconciliation and the prerender build, with sample code attached to the error.
- Config surface = capability surface: exactly `'static' | 'csr'`.

### 4.2 Page components: indistinguishable from plain React

```tsx
// example/web/src/pages/BlogPost.tsx
import { useSEO } from '@ploykit/ui'

export function BlogPost({ post }: { post: BlogPostData }) {
  useSEO({ title: post.title, description: post.excerpt })
  return <article>...</article>
}
```

### 4.3 Two write-once entries (handwritten; the framework provides the factories)

```tsx
// web/src/entry-server.tsx — the SSR bundle's entry
import { renderToString } from 'react-dom/server.browser'
import { StaticRouter } from 'react-router'            // v7 exports it from the main entry
import { createSsrEntry } from '@ploykit/runtime/server'
import routes from './routes'

export default createSsrEntry({
  routes,
  render: (el) => renderToString(el),
  wrap: (children, loc) => <StaticRouter location={loc}>{children}</StaticRouter>,
})
```

```tsx
// web/src/entry-client.tsx — the Vite client entry (replaced the former main.tsx)
import { StrictMode } from 'react'
import { BrowserRouter } from 'react-router'
import { createClientEntry } from '@ploykit/runtime/hydrate'
import routes, { AppProviders } from './routes'

createClientEntry({
  routes,
  mount: (children) => (
    <StrictMode><BrowserRouter><AppProviders>{children}</AppProviders></BrowserRouter></StrictMode>
  ),
})
// Behavior: a page carrying __PLOYKIT_PROPS__ → hydrateRoot hydrates the same tree (static pages)
//           otherwise → createRoot mounts the SPA (csr pages)
```

**Key: the server-side StaticRouter and the client-side BrowserRouter wrap the same Routes tree** (both from routes.tsx). Static pages are therefore first-class citizens of the route tree — `<Link>` in the layout and navigation between static and csr pages all work.
**Wiring note (current)**: the two ends do not wrap identically layer by layer — the server takes the minimal surface (bare StaticRouter), and the client mounts the full Provider chain (StrictMode / PloykitProvider / ErrorBoundary) only at hydration. Reason: the fork engine's recursion-depth-limit defect (R13) makes full-Provider-chain SSR deterministically trigger a wasm out-of-bounds trap; meanwhile static pages, per the §5.7 data-surface rules, are purely props-driven and consume no Provider context, so both ends render identical output. Once the fork is fixed, both ends can wrap identically again.

### 4.4 Data sources: Go Loaders + publish invalidation (product wiring)

```go
renderx.RegisterPaths("/blog/:slug", func(ctx context.Context) ([]renderx.PagePath, error) {
    return blog.AllSlugs(ctx, pool)
})
renderx.RegisterLoader("/blog/:slug", func(ctx context.Context, p renderx.Params) (any, error) {
    return blog.BySlug(ctx, pool, p["slug"])
})
renderx.RegisterDep("/", "/blog/:slug")   // the home page depends on article data → publishing invalidates the home page too (invalidation graph, §5.8; argument order = dependent first)

// In the post-transaction hook of article publishing (product code):
renderx.Invalidate(ctx, "/blog/:slug", renderx.Params{"slug": slug})   // invalidate; next request re-renders
renderx.Refresh(ctx, "/blog/:slug", renderx.Params{"slug": slug})      // or invalidate, then re-render the affected pages asynchronously (write-through; first visit already warm)
```

Loaders are Go functions: data lives on the Go side (pool/domain services); build time and runtime share the same data-fetching code and connect straight to the database with no API layer — this is ploykit's differentiation from Node meta-frameworks.

(The example wires registration + Handler mount; it does not call `Invalidate`/`Refresh` from a publish hook yet — until a hook exists, runtime-cached pages age out via TTL and buildId versioning.)

### 4.5 Handler mounting and the build chain

```go
cache, _ := renderx.NewLayeredCache(renderx.CacheConfig{
    BuildID: buildID,            // renderx.ViteBuildID(vite manifest)
    Disk:    disk,               // storagex.NewLocal(cacheDir)
})
mux.Handle("/", renderx.Handler(renderx.HandlerDeps{
    PrerenderFS: prerenderFS,    // go:embed'd build-time artifacts (code-determined pages)
    SPA:         spaHandler,     // existing Vite artifacts (also the 404/SPA fallback)
    Cache:       cache,          // §5.8 layered cache
    Renderer:    eng,            // §5.4 engine pool (in-process)
    Routes:      routes,         // route projection from __ploykit_routes__()
    BuildID:     buildID,
    Assets:      assets,         // renderx.ParseViteManifest(...) — hydration CSS/JS
    Lang:        "zh-CN",
}))
```

```makefile
build:
	cd web && npx vite build                 # client (SPA + hydration entry), with build.manifest enabled
	go run ./cmd/render prerender            # prerender: code-determined pages into dist/prerender/, data-determined pages optionally warmed
	rm -rf cmd/app/frontend && cp -r web/dist cmd/app/frontend && touch cmd/app/frontend/.placeholder
	CGO_ENABLED=0 go build -o app.exe ./cmd/app
```

---

## 5. Core-Layer Design: `platform/renderx`

### 5.1 Package layout

```
platform/renderx/
├── renderx.go       Public types: RouteSpec / PagePath / Directive / Mode / error sentinels
├── routes.go        §5.2 Routes() route inquiry + Reconcile / ReconcileEngine reconciliation (incl. projection field validation)
├── build.go         §5.3 BuildSSRBundle (esbuild Go API; the §5.3 parameter table implemented line by line) + DefaultSSRAliases
├── vite.go          §5.3 ParseViteManifest / ViteBuildID / ViteAssets (manifest parsing, hydration assets, build ID)
├── engine.go        §5.4 Renderer interface + EnginePool (per-instance owner goroutine, prelude, SetMemoryLimit, watchdog, host functions → per-render Sink)
├── internal/qjs     vendor/fork of Gaurav-Gosain/quickjs (MIT, with 3 patches: ForceClose / JSValue slot recycling fixing an upstream leak / EvalToString lifting the 64KB truncation)
├── directive.go     §5.5 directive collection: per-render DirectiveSink (4096 entries / 1MB cap; overflow flags truncation and the host fn throws)
├── template.go      §5.6 HTML document composition + injection slots + escaping (the props script carries data-page-id; regression lock in place)
├── loader.go        §5.7 registry: RegisterPaths/RegisterLoader/RegisterDep + :param matcher + Reconcile + AffectedPatterns invalidation graph
├── cache.go         §5.8 layered cache: memory LRU → disk storagex + buildId versioning + TTL + singleflight + GetOrLoad/GetStale/EvictMatching/PurgeForeign
├── prerender.go     §5.8 build-time pipeline: A1–A4 assertions + render-manifest.json + timeout fail-fast + the renderPage single-page pipeline (shared with the handler)
├── handler.go       §5.8 runtime serving: embed → poisoned-page blacklist gate → cache/single-flight render → stale degrade → SPA fallback; ETag/304
├── invalidate.go    G3: invalidation-graph eviction (memory+disk) + Refresh (invalidate, then async re-render on a 30s budget)
├── seo.go           §5.8 SitemapHandler + IndexNow push
├── dev.go           §5.9 NewDevHandler: mtime fingerprint polling → rebuild bundle/engine → atomically swap Renderer → clear memory cache
└── *_test.go        golden/XSS/matching/reconciliation/invalidation graph/LRU/TTL/singleflight/buildId/watchdog/blacklist/serving order
```

### 5.2 The route source of truth talks to Go

routes.tsx is bundled into the SSR bundle; the framework registers global functions inside the bundle:

```
__ploykit_routes__() → '[{"path":"/blog/:slug","pageId":"blog-post","render":"static"}, ...]'
__ploykit_render__(pageId, location, propsJson) → '{"html":"...","directives":[...]}'
```

At startup (and at build time) Go loads the bundle and calls `__ploykit_routes__()` once to obtain the route table — **no separate config file, no evaluation pipeline, no generated artifacts**. `pageId` is mechanically derived by `routeTable()`: the component name kebab-cased (`BlogPost`→`blog-post`); anonymous components fall back to the path's static segments; name collisions are deduplicated with a `-2` suffix in declaration order.

### 5.3 Dual bundles: Vite owns the client, esbuild owns SSR

**Client (Vite, chain unchanged)**: `index.html` points to `entry-client.tsx` (SPA + hydration behavior); `build.manifest` is enabled — template injection needs the hashed chunk/CSS filenames from it.

**SSR (esbuild Go API, parameters hard-wired so they cannot be misconfigured)**:

| Parameter | Value | Rationale |
|---|---|---|
| entryPoints | `web/src/entry-server.tsx` | Handwritten entry, no generated artifacts |
| platform / format | `neutral` / `iife` | A single file goes into the sandbox, no module loader (a security side benefit) |
| mainFields | `["module","main"]` | PoC proof: the neutral platform doesn't enable mainFields by default, and the react-dom dependency chain failed to resolve |
| define | `process.env.NODE_ENV="production"` | React production branch |
| external | none, bundle everything | react/react-dom resolve from the product's `web/node_modules`, **same version and same source as the client** — the first guarantee of hydration consistency |
| alias | `renderx.DefaultSSRAliases` mirrors the product vite.config's resolve.alias (e.g. `@ploykit/ui → packages/ui/src`) | ui/client/runtime are source aliases, not npm installs; without mirroring, the SSR build fails to resolve |
| loader(.css) | empty | Shared components currently have zero CSS imports; this is a defensive slot: if CSS is ever imported it is skipped — CSS belongs only to the Vite client |
| **react pinned to a single instance** | product vite `resolve.dedupe` + esbuild alias pin react/react-dom/react-router/react-router-dom to web/node_modules | The three physically isolated node_modules (web/ui/runtime) would bundle 2+ react instances → SSR blows up with `useState of null`; the esbuild alias is prefix replacement, so subpaths like `react-router/dom` need exact keys pointing at real files (see example/cmd/render) |

### 5.4 QuickJS sandbox (engine.go)

Selection (finalized by PoC measurements): **`github.com/Gaurav-Gosain/quickjs`** (a wazero port of the buke API: QuickJS-NG→WASM→wazero, MIT, zero CGo), **vendored/forked as the renderx core** (`platform/renderx/internal/qjs`), with the execution timeout added inside the fork. Background: buke/quickjs-go itself proved to be a CGo static library in every published version (violates G6; kept only as the native escape-hatch reference — fastest render at 0.5ms, but 40% slower at eval); Hako has no Go bindings (zero .go files); fastschema/qjs, though also on the wazero path and faster to start (2ms), has an **unguarded cumulative memory cap** (configured 12MB, actually 1GB+), an **ineffective timeout API**, and exposes a libc sandbox surface (`os`/`std`/`setTimeout`; `os.sleep` empirically hangs the host) — eliminated for failing both resource fencing and security.

PoC measurements (i7-12700KF, 700KB bundle, median/p95): startup 7.0/9.3ms (after the wazero global compile cache); eval 53.3/55.3ms; single-page render 1.0/1.5ms; `SetMemoryLimit` effective (memory bomb intercepted). Benchmark fixtures archived under `platform/renderx/testdata/`.

| Item | Design |
|---|---|
| Engine topology | **Engine instance pool**: N independent runtime instances (default `min(NumCPU, 4)`), each bound to its own owner goroutine, each evaluating the SSR bundle once; the wasm global compile cache gets the 2nd+ instance started in ~7ms |
| Isolation granularity | **Per render, reuse the evaluated context + a fresh DirectiveSink per render** (a fresh context per render would require re-evaluating the bundle — an unacceptable cost; directive isolation is handled by the Sink, and concurrency tests verified no cross-page bleed) |
| Memory cap | `SetMemoryLimit` per instance (default 512MB) — measured effective |
| Execution timeout | **Two tiers**: current fallback = Go watchdog (timeout returns ErrRenderTimeout + the instance is ForceClosed and asynchronously replaced); terminal fix = a C-side interrupt handler added in the fork (pending, needs the WASI SDK; see R12). **Measured semantics**: allocation-style runaway (the real-world mainstream form) fully recovers — killed → asynchronously rebuilt → the corpse exits on its own via the memory-cap OOM; **pure-compute infinite loops (zero wasm memory operations) cannot be preempted** — the corpse never returns and can hang the process at GC (see R12). Render timeout defaults to 3s (`PoolOptions.RenderTimeout`); the prerender cmd runs its pool at 10s |
| Concurrency | Pool checkout + singleflight; a wedged instance is reclaimed by the watchdog without blocking the pool (golang.org/x/sync is already a direct dependency) |

**Shim prelude (finalized by the PoC ablation experiment)**:

| Global | Implementation | Conclusion |
|---|---|---|
| `TextEncoder` / `TextDecoder` | minimal UTF-8 encode/decode implementations | **Required** (accessed by react-dom during eval) |
| `URL` | minimal implementation (the subset used by the react-router/react-dom dependency chain) | **Required** (the second ReferenceError) |
| `MessageChannel` | minimal empty implementation | **Required** (ablation: removing it fails) |
| `process` | empty object (NODE_ENV already eliminated by define) | never touched; kept defensively |
| `setTimeout`/`setInterval`/`setImmediate` | registering one throws "page depends on async scheduling" | makes the N2 restriction explicit |
| `clearTimeout`/`clearInterval`/`clearImmediate` | no-ops | cleanup calls inside effects must not fail SSR |
| `fetch/XHR/window/document` | **not injected** | access raises ReferenceError (G5) |

### 5.5 Render directive channel (`@ploykit/runtime`, the framework's only contract sunk into JS)

There is exactly one host function: the Go side registers `__ploykit_go_directive__` (the JS layer additionally has a `__ploykit_host__` forwarding shim — see the collector in `packages/runtime/src/server.ts`); every call is appended by the Go-side DirectiveSink as `{kind, payload, seq}` (capped at 4096 entries / 1MB per render; overflow marks the sink truncated and the host fn throws — a render-failure signal, G5).

```
packages/runtime/   (react/react-dom/react-router are peerDeps, consumed via source alias, zero bundled dependencies)
├── package.json     # exports: "." "./server" "./browser" "./hydrate" "./routes" "./types" (development condition → src)
├── src/types.ts     # Directive / HeadEntry / StatusPayload — the only public contract, semver-managed; includes the __ploykit_* global declarations
├── src/server.ts    # createSsrEntry (§4.3): mounts both globals + a per-render isolated directive collector (restores on exit and forwards the pre-injected host)
├── src/browser.ts   # emitDirective → document.head (title overwrite; meta upsert by name/property); in server mode goes through the host fn (isomorphism decided by typeof window)
├── src/hydrate.ts   # createClientEntry: __PLOYKIT_PROPS__ + data-page-id → hydrateRoot hydrates the same tree, otherwise createRoot; serializeProps (<→\u003c)
├── src/routes.ts    # routeTable(): component-name kebab pageId; routes() assembles the Routes tree (react-router peerDep)
└── src/index.ts     # re-exports only the react-free public surface (emitDirective + contract types); component entries live on subpaths to prevent duplicate react instances
```

- **Isomorphic API, per-environment implementations**: the esbuild alias sends `/server` into the SSR bundle; Vite takes `/browser` — the upper layer (useSEO) is one piece of code that is correct on both ends.
- **Ordered append, no merge semantics**: overwrite/dedupe/prefix expansion are all middle-layer policy (§6).
- Directive set: `head` (the template injects the entries) and `status` (typed on the channel; the browser side ignores it, and the server render neither acts on it nor logs it today — reserved for per-request SSR, N1).

### 5.6 Template and injection slots (template.go)

```html
<!doctype html>
<html lang="{{LANG}}">
<head>
  <meta charset="utf-8">
  {{HEAD}}            <!-- directive entries, each one escaped -->
  {{CSS_LINKS}}       <!-- CSS for the hydration chunks from the vite manifest -->
</head>
<body>
  <div id="root">{{BODY_HTML}}</div>
  <script type="application/json" id="__PLOYKIT_PROPS__" data-page-id="…">{{PROPS_JSON}}</script>
  {{HYDRATE_SCRIPT}}
</body>
</html>
```

`RenderDocument` composes these slots directly (the sketch shows structure, not a string template). Escaping obligations (cannot be pushed down): attrs/children fully HTML-escaped (eliminating attribute-escape XSS); `<`→`\u003c` applied to PROPS_JSON before writing (prevents a `</script>` escape), with the hydrate side doing `JSON.parse(textContent)`; BODY is the verbatim renderToString output and is not escaped a second time. Head entries additionally pass a tag/attr-name fence (§9).

### 5.7 Data surface (loader.go)

```go
type PagePath struct{ Params map[string]string }
renderx.RegisterPaths(pattern string, fn PathsFn)    // for build-time enumeration (fn: func(ctx) ([]PagePath, error))
renderx.RegisterLoader(pattern string, fn LoaderFn)  // shared by build-time warm-up and runtime rendering (fn: func(ctx, Params) (any, error))
renderx.RegisterDep(pagePattern, dependsOnPattern)   // invalidation-graph edge: pagePattern's rendering used dependsOnPattern's data (dependent first)
// The above plus Match / AffectedPatterns / Reconcile / ValidParamValue live in platform/renderx/loader.go
```

- **Pattern strings are specified solely by what routes.tsx declares** (`:param` style): Go registration keys must equal the route-table projection character for character; startup reconciliation fails startup on mismatch — drift between the two declarations explodes at startup, not at render time. The matcher is an internal ~30-line renderx implementation and **does not promise** ServeMux's `{param}` syntax.
- Startup reconciliation with `__ploykit_routes__()`: a static+parameterized path missing `Paths` fails startup/build (G5).
- props cap of 512KB/page (`renderx.MaxPropsBytes`): **exceeding it fails outright** (props go into HTML verbatim; losing control of that is a bug).
- props↔component type alignment is currently by convention: the Go Loader returns untyped JSON and the TS page declares its prop type; a shape mismatch surfaces as a render-time exception caught by G5. A `DefineLoader<T>`-style typed helper is a candidate addition — **not implemented**.

**Static-page data-surface rules (targeting framework pages that self-fetch)** — background: `PloykitProvider` embeds react-query, and @ploykit/ui framework pages (BillingPage etc.) generally self-fetch via useApi/useQuery:

- A static page's **SEO first-screen content must come from props (injected by the Loader)**. `useQuery`/`useApi`-style hooks are for enhancement only (fetch after mount) — during server rendering they are in their initial state; if the first screen depended on them, crawlers would get the skeleton screen and SEO would fail.
- **Gated data** that must reach the SEO first screen (e.g. a pricing page showing/hiding by payment channel, `/config`-style) must be fetched server-side via a Loader, not fetched client-side and then displayed.
- The queryClient inside the Provider must be created fresh per render (the status quo is already `useState(() => createDefaultQueryClient())`, naturally satisfied); client queries after static-page hydration refresh on their own and do not compete with server props for the first screen.

### 5.8 Caching, invalidation, and serving (core: landing G2+G3)

**Layered cache (cache.go)**: `memory LRU (default 1024 pages) → disk (storagex Local)`. Key = normalized URL path; value = full HTML + propsSha256 + builtAt + **buildId**. The example wires the disk layer at `RENDERX_CACHE_DIR` (default `renderx-cache`) via `storagex.NewLocal`. A Redis shared tier is **not implemented** (memory+disk only); redisx is a real package now, so multi-instance deployments can add one without a framework prerequisite.

**buildId versioning (deployment correctness)**: runtime-cached HTML references hashed assets (`/assets/index-*.js`); after the binary is replaced the old assets no longer exist — all existing cache entries become dead links. Therefore: buildId = the hash of the client asset manifest (`ViteBuildID`), injected at build time; entries whose buildId differs from the current one count as misses, and at startup the example calls `PurgeForeign` to clear a foreign-generation disk directory wholesale. **Cache entries never survive across deployments.**
**Renderer output versioning**: buildId watches more than vite assets — `renderx.OutputVersion` (a framework-owned constant mixed into every `ViteBuildID` hash) invalidates cached HTML when a renderx release changes rendered-output-affecting behavior (shell template, prelude, directive handling, SEO injection), even if the frontend manifest is byte-identical. The constant is bumped in the same change that alters renderer output; `TestViteBuildID` pins the hash preimage so the mixing cannot be silently dropped.

**Invalidation (G3, graph semantics)**:

```
Article published in the admin → DB transaction commits → the product hook calls renderx.Invalidate(ctx, pattern, params)
  → invalidation-graph computation (pure-function core): the page itself + pages that declared a dependency on it (e.g. home/list pages)
  → delete key by key
Optional renderx.Refresh(ctx, pattern, params): invalidate, then re-render the affected pages asynchronously
  (write-through on a 30s budget; re-render failures are logged, the invalidation stands; first visits already warm)
```

Dependency declaration: `renderx.RegisterDep("/", "/blog/:slug")` declares "the home page's rendering used article data" (the product knows best which pages' data a Loader references; dependent first, data source second); the invalidation graph = self + the reverse-dependency closure (`AffectedPatterns`), covered by table-driven tests. Point invalidation is the special case of declaring no dependencies; the TTL cap (default 1h) remains as a backstop against missed declarations. The global `Invalidate`/`Refresh` functions require a prior `Handler` mount (or `RegisterService`). The example does not wire a publish hook yet (§4.4).

**Handler serving order (handler.go; GET/HEAD only — other methods go straight to the SPA fallback)**:

```
GET /blog/hello-renderx
1. embed prerender hit (pages without a Loader) → serve HTML
2. route-table static hit:
   a. poisoned-page blacklist hit (the path timed out rendering recently) → no render is triggered; serve stale-or-error (R12)
   b. cache hit → serve HTML (Cache-Control: `max-age=60, stale-while-revalidate=300`; ETag =
      composite BuildID fingerprint, see below)
   c. miss → singleflight → Loader fetches props → engine-pool render (3s timeout) → assertions A1–A3
      → write cache (with buildId) → serve HTML; a missing slug (ErrPageNotFound) → 404 with the
      SPA shell as the body (never a fake 200)
   d. render failure: a stale copy exists → serve stale + alert; none → the product's 500 page;
      a timeout additionally puts the path on the poisoned-page blacklist (persisted, 10min TTL)
3. static assets like /assets served as before (API prefix guard semantics identical to the current example frontend.go, guaranteed by ServeMux exact-pattern precedence)
4. everything else → SPA fallback (index.html); csr pages exactly as today
```

**SEO companions (seo.go, reusing the Paths registry, nearly free, G8)**: `renderx.SitemapHandler` — the route table + Paths enumeration generate `/sitemap.xml`, with an optional `Filter` callback (e.g. published-state filtering for Loader pages); `renderx.IndexNow(urls)` — optional push inside a publish hook (the last link of the SEO loop is telling search engines to come crawl). Neither is wired into the example yet.

**Build time (prerender.go)**: `Paths` enumeration → Loader → render → assertions → write `web/dist/prerender/**.html` + `render-manifest.json` (path/pageId/propsSha256/builtAt/buildId/file). Pages without a Loader must render into embed; pages with a Loader are prerendered only if their pattern is listed in `--warm=` (comma-separated route patterns, e.g. `--warm=/blog/:slug`; skip and leave to runtime when there are many articles). The output directory is wholesale deleted and rebuilt (build-artifact semantics). A render timeout fails the whole prerender run (G5).

### 5.9 Dev mode (dev.go)

`renderx.NewDevHandler` is the framework's dev-mode capability: it polls an mtime fingerprint of the SSR bundle sources (default 1s interval), rebuilds the bundle and the engine pool on change (full esbuild rebuild ≈ the §10 budget), atomically swaps the active `Renderer`, and clears the memory cache (disk entries keep their buildId semantics). Loaders connect to the real DB. **Not wired into the example yet**: today's example dev loop runs the normal build chain (`make build` in example/) and serves prerender + runtime cache from the binary (default listen addr `:8030`, env `ADDR`); SPA development stays on :5173 (vite).

---

## 6. Middle Layer: `useSEO` and `@ploykit/ui`

```ts
// packages/ui/src/hooks/useSEO.ts — ordinary business code, not framework
import { emitDirective, type HeadEntry } from '@ploykit/runtime'

export function useSEO(meta: { title?: string; description?: string; ogImage?: string }) {
  const entries: HeadEntry[] = []
  if (meta.title) entries.push({ tag: 'title', children: meta.title })
  if (meta.description) entries.push({ tag: 'meta', attrs: { name: 'description', content: meta.description } })
  if (meta.ogImage) {
    entries.push({ tag: 'meta', attrs: { property: 'og:image', content: meta.ogImage } })
    entries.push({ tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } })
  }
  emitDirective('head', entries)   // SSR→host fn; after hydration→document.head
}
```

og prefixes, twitter cards, and the layout-overrides-page merge policy — all at this layer. The framework knows nothing about "SEO". Future `useJsonLd()/useCanonical()` grow in the same pattern without touching the framework (note: JSON-LD needs a `<script>` head entry, which the §9 tag fence denies today — it would ride a deliberate allowlist exception, still no pipeline change).

---

## 7. Mode Matrix

| Mode | Build time | Runtime | First byte content |
|---|---|---|---|
| `csr` (default) | Vite SPA (status quo) | SPA fallback | empty root + JS |
| `static` (code-determined) | prerender → embed | serves files read-only | complete HTML, zero render cost |
| `static` (data-determined) | optional warm-up | cache-first; on miss render on the spot; invalidated on publish | complete HTML; one miss ~100ms |
| `ssr` (per request) | — | — | does not exist (N1; re-evaluate only on a real need — then compare a QuickJS pool vs a Node sidecar) |

---

## 8. Validation and Failure Strategy (G5)

| # | Assertion/policy | Defect intercepted | When effective |
|---|---|---|---|
| A1 | Engine eval/render raises no exception | syntax errors, missing shims, async-scheduling violations | build + runtime miss |
| A2 | html non-empty with a root element | component renders null | same |
| A3 | If a head directive was emitted, `<title>` must be present | useSEO used but title missing | same |
| A4 | propsSha256 + buildId into cache/manifest | reconciliation, ETag, cross-deployment invalidation | at cache write |
| A5 | Hydration/SSR smoke cases on packages' existing vitest+DOM infrastructure | tree mismatch between ends, props-escape regressions | packages vitest (hydration + props-escape cases in `packages/runtime/src/__tests__`, ui SSR render smoke in `packages/ui`) |
| A6 | Render failure serves stale + alert | production data anomalies hanging the render | runtime |

> **ETag semantics**: the HTTP ETag = **composite BuildID fingerprint**
> `sha256(buildID + NUL + page fingerprint)` (`handler.buildScopedETag`), applied uniformly at the serveHTML choke point (the embed layer takes
> the manifest propsSha256, the cache layer takes PropsSHA256, the stale fallback takes the entry fingerprint — all
> three fingerprints are just the data dimension). Taking only propsSha256 is wrong: props are stable across builds (props of
> no-Loader pages are always null → ETag always `sha256("null")`); after a redeploy swaps asset hashes, browsers 304 onto stale
> HTML referencing deleted assets → the page silently goes bare (confirmed by an example redeploy). Together with product-side
> SPA fallback discipline: missing assets (paths whose last segment contains a dot) must 404, and must not return the shell page with 200 text/html fake success (implemented in example `frontend.go`).

Any assertion failing at build time → the build exits non-zero (with the page path and reason).

---

## 9. Security Design

| Surface | Measure |
|---|---|
| Injection XSS | §5.6 full escaping; props via JSON script + `<` escaping; head entries pass a tag/attr-name allowlist that additionally denies `script`/`iframe`/`object`/`embed`/`frame`/`applet`/`base` tags and `http-equiv` attrs (`ErrInvalidHeadTag`) |
| Sandbox escape | the IIFE has no module loader; fetch/window/document not injected; only the `directive` host function |
| Resource exhaustion | memory cap + watchdog timeout + instance retirement and async replacement (a C-side interrupt is still pending, R12); engine instance pool + singleflight against render storms |
| Path traversal / cache poisoning | Params character allowlist `[a-zA-Z0-9-_]` (`ValidParamValue`); cache keys normalized |
| Supply chain | the SSR bundle resolves only from the product's node_modules; @ploykit/runtime is the framework's only injected JS |

---

## 10. Performance Budget (backfilled from PoC measurements)

| Item | Budget | Notes |
|---|---|---|
| Config/route inquiry | <10ms | one host call |
| SSR bundle esbuild | **22–33ms (PoC-measured)** | 700KB IIFE output |
| bundle eval | **53ms median / 55ms p95 (PoC-measured)** | once per engine instance; instances stay resident after eval |
| engine instance startup | **7ms (PoC-measured, after the wazero global compile cache)** | pool growth cost negligible |
| per-page renderToString | **1.0ms median / 1.5ms p95 (PoC-measured)** | 1/30–1/120 of the original 30–120ms budget; wasm vs native ≈2x (0.5ms) |
| runtime cache hit | ~0 (file serving) | SSG's inherent benefit |
| runtime concurrent throughput | rendering itself ~N×1000 pages/s theoretical cap | the real bottleneck is Loader data fetching (DB); N = pool instance count; bulk invalidation absorbed by Refresh |
| publish → visible | Invalidate: next request; Refresh: ~5–10ms/page (1ms render + template + cache write) | G3 |
| 1000-page build-time warm-up | **expected <30s** (1000×1ms render + 53ms eval × N instances + Loader fetching) | actual build time will be dominated by Loader/DB |

Conclusion: hits are the norm at zero cost; a one-off miss at the hundred-millisecond scale is contained by singleflight; per-request SSR (N1) is the scenario QuickJS cannot stomach — that is exactly why it is out of scope.

---

## 11. Multi-Tenancy Considerations

Static pages are globally public pages. Once the runtime cache lands, the tenant dimension is a natural extension: adding a `Tenant` field to `PagePath`/cache keys expresses "a per-workspace public home page", and invalidation hooks fire per tenant — no render-pipeline changes needed. Still explicitly out of scope: prerendering tied to login state/sessions (it contradicts cache semantics; it belongs to csr/ssr).

---

## 12. Dependency Selection (cross-checked against component-selection.md)

| Dependency | Purpose | Irreplaceability | Status |
|---|---|---|---|
| `github.com/Gaurav-Gosain/quickjs` (a wazero port of the buke API, MIT; **vendored/forked as the renderx core**) | build+runtime JS sandbox | finalized by the PoC three-candidate measurements: render 1.0ms/eval 53ms, memory cap effective, zero CGo; fastschema eliminated for its double resource-fence hole, buke all versions CGo (violates G6), Hako no Go bindings. The fork carries the timeout patch; CGo+V8 remains the escape hatch | in place (vendored) |
| `github.com/evanw/esbuild/pkg/api` | SSR bundle | esbuild's official Go library; the alternative = shell out to Node (violates G6) | in place |
| vitest + DOM (packages' existing infrastructure) | hydration / SSR smoke tests | zero new dependencies: hydration and props-escape cases live in `packages/runtime/src/__tests__`, the ui SSR render smoke in `packages/ui` | in place |

On the npm side, `@ploykit/runtime` is in-house: react/react-dom/react-router are declared as peerDeps and consumed via vite/vitest source aliases — they do not enter the bundled output.

---

## 13. Risks and Mitigations

| # | Risk | Probability/Impact | Mitigation | Status |
|---|---|---|---|---|
| R2 | @ploykit/ui components touch browser APIs at render time → hydration mismatch | medium/medium | Hard rule: browser APIs at render time always guarded by `typeof window`, **try/catch swallowing forbidden** (it silently forks behavior between ends); mechanical net = a "ui package SSR render smoke" case in packages vitest + build-time explosion (no window during renderToString). The one known offender (OnboardingChecklist's localStorage read) has been moved into an effect | policy in force |
| R3 | Tree mismatch between ends → hydration mismatch | medium/medium | same-source node_modules + StaticRouter same tree + the packages vitest hydration cases | open |
| R4 | props drifting from component types | medium/low | no typed helper yet — alignment is by convention (the Go side emits untyped JSON); any render-time exception fails the render (G5); a `DefineLoader<T>`-style helper is a candidate addition | open |
| R5 | Very large article volumes (100k+) | low/medium | no full warm-up at build; on-demand at runtime + LRU; a Redis tier (redisx ready) for horizontal scale | open |
| R7 | the vite manifest changing across major versions | low/low | consumption concentrated in one place (build.go/template.go); lock the Vite major version | open |
| R8 | Missed invalidation → crawlers get old pages | medium/medium | the invalidation graph (Depends declarations) primary + TTL cap (1h) backstop; docs give common declaration examples | open |
| R10 | The engine pool queues under high concurrency (miss storm) | low/medium | singleflight blocks same-path; cross-path queueing absorbed by pool growth (bounded by memory); watch the §10 throughput budget | open |
| R12 | **Pure-compute infinite-loop page = process-level failure** (the corpse goroutine cannot be preempted; the next GC hangs the whole process; the watchdog only guarantees the caller times out and returns) | low probability/high impact | (1) build-time fail-fast: window access / timeout exit non-zero naming the page; (2) runtime poisoned-page blacklist: `_poison.json` persistence, 10min TTL, survives restarts, cleared when `PurgeForeign` regenerates the disk directory; (3) root cure = a C-side interrupt in the fork terminal state (needs the WASI SDK) | (1)(2) in place; (3) open |
| R13 | **fork engine recursion-depth-limit defect**: deep component trees (full Provider chain) under SSR deterministically trigger a wasm `out of bounds memory access` (bisected to a depth boundary, not size; what should be a JS RangeError pierces through as a wasm trap) | avoided / root cure pending | Avoidance in place: server-side wrap minimal surface (§4.3 wiring note) — static pages are purely props-driven and consume no context, so both ends' output matches; root cure: the fork enlarges the wasm stack or converts stack overflow to RangeError (registered in `docs/ROADMAP.md`) | root cure open |

(Risk numbering is stable — gaps correspond to risks retired by design decisions recorded in §4.3/§5.4/§12.)
