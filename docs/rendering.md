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
| G7 | The underlying layer delivers a general "render directive channel"; SEO is just its first consumer | `useCanonical()`-style head-level additions grow in `@ploykit/hooks` with no framework/pipeline changes (the one exception where identity semantics live lower: `link[rel=canonical]` singleton handling in `@ploykit/runtime`, §6); response-level extensions stay reserved on the channel |
| G8 | Full SEO companions: sitemap.xml + robots.txt + build-time head audit + optional IndexNow push | `/sitemap.xml` lists all static pages (baseURL-validated, mounted only when an origin is configured); robots.txt serves in every startup state; `cmd/render` fails the build on a missing title; new URLs can be pushed after publishing (IndexNow — pending a product publish hook) |

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

### 2.1 `hydrate`: the second axis — does this HTML need JavaScript at all?

`render` says *where the HTML comes from*; `hydrate` says *whether the browser needs any JavaScript afterwards*. They are orthogonal, and the default keeps every existing route unchanged:

| `hydrate` | Default | What is injected | When to use |
|---|---|---|---|
| `load` | ✅ | props script + client entry → `hydrateRoot` | Anything with state, effects, event handlers, or client-side routing needs |
| `none` | | Nothing. The HTML is final; the page ships **zero JS** | Purely declarative pages: marketing/landing, static content whose only "interaction" is `<a href>` navigation |

```tsx
'/': { component: Product, render: 'static', hydrate: 'none' }  // 0 KB of JS
```

Rules that the pipeline enforces (they fail loudly, not silently):

- `hydrate: 'none'` on a `csr` route is a construction-time error — a CSR page that is never mounted renders nothing.
- A `hydrate: 'none'` document carries **neither** the props script nor the entry script. The props script's only consumer is the client entry, so leaving it behind would broadcast page data to every visitor for nothing and tie cache entries to props they no longer render. CSS is still emitted: styling is part of the final HTML.
- The choice is **per route, not per page tree**. Deciding "this page needs zero JS" is a claim about what the page does; if a page later grows a button with an `onClick`, it must switch back to `load` (or move that button into its own island — see §2.2).

The mechanical test used when auditing a route: open the page with JavaScript disabled. If everything the user is meant to do is still reachable, `none` is correct.

### 2.2 Client bundles: route groups, not one big entry

`hydrate: 'load'` does not mean "download the whole product". The example splits the client graph along the same lines as the product surface (§4.1's route table), and the splits are load-bearing:

- **`render: 'static'` pages must stay synchronous imports.** renderx renders them inside the QuickJS sandbox with a synchronous `renderToString`; a dynamic import resolves in a promise continuation that the sandbox never pumps. A lazy static page renders React's client-rendering placeholder (`<!--$!--><template …><!--/$-->`), which is **non-empty** — assertion A2 (empty output) does not catch it; assertion A2′ does, at build time and on runtime misses.
- **CSR areas are loaded per product surface** (`@ploykit/runtime`'s `lazyPage`): one chunk each for the app area, the settings area, the admin console, and the low-frequency public pages. Splitting per *page* instead of per *area* hurts — sidebar navigation between settings pages is the common case, so each click would pay another round trip.
- **Interactive islands inside a static page are lazy too.** The example's blog post loads its sign-in dialog + toast stack only when the reader clicks "collect". Those components only mount after a click (`signInOpen` starts `false` on both ends), so nothing appears in the SSR HTML and hydration cannot mismatch.
- **`lazyPage` names the component.** `routeTable()` derives `pageId` from the component name, and `React.lazy()` returns an anonymous object — without `displayName` every lazy page would degrade to a path-derived id with `-2` suffixes, decoupling `pageId` from component identity.
- **A shared rule must not live inside a page.** The password-strength schema started in `RegisterPage.tsx` and was imported by the settings area's change-password page — which dragged the entire registration page (form, shell, buttons) into the settings chunk. It now lives in `ui/src/lib/password-schema.ts`, so the three consumers share the rule and nothing else. This generalizes: importing a *value* from a page module imports the page.

#### The two entries may disagree about a route's shape

`render: 'static'` requires a synchronous import (§2.2's first bullet), and a synchronous import means the page's code enters that bundle. For an acquisition-funnel page — login, register — those two facts pull in opposite directions:

- **Server bundle**: must import synchronously, or the prerendered document is a Suspense placeholder (`<!--$!-->`) and the page ships empty. Verified: a lazy `render: 'static'` page prerenders to `<!--$!--><template></template><!--/$-->`.
- **Client bundle**: must *not* import synchronously, or every unrelated route pays for the page's dependencies (zod + react-hook-form ≈ 34 KB gzip for the example's pair).

This used to be framed in this document as a hard trade-off ("prerender ⇄ synchronous import ⇄ entry bundle"). It is not, because **the two entries are separate bundles** — Vite builds the client, esbuild builds the SSR bundle, and they never share a module graph at runtime. The example now expresses that:

- `routes-table.tsx` — a factory holding all ~38 route declarations **once**, taking the two auth routes as parameters (`AuthRouteSpecs`).
- `routes.tsx` — client default: `lazyPage(...)` for login/register (entry stays at the framework floor).
- `routes.server.tsx` — server default: synchronous imports with `render: 'static'` (prerender produces complete HTML).

Why a factory rather than two route tables: two tables drift, and the drift is silent — a path added to one side simply serves the SPA shell on that entry. With the factory the two shapes are a *parameter*, so 36 of the 38 routes have exactly one declaration and the divergence cannot spread.

Hydration across the split was verified end-to-end (React container present, tab switching live, zod messages on empty submit, and the low-frequency lazy auth pages still render). Measured: entry 206 KB → **173 KB** gzip while `/login` and `/register` keep their complete 11-13 KB documents; the second navigation and a hard reload still transfer ~0.

Caveat that keeps this honest: the client's lazy `login` component resolves through the router's Suspense boundary on first paint, so the page shows its prerendered HTML immediately but stays non-interactive until that chunk arrives (measured **162.5 KB gzip over 10 files** for `/login`: the entry closure plus the route's own ~11.8 KB, measured from the Vite manifest's import graph). For pages where every interaction must survive a cold cache, sync-import them on both sides and accept the entry cost.

Measured on the example (gzip, production build; "marginal" is the cost above the always-loaded entry, derived from the Vite manifest's import graph):

| Route | Initial | Marginal |
|---|---|---|
| `/`, `/pricing`, `/docs`, `/about` (prerendered, `hydrate: 'none'`) | **0 KB** | 0 |
| `/blog/:slug` (static) | 152 KB | +31 KB (only when the reader opens the sign-in island) |
| `/login` (prerendered, client-lazy) | 162 KB | +11 KB |
| `/register` (prerendered, client-lazy) | 181 KB | +29 KB |
| `/app` | 231 KB | +79 KB |
| `/admin/overview` | 275 KB | +123 KB |
| `/settings/workspace/general` | 295 KB | +143 KB |

One consequence worth stating: the blog post's sign-in island costs **+31 KB** when a reader clicks "collect" (dialog + `SignInForm` + its shared form primitives), where it used to be nearly free because `SignInForm` rode along in the entry. That is the correct direction — the reader who never clicks pays nothing, and the entry no longer carries an auth form for a content page.

The 152 KB entry is the floor: react-dom + TanStack Router + `AppProviders` (which owns the `Toaster`). Everything else — forms, zod, base-ui dialogs, the product shell, each area's pages — is behind a dynamic import. Before the split every route paid 337 KB.

Two further reductions worth recording, because both apply the same principle (a root-level provider is paid by *every* page, so nothing heavy belongs there):

- **`ConfirmProvider` lost its dialog.** The provider (context + promise queue, a few lines) stays in the entry because `useConfirm()` must resolve synchronously; the AlertDialog primitive behind it moved to `ConfirmDialogBody.tsx` and is imported on the first `confirm()` call. Measured 23.0 KB gzip for that primitive — the entry went 169 → 152 KB.
- **Content pages are free.** `/pricing`, `/docs`, `/about` join `/` as `render: 'static'` + `hydrate: 'none'`: no props script, no entry script, no JS requests at all in the browser (verified). `LandingPage` gained a `navLinks` prop for exactly this case — its links render as real `<a href>`s, because a zero-JS page has no client router to intercept `Link`.

### 2.3 Serving the bundles: caching is part of the payload budget

Splitting the graph only pays off if the browser keeps the pieces. `http.FileServer` emits **no** `Cache-Control`, `ETag` or `Last-Modified`, and the first version of this split shipped that way — measured consequence: the same 178 KB (gzip) entry chunk downloaded twice inside a single `/login` → `/register` navigation, and every subsequent click re-fetched whatever chunks that route needed. The bytes saved on first load were paid back on every navigation.

Two middlewares close it, and the choice between them matters:

- **`webx.AssetCacheManifest(next, files)` — preferred.** `files` is the build's own asset list, extracted with `renderx.ViteManifestFiles(manifest.json)` and wired once at startup (see `example/cmd/app/frontend.go`). A path is immutable **iff the build listed it**, so there is no inference and no false positive. The example uses this.
- **`webx.AssetCache(next)` — the fallback**, for a hand-assembled dist with no manifest. It infers content addressing from the filename: a ≥8-character base64url hash at the end of the stem, carrying a digit or an uppercase letter. That inference cannot be made exact. It has a **false-positive class** — `Some-Page-Banner.png`, `Hero-Image-Large.jpg`, `DOWNLOAD.png` all look exactly like hashes — and a false positive pins a file the product expects to replace *in place* for a year. Tightening the rule to reject those also rejects real Vite hashes (`CYhS-pAS`, `B-WCCgPC`, `C-pQOpeV` are valid hashes with a separator and no digit), so the two error classes cannot both be removed by tuning. This is why the manifest variant exists.

Both attach `Cache-Control: public, max-age=31536000, immutable` plus a URL-derived `ETag` and 304 handling, to 2xx responses only (a 404 on an asset path must not be cached for a year). Everything else passes through untouched:

- **HTML must revalidate.** A strongly cached document survives a deploy and pins the user to a build whose asset URLs no longer exist. `renderx` already handles this with its own ETag/304 path.
- **Unhashed files can be replaced in place** (`/favicon.png`, `/brand/logo.png`), so they get no header — that policy belongs to the product. With the manifest variant this is automatic: they are simply not in the list.

Measured after wiring: second navigation 204 KB → 15 KB (entry and all shared chunks hit cache, `transferSize === 0`), and a hard reload of an already-visited page downloads **0 KB** of JS.

Corollary for the route-table surface: because the asset names carry the build's content hash, an old build's files are never overwritten, so the cache needs no purge on deploy — the new document simply references new URLs. `renderx`'s `ViteBuildID` does the same job for server-side HTML caches.

**The trap this creates (cost a real debugging session).** `immutable` means the browser will not revalidate for a year, and the URL only changes when the *content hash* changes. Serving a bad response for a fingerprinted URL therefore pins that build in every visitor's cache with no recovery path short of a rebuild. The concrete failure: `webx.Precompressed` answers before the file server runs, so on its first version it forgot to set `Content-Type`; combined with `X-Content-Type-Options: nosniff` the browser refused to execute the module — the `<script>` was in the DOM, the request returned 200, nothing ran, and no useful console error appeared. After fixing the handler, the *same URL* kept serving the poisoned bytes from cache, which looks exactly like "the fix did not work". Debugging protocol for this class of bug:

- `fetch(url, { cache: 'no-store' })` in the page, then read `res.headers.get('content-type')`. If the response is correct with `no-store` but the page still misbehaves, the cache is the culprit, not the server.
- Verify the payload decodes to the right bytes (`brotliDecompressSync(downloaded).equals(onDisk)`), separating transport corruption from an execution problem.
- Use a fresh origin (different port) to get an uncontaminated cache while iterating.

Two rules follow: (1) any new middleware that short-circuits before the file server must set `Content-Type` itself; (2) never test asset-serving changes against a browser profile that already loaded the previous build.

**Compression.** `webx.Precompressed` serves `.br` sidecars generated at build time (`node tools/precompress.mjs <dist>`; wired into `example/Makefile`'s `build`). Build-time because Go's standard library has a brotli decoder but no encoder — runtime would mean a third-party dependency plus per-request CPU, while at build time `-q 11` is affordable. Measured on the entry chunk: gzip -9 171 KB → brotli 144 KB. Lazy route chunks are a few KB where the difference is noise, so the win concentrates on the entry bundle and CSS. Middleware order is `FileServer → AssetCache(Manifest) → Precompressed → webx.Gzip`. The gzip layer (`webx.Gzip`, the runtime compression lane — Go stdlib has a gzip encoder but no brotli one, which is why brotli is build-time) skips bodies that already carry `Content-Encoding`, parses `Accept-Encoding` for real (`gzip;q=0` refused, `x-gzip` ignored), and passes Range requests through untouched.

Form validation uses **`zod/mini`** in `@ploykit/ui` rather than full `zod`: the classic API surface is ~39 KB gzip for the same rules expressed as explicit `check()` compositions (~8 KB), and the error objects are structurally identical (`_zod.traits` carries `$ZodError`), so `zodResolver` and `useZodForm` need no changes. `useZodForm`'s schema type is deliberately structural (`{ parse(...) }`) so products may pass either flavour. The failure mode this migration introduces is a *silently dropped rule* — a `.check()` list missing one entry type-checks fine — so `ui/src/pages/__tests__/settings-schemas.test.ts` and `ui/src/pages/auth/__tests__/RegisterPageSchema.test.ts` pin every rule by its user-visible message, and `RegisterPageValidation.test.tsx` asserts the form actually stops before the network.

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
│   @ploykit/hooks            useSEO — pure policy                    │
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
import { lazyPage } from '@ploykit/runtime'
import { BlogPost } from './pages/BlogPost'
import { Landing } from './pages/Landing'

// Login-area pages live in their own module and load on demand (§2.2).
const Admin = lazyPage('AdminOverview', () =>
  import('./routes-admin').then((m) => ({ default: m.AdminOverview })))

export default routeTable({
  '/':            { component: Landing,  render: 'static', hydrate: 'none' }, // 0 KB of JS
  '/blog/:slug':  { component: BlogPost, render: 'static' },  // Loader → runtime cache; needs hydration
  '/app':         { component: Dashboard },                    // defaults to csr; render may be omitted
  '/admin/overview': { component: Admin },                     // csr, own chunk
})
```

- This is a plain TS module imported **simultaneously** by entry-client and entry-server — one source of truth, no generated artifacts, no separate config file, no evaluation pipeline.
- At build time and runtime, Go asks the sandbox for `__ploykit_routes__()` to get the JSON projection of the route table (§5.2).
- `render: 'static'` + a parameterized path ⇒ must be paired with a Go-side `Paths` enumerator (§5.7); missing it fails startup reconciliation and the prerender build, with sample code attached to the error.
- `render: 'static'` pages must be **synchronous imports**; lazy-loading one produces an empty body (§2.2).
- Config surface = capability surface: `render` is exactly `'static' | 'csr'`, and the orthogonal `hydrate` is exactly `'none' | 'load'` (see §2.1).

### 4.2 Page components: indistinguishable from plain React

```tsx
// example/web/src/pages/BlogPost.tsx
import { useSEO } from '@ploykit/hooks'

export function BlogPost({ post }: { post: BlogPostData }) {
  useSEO({ title: post.title, description: post.excerpt, canonical: `/blog/${post.slug}` })
  return <article>...</article>
}
```

### 4.3 SSR-safe component rules for STATIC pages (read before your first prerender fails)

The SSR bundle's `wrap` is a bare `StaticRouter` — deliberately (the fork-engine
R13 wasm trap, §5.3 background). That means **no PloykitProvider, no
QueryClientProvider, no router context** exist during prerender / runtime SSR.
Any hook that needs them THROWS inside a static page and fails the whole
prerender — with an error that names the hook, not the cause ("must be used
within PloykitProvider", "No QueryClient set"). Two real products have hit
this independently.

**Banned inside a static page's component tree** (static = `render: 'static'`
rows; CSR pages run in the browser and are unconstrained):

- `useAuth()` / `useWorkspace()` / `useWorkspaceCtx()` / anything from
  `@ploykit/hooks` that reads the provider context
- `useQuery` / `useMutation` / `useApi()` (QueryClient + provider)
- `useLogin` and friends — auth pages are CSR by nature

**What to do instead:**

- Data that must appear in the SEO first screen → move it into the page's Go
  Loader (props flow; §4.4). This is the intended design, not a workaround.
- Client-side enhancement (interactive widgets, post-mount personalization)
  → plain `useEffect` + `fetch`/`api` calls inside the effect, with the
  server-rendered output showing a complete prop-driven state.
- "Is the visitor logged in?" on a static page → probe `/auth/me` in an
  effect (`@ploykit/hooks` now ships `useAuthState()`, a provider-free
  variant for exactly this).

- **No `Intl`/locale-dependent formatting in SSR-rendered components**
  (`Intl.DateTimeFormat`, `toLocaleDateString`, `toLocaleString`…). The wasm
  engine's Intl data and clock differ from the browser's: the sandbox has no
  timezone database (WASI clocks are UTC) and a compact locale dataset, while
  the browser has full ICU plus the user's timezone — the same expression can
  render a different day on the client, and hydration then drifts off the SSR
  HTML. Format dates/numbers in the Go Loader (props carry the final strings)
  or with a fixed-format helper of your own.

- **Component-tree DEPTH is bounded by the logical stack budget, not an
  opaque wall.** The engine's QuickJS guard trips on deep recursion and
  raises a catchable `Maximum call stack size exceeded` — the instance stays
  healthy — with the error hint naming `PoolOptions.MaxStackSize` (default
  1MiB; capacities measured at ~3.1k simple-recursion frames, ~8k at the
  7MiB `MaxLogicalStackSize` cap). Budgets above the cap are rejected at
  construction so recursion can never reach the wasm module's physical
  shadow stack (8MiB, baked in at build time — `internal/qjs/csrc/`).
  History: this was the #15/#16 "phantom ceiling" — the pre-v0.17.0 engine
  disabled the guard under wasi, so the only wall was the binary's 64KiB
  default shadow stack and overflow surfaced as an uncatchable wasm trap
  that poisoned the instance (ADR 0015). If a static page's tree is so deep
  it trips the guard even at the cap, the tree genuinely needs flattening —
  a deep DOM nesting that renders fine in Node SSR can still exceed it.

The long-term fix — wrapping the SSR entry with the same providers as the
client — is blocked on the engine fork (R13); until then these rules ARE the
contract.

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

**The loader's return value IS the component's props object — verbatim, no wrapping.** The runtime spreads whatever the loader returned directly onto the page component (`createElement(component, loaderResult)`):

```go
// loader returns map{"post": post}  ->  component receives { post }  ->  ({ post }) => ...
return map[string]any{"post": post}, nil
```

```tsx
// matching component signature — destructure exactly the loader's keys
export function BlogPost({ post }: { post: BlogPostData }) { ... }
```

The classic mistake (a real product onboarding report): wrapping "just to be safe" —

```go
return map[string]any{"loaderData": map[string]any{"work": w}}, nil   // WRONG
```

The component then renders with an empty props object and **nothing reports an error** — the page silently renders its loading/empty shell. If a page renders but shows no data, check the loader's return shape first: every key the component destructures must be a top-level key of the loader's map.

(The example wires registration + Handler mount; it does not call `Invalidate`/`Refresh` from a publish hook yet — until a hook exists, runtime-cached pages age out via TTL and buildId versioning.)

### 4.5 Handler mounting and the build chain

```go
cache, _ := renderx.NewLayeredCache(renderx.CacheConfig{
    BuildID: buildID,            // renderx.ViteBuildID(vite manifest)
    Disk:    disk,               // storagex.NewLocal(cacheDir)
})
assets, _ := renderx.ParseViteManifest(manifestData, "")  // hydration CSS/JS
if shell, err := fs.ReadFile(frontendFS, "index.html"); err == nil {
    assets.Shell = renderx.ParseShellHead(string(shell))  // §5.6.2: inherit favicon/theme-color/modulepreload + html/body attrs
}
assets.BaseURL = baseURL                                   // §5.6.3: PUBLIC_BASE_URL origin, "" = no-op
mux.Handle("/", renderx.Handler(renderx.HandlerDeps{
    PrerenderFS: prerenderFS,    // go:embed'd build-time artifacts (code-determined pages)
    SPA:         spaHandler,     // existing Vite artifacts (also the 404/SPA fallback)
    Cache:       cache,          // §5.8 layered cache
    Renderer:    eng,            // §5.4 engine pool (in-process)
    Routes:      routes,         // route projection from __ploykit_routes__()
    BuildID:     buildID,
    Assets:      assets,         // hydration CSS/JS + Shell + BaseURL
    Lang:        "zh-CN",
    UnknownPath: renderx.UnknownPathNotFound, // recommended: see below
}))
```

**Unknown-path policy (recommended: `UnknownPathNotFound`)**: a GET to a path that matched no route, embed snapshot or runtime layer still gets the SPA shell body — human visitors keep their client-side routing — but wrapped in an honest 404 status instead of the v0.15.0 default 200 (which turns every garbage URL into an indexable soft-404 with a generic title; field report: braceletmakeronline.com, GSC exposure on shell URLs). Enumerate the product's CSR routes in the route table (or serve them ahead of renderx) before flipping the policy, and consider `ShellMeta` with `noindex` for deployments that keep the 200 shell. The prerender path needs no policy decision — it only renders routes it was asked to render.

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
├── shell.go         §5.6.2 ParseShellHead / ShellHead (Vite-shell head + html/body attrs inheritance)
├── engine.go        §5.4 Renderer interface + EnginePool (per-instance owner goroutine, prelude, SetMemoryLimit, watchdog, host functions → per-render Sink)
├── internal/qjs     Go binding vendored from Gaurav-Gosain/quickjs (MIT) + csrc/ builds the embedded wasm in-repo (quickjs-ng v0.17.0 pinned, 8MiB shadow stack; see csrc/README.md)
├── directive.go     §5.5 directive collection: per-render DirectiveSink (4096 entries / 1MB cap; overflow flags truncation and the host fn throws)
├── template.go      §5.6 HTML document composition + injection slots + escaping (the props script carries data-page-id; regression lock in place)
├── loader.go        §5.7 registry: RegisterPaths/RegisterLoader/RegisterDep + :param matcher + Reconcile + AffectedPatterns invalidation graph
├── cache.go         §5.8 layered cache: memory LRU → disk storagex + buildId versioning + TTL + singleflight + GetOrLoad/GetOrLoadHit/GetStale/EvictMatching/PurgeForeign
├── prerender.go     §5.8 build-time pipeline: A1–A4 assertions + render-manifest.json + timeout fail-fast + the renderPage single-page pipeline (shared with the handler)
├── handler.go       §5.8 runtime serving: embed → poisoned-page blacklist gate → cache/single-flight render → stale degrade → SPA fallback; ETag/304; X-Renderx-Tier response header (HeaderTier/Tier* constants — the traffic-counting contract)
├── invalidate.go    G3: invalidation-graph eviction (memory+disk) + Refresh (invalidate, then async re-render on a 30s budget)
├── seo.go           §5.8 SEO companions: SitemapHandler + RobotsHandler + IndexNow push + AuditSEO (build-time head-signal audit)
├── dev.go           §5.9 NewDevHandler: mtime fingerprint polling → rebuild bundle/engine → atomically swap Renderer → clear memory cache
└── *_test.go        golden/XSS/matching/reconciliation/invalidation graph/LRU/TTL/singleflight/buildId/watchdog/blacklist/serving order
```

### 5.2 The route source of truth talks to Go

routes.tsx is bundled into the SSR bundle; the framework registers global functions inside the bundle:

```
__ploykit_routes__() → '[{"path":"/blog/:slug","pageId":"blog-post","render":"static","hydrate":"load"}, ...]'
__ploykit_render__(pageId, location, propsJson) → '{"html":"...","directives":[...]}'
```

`hydrate` is part of the projection (`"none" | "load"`); a legacy route table that omits it is read as `"load"`, so a product and the framework can be upgraded in either order. Go validates both fields in `validateRouteSpec` (§5.2) and rejects `hydrate:"none"` on a `csr` route at startup.

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

Selection (finalized by PoC measurements): **`github.com/Gaurav-Gosain/quickjs`** (a wazero port of the buke API: QuickJS-NG→WASM→wazero, MIT, zero CGo), **vendored as the renderx core** (`platform/renderx/internal/qjs`), with the execution timeout added inside the fork and the embedded wasm **built in-repo** (`internal/qjs/csrc/`: pinned quickjs-ng v0.17.0 + patched bridge.c; ADR 0015). Background: buke/quickjs-go itself proved to be a CGo static library in every published version (violates G6; kept only as the native escape-hatch reference — fastest render at 0.5ms, but 40% slower at eval); Hako has no Go bindings (zero .go files); fastschema/qjs, though also on the wazero path and faster to start (2ms), has an **unguarded cumulative memory cap** (configured 12MB, actually 1GB+), an **ineffective timeout API**, and exposes a libc sandbox surface (`os`/`std`/`setTimeout`; `os.sleep` empirically hangs the host) — eliminated for failing both resource fencing and security.

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
├── src/browser.ts   # emitDirective → document.head (title overwrite; meta upsert by name/property; link[rel=canonical] singleton — §6); in server mode goes through the host fn (isomorphism decided by typeof window)
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
<html lang="{{LANG}}" {{HTML_ATTRS}}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"> <!-- fallback; skipped when the page (or shell) declares its own -->
  {{INHERIT_HEAD}}   <!-- shell-inherited entries (favicon, theme-color, modulepreload…); page keys win -->
  {{HEAD}}            <!-- directive entries, each one escaped -->
  {{BODY_PRELOADS}}   <!-- preload links hoisted out of the body (React 19 float) -->
  {{CSS_LINKS}}       <!-- CSS for the hydration chunks from the vite manifest -->
</head>
<body {{BODY_ATTRS}}>
  <div id="root">{{BODY_HTML}}</div>
  <script type="application/json" id="__PLOYKIT_PROPS__" data-page-id="…">{{PROPS_JSON}}</script>
  {{HYDRATE_SCRIPT}}
</body>
</html>
```

`RenderDocument` composes these slots directly (the sketch shows structure, not a string template). Escaping obligations (cannot be pushed down): attrs/children fully HTML-escaped (eliminating attribute-escape XSS); `<`→`\u003c` applied to PROPS_JSON before writing (prevents a `</script>` escape), with the hydrate side doing `JSON.parse(textContent)`; BODY is the verbatim renderToString output and is not escaped a second time. Head entries additionally pass a tag/attr-name fence (§9).

#### 5.6.1 Viewport fallback and override

RenderDocument always writes `<meta name="viewport" content="width=device-width, initial-scale=1">` right after the charset line, unless the assembled head already contains a `meta[name=viewport]` — from the page's head directives (an editor page that needs `user-scalable=no` overrides the fallback by emitting its own) or from the inherited shell head. Rationale: a missing viewport is a silent, site-wide mobile-ranking penalty (mobile browsers fall back to a 980px desktop viewport), and relying on every page to remember it is exactly the kind of default a framework should own.

#### 5.6.2 Shell head inheritance (`ParseShellHead` / `ShellHead`)

RenderDocument **rebuilds** documents rather than rewriting the Vite shell, so anything that only exists in `web/dist/index.html` would be dropped on every rendered page. The fix is inheritance, not rewriting: the product parses the shell once and attaches the result to `ViteAssets.Shell`; `RenderOnce` copies it onto every `Document` it assembles (prerender, runtime SSR, cache backfill, and direct preview calls all share this path — the attachment point travels with the assets, so there is exactly one wiring line per process).

- `renderx.ParseShellHead(shellHTML string) ShellHead` extracts the shell's `<link>`/`<meta>` head tags plus the `<html>`/`<body>` open-tag attributes. It is a pure function that never fails: a missing head, missing tags, or tags the head-entry whitelist rejects all degrade to "not inherited".
- **Exclusions** (each excluded kind has a dedicated, overridable channel): `rel=stylesheet` links (CSS goes through the manifest-derived `Document.CSS`), `meta charset` (RenderDocument writes its own), `meta name=viewport` (§5.6.1 owns it), and everything that is not link/meta (`<title>`, `<script>` — the page owns its title, scripts have their own channel). Everything else is kept, including `rel=modulepreload`, `rel=icon`, `rel=preconnect` and `meta name=theme-color`.
- **Order and dedup**: inherited entries render between the viewport fallback and the page's own head, before the stylesheets — so modulepreload hints are discovered before the render-blocking CSS (that early position is the entire point of F-4). An inherited entry whose `(tag, rel/name/property)` key collides with a page head entry is skipped: the page always wins over the shell (e.g. a page-emitted theme-color suppresses the shell's).
- `<html>` attributes lose `lang` (`Document.Lang` owns it); `<body>` attributes pass through verbatim. Both go through the same tag/attr-name fence as head entries — a malformed name fails the render loudly.
- **Wiring, both assembly paths**: prerender reads `web/dist/index.html` from disk (`cmd/render`), runtime SSR reads the embedded copy (`cmd/app`'s `fs.Sub(frontendFS, …)`). A missing shell (unbuilt checkout) logs a warning and disables inheritance — rendering itself never fails because of the shell.

#### 5.6.3 Absolute og/twitter URLs (`Document.BaseURL`)

Social scrapers (Facebook/LinkedIn/Telegram) require absolute `og:image` / `twitter:image` / `og:url` values and silently drop relative ones, so the framework absolutizes them at document assembly — the Go layer, deliberately not `useSEO` (the TS hook cannot know the deployment origin, and SPA-navigated head updates are crawler-invisible anyway; crawlers read the first HTML only).

- When `Document.BaseURL` (from `ViteAssets.BaseURL`, i.e. the `PUBLIC_BASE_URL` env in both example wiring paths) is an absolute http(s) origin, relative `og:image`, `twitter:image` and `og:url` content values are prefixed with it. Already-absolute and protocol-relative (`//…`) values are left alone.
- An empty, malformed or missing BaseURL is a complete no-op — nothing is rewritten, nothing fails. `canonical` is never touched (a relative canonical is legal) and no other meta/link is rewritten.
- `cmd/render` reads `PUBLIC_BASE_URL` itself (empty = no-op; an invalid value logs a warning and disables the rewrite).

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

> **Single-language boundary**: cache keys are `path × buildID` — there is no language dimension. `Lang` only writes the `<html lang>` attribute; two languages of the same path cannot coexist as rendered artifacts. Multi-language sites are out of scope today (a per-language cache key is on the ROADMAP; until then a product either pins one language per deployment or differentiates paths, e.g. `/en/...` vs `/ja/...`).

**Layered cache (cache.go)**: `memory LRU (default 1024 pages) → disk (storagex Local)`. Key = normalized URL path; value = full HTML + propsSha256 + builtAt + **buildId**. The example wires the disk layer at `RENDERX_CACHE_DIR` (default `renderx-cache`) via `storagex.NewLocal`. A Redis shared tier is **not implemented** (memory+disk only); redisx is a real package now, so multi-instance deployments can add one without a framework prerequisite.

> **The query string is NOT part of the cache key** — `/blog?page=2` serves `/blog`'s entry. Route matching ignores the query too, so a query can never reach the page component. Pagination and filters must be path segments (`/blog/page/:n`); a query-driven variant of a static page silently renders as its unparameterized twin (field report: the constraint is invisible until a pager sticks on page one). On-disk entry files carry a `.entry` suffix so a file key (`blog`) and the directory of its nested keys (`blog/…`) never collide in the flat filesystem; pre-suffix files are invisible and wiped by the next `PurgeForeign`.

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

**SEO companions (seo.go, reusing the Paths registry, nearly free, G8)**: `renderx.SitemapHandler` — the route table + Paths enumeration generate `/sitemap.xml`, with an optional `Filter` callback (e.g. published-state filtering for Loader pages); baseURL must be an absolute http(s) origin and a malformed value panics at construction. `renderx.RobotsHandler` — serves `/robots.txt` from a static config (Disallow prefixes + verbatim Extra lines + the Sitemap pointer); malformed options panic at wiring time (newlines, `#` in Disallow, non-absolute SitemapURL). Both handlers carry `X-Renderx-Tier: robots|sitemap` so traffic counting sees crawler fetches of them. `renderx.IndexNow(urls)` — optional push inside a publish hook (the last link of the SEO loop is telling search engines to come crawl); it is an outbound client with no response of ours, outside traffic counting; the example has no publish endpoint yet, so nothing calls it there — wire it into the product's publish hook when one exists.

**Wiring in the example**: `/robots.txt` mounts in every startup state (static config). `/sitemap.xml` mounts when `PUBLIC_BASE_URL` holds a valid absolute origin (invalid or unset ⇒ treated as unset, loudly logged) **and** the render pipeline is enabled — the route table comes from the SSR bundle, so the no-bundle degraded mode mounts no sitemap and robots.txt serves without a `Sitemap:` line (never point crawlers at an unmounted route). The sitemap includes every `static` route: the landing page and all blog posts enumerated via the Paths registry (runtime-rendered posts included). Vite dev proxies both paths so dev reflects production behavior.

**SEO observation vs. engine feedback — the framework boundary (visitor-walk)**: "telling search engines" (sitemap.xml, robots.txt, IndexNow) and "auditing your own head signals" (`renderx.AuditSEO`, fed by `cmd/render`'s prerender check: missing `<title>` fails the build, missing description/canonical warn) are framework responsibilities. "Listening to what search engines say back" — Search Console / Bing Webmaster APIs, rankings, coverage reports — is deliberately NOT a framework concern: it requires per-product verified properties and OAuth credentials, and its data is per-product, not per-render. Products wiring that do it on their own side (a scheduled job calling the Search Console API with the product's own credentials). The middle ground — anonymous traffic/bot counts — lives in `platform/metrics` (`Mount.Traffic`, see platform-api-index); it observes requests, not rankings.

**Build time (prerender.go)**: `Paths` enumeration → Loader → render → assertions → write `web/dist/prerender/**.html` + `render-manifest.json` (path/pageId/propsSha256/builtAt/buildId/file). Pages without a Loader must render into embed; pages with a Loader are prerendered only if their pattern is listed in `--warm=` (comma-separated route patterns, e.g. `--warm=/blog/:slug`; skip and leave to runtime when there are many articles). The output directory is wholesale deleted and rebuilt (build-artifact semantics). A render timeout fails the whole prerender run (G5).

### 5.9 Dev mode (dev.go)

`renderx.NewDevHandler` is the framework's dev-mode capability: it polls an mtime fingerprint of the SSR bundle sources (default 1s interval), rebuilds the bundle and the engine pool on change (full esbuild rebuild ≈ the §10 budget), atomically swaps the active `Renderer`, and clears the memory cache (disk entries keep their buildId semantics). Loaders connect to the real DB. **Not wired into the example yet**: today's example dev loop runs the normal build chain (`make build` in example/) and serves prerender + runtime cache from the binary (default listen addr `:8030`, env `ADDR`); SPA development stays on :5173 (vite).

---

## 6. Middle Layer: `useSEO` and `@ploykit/ui`

```ts
// packages/hooks/src/hooks/useSEO.ts — ordinary business code, not framework
import { emitDirective, type HeadEntry } from '@ploykit/runtime'

export function useSEO(meta: {
  title?: string; description?: string; ogImage?: string; canonical?: string;
  ogTitle?: string; ogDescription?: string; ogUrl?: string; ogType?: string; twitterSite?: string;
}) {
  const entries: HeadEntry[] = []
  if (meta.title) entries.push({ tag: 'title', children: meta.title })
  if (meta.description) entries.push({ tag: 'meta', attrs: { name: 'description', content: meta.description } })
  // OG essentials mirror what the page declares (og:title <- title,
  // og:description <- description, og:url <- canonical; og:type defaults to
  // 'website') with explicit og* fields overriding; twitter:title/description/
  // image mirror the og values, twitter:card rides ogImage, twitter:site is
  // opt-in. Field report #22: without the mirrors the OG card essentials never
  // reached social/AI scrapers and every consumer invented a side-channel hook.
  ...
  if (meta.canonical) entries.push({ tag: 'link', attrs: { rel: 'canonical', href: meta.canonical } })
  emitDirective('head', entries)   // SSR→host fn; after hydration→document.head
}
```

og prefixes, twitter cards, and the layout-overrides-page merge policy — all at this layer. URL absolutization is deliberately **not** at this layer: `og:image`/`twitter:image`/`og:url` are absolutized against the deployment origin by the Go assembly step (§5.6.3) — the hook cannot know `PUBLIC_BASE_URL`, and crawlers read only the first HTML, which the Go layer produces. The framework knows nothing about "SEO" — with one deliberate exception in the runtime's browser branch: `link[rel=canonical]` is applied as a **singleton** (SPA navigation updates the existing element's href in place instead of appending a duplicate, the same identity-keyed treatment `meta[name|property]` already gets; hydration adopts an SSR-emitted canonical rather than adding a second one). A duplicated canonical is worse than a missing one — crawlers may treat it as ambiguous — so the identity semantics live in `@ploykit/runtime`, and every `link` that is not canonical keeps plain exact-match dedup behavior (`preload` etc.). Matching trims whitespace and is case-insensitive on both sides (browser upsert and Go's `AuditSEO`). Two product-side rules complete the story: canonical is **sticky** (a page emitting none inherits the previous one — declare your own where that is wrong), and **one page, one canonical** (the SSR head path does not dedupe; duplicate emits are caught by the `cmd/render` audit via `SEOSignals.CanonicalCount`). Future `useJsonLd()` grows in the same pattern (note: JSON-LD needs a `<script>` head entry, which the §9 tag fence denies today — it would ride a deliberate allowlist exception, still no pipeline change).

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
| A2′ | No React server-suspense marker (`<!--$!-->`) in the output | a lazy import on a `render: 'static'` route's render path — `renderToString` never waits for Suspense, so the document is non-empty and A2 alone cannot see it | build (prerender) + runtime miss |
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
| `github.com/Gaurav-Gosain/quickjs` (a wazero port of the buke API, MIT; **vendored as the renderx core**, wasm built in-repo from `csrc/`) | build+runtime JS sandbox | finalized by the PoC three-candidate measurements: render 1.0ms/eval 53ms, memory cap effective, zero CGo; fastschema eliminated for its double resource-fence hole, buke all versions CGo (violates G6), Hako no Go bindings. The binding carries the timeout patch; the engine (quickjs-ng v0.17.0) is pinned and rebuilt via `csrc/` (ADR 0015); CGo+V8 remains the escape hatch | in place (vendored) |
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
| R13 | **engine recursion-depth trap** (FP walks #15/#16): deep component trees under SSR hit the wasm module's default 64KiB shadow stack; overflow pierced through as an uncatchable `out of bounds memory access` trap that poisoned the instance, and the `MaxStackSize` knob was a silent no-op (quickjs-ng disables the guard under `__wasi__` before v0.17.0) | **root cure shipped (ADR 0015)**: wasm rebuilt in-repo from pinned quickjs-ng v0.17.0 (carries upstream PR #1700 — the wasi guard fix) with an 8MiB shadow stack, patched bridge.c (8MiB arena, oversize fail-fast), `MaxStackSize` capped at shadow‑1MiB so the catchable guard always trips first, trap-path instance retirement. Regression probes pin trip/survival/budget behavior | closed |

(Risk numbering is stable — gaps correspond to risks retired by design decisions recorded in §4.3/§5.4/§12.)
