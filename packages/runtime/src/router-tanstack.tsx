// TanStack Router adapter for @ploykit/runtime — the version-pinned fragility
// surface. Everything that couples ploykit's rendering contract to TanStack
// Router's non-public internals lives in THIS file and nowhere else, so a
// TanStack upgrade that renames an internal fails one test, not every product
// (PoC verdict "fragility register" item 1).
//
// Provenance: every internal touched here was verified against
// @tanstack/react-router 1.170.45 (+ @tanstack/router-core 1.171.38) by the
// renderx QuickJS PoC at D:\code\_tmp\tanstack-poc (VERDICT.md: GO with
// conditions, 2026-10-19). The pin in package.json is the lesson from that
// PoC: do not widen it to a caret without re-running the renderx gate.
//
// Why a sync populate instead of `await router.load()` (PoC verdict): the
// renderx engine never pumps QuickJS pending jobs between evals, and
// router.load() commits its matches in promise continuations — a non-awaited
// load() strands them forever and RouterProvider renders an empty shell. For
// loader-less routes, matchRoutes() initializes every match with status
// "success" synchronously (routeNeedsLoad() === false), so we replicate
// loadServerRoute's final commit block (router-core load-server.js) directly.
//
// This module is imported ONLY by consumers that chose TanStack Router
// (mirroring @ploykit/runtime/router-react-router); the main barrel stays
// router-agnostic.
import { createElement } from 'react'
import {
  createMemoryHistory,
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import type { ReactElement } from 'react'
import type { PageSpec, RouteAssembler } from './routes'

// ---------------------------------------------------------------------------
// Version pin + internals contract (the fragility register)
// ---------------------------------------------------------------------------

/**
 * The exact @tanstack/react-router version the renderx PoC validated.
 * package.json must pin dependencies["@tanstack/react-router"] to this value
 * (no caret); the runtime test asserts both the constant and the manifest so
 * an accidental widen fails CI instead of production.
 */
export const TANSTACK_PINNED_VERSION = '1.170.45'

/**
 * Structural view of the router internals populateSync relies on. These are
 * NOT documented API (they mirror loadServerRoute's commit block); the pin
 * above plus the renderx gate guard them. If a TanStack upgrade renames any
 * of these, populateSync throws here — a single, loud, typed failure point.
 */
interface TanstackRouterInternals {
  latestLocation: { href: string; pathname: string }
  matchRoutes(loc: unknown): Array<{ routeId: string; status: string; route: object }>
  batch(fn: () => void): void
  stores: {
    location: { set(v: unknown): void }
    status: { set(v: string): void }
    resolvedLocation: { set(v: unknown): void }
    setMatches(matches: unknown[]): void
  }
  _committed: unknown[]
}

/**
 * Synchronous match-commit (PoC entry-server.tsx populateSync, verbatim
 * shape). Returns the matched chain; every entry has status "success" when
 * routes carry no loader / beforeLoad / lazy component — the renderx contract
 * for SSR pages (data comes from Go Loaders, never JS loaders).
 */
function populateSync(router: object): Array<{ routeId: string; status: string }> {
  const r = router as TanstackRouterInternals
  const next = r.latestLocation
  const matches = r.matchRoutes(next)
  r.batch(() => {
    r.stores.location.set(next)
    r.stores.status.set('idle')
    r._committed = matches
    r.stores.setMatches(matches)
    r.stores.resolvedLocation.set(next)
  })
  return matches
}

// ---------------------------------------------------------------------------
// Path translation: react-router syntax -> TanStack syntax
// ---------------------------------------------------------------------------

/**
 * Route paths in the route table are react-router-style string literals
 * (':param' segments, '*' splat) — they are the API contract with the Go
 * side (renderx Reconcile / prerender registry keys see the ORIGINAL strings,
 * so the framework never learns TanStack syntax). This translates a segment
 * chain to what createRoute({ path }) expects: ':name' -> '$name', '*' -> '$'
 * (TanStack's splat). Static segments pass through unchanged.
 */
function toTanstackPath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) return '$' + seg.slice(1)
      if (seg === '*') return '$'
      return seg
    })
    .join('/')
}

// ---------------------------------------------------------------------------
// SSR location bootstrap
// ---------------------------------------------------------------------------

/**
 * Global key the SSR entry's `wrap` records the render location under, and
 * the assembler's mount component reads it from. Needed because
 * createSsrEntry builds the route element (table.routes) BEFORE calling
 * wrap(children, location) — the location is only available to the actual
 * React render, which happens after wrap. Single-threaded synchronous renders
 * (the renderx contract) make a per-render global safe; each engine instance
 * evaluates its own bundle copy, so pool instances cannot observe each
 * other's value.
 *
 * The marker's PRESENCE is also the SSR-mode switch for the mount component:
 * set -> memory-history router at the recorded location (SSR / tests);
 * unset -> real browser history at window.location (hydration / SPA). A
 * window sniff alone cannot draw this line (test environments have a window
 * too). SSR bundles and client bundles are separate JS contexts, so a
 * leftover marker in one cannot leak into the other.
 */
export const SSR_LOCATION_KEY = '__ploykit_tanstack_location__'

/** Record the location for the next SSR render (see SSR_LOCATION_KEY). */
export function setTanstackSsrLocation(location: string): void {
  ;(globalThis as Record<string, unknown>)[SSR_LOCATION_KEY] = location
}

/** Clear the SSR location marker (mode switch back to browser history). */
export function clearTanstackSsrLocation(): void {
  delete (globalThis as Record<string, unknown>)[SSR_LOCATION_KEY]
}

/** Returns the recorded SSR location, or null when unset (browser mode). */
function readSsrLocation(): string | null {
  const recorded = (globalThis as Record<string, unknown>)[SSR_LOCATION_KEY]
  return typeof recorded === 'string' && recorded ? recorded : null
}

// ---------------------------------------------------------------------------
// The mount component: router construction at render time
// ---------------------------------------------------------------------------

interface TanstackRouterMountProps {
  pages: ReadonlyArray<PageSpec>
  propsByPageId?: Record<string, unknown>
  /** Product providers mounted inside the router context (InnerWrap). */
  wrapInRouter?: (children: ReactElement) => ReactElement
}

/**
 * Builds the route tree + router at RENDER time (not module scope, not
 * assemble time):
 * - SSR: one render = one router, constructed inside the synchronous render
 *   exactly like the PoC's __ploykit_render__ (per-render construction, no
 *   state bleed between renders on a pool instance — PoC longevity assertion).
 *   Mode is signaled by setTanstackSsrLocation (the entry's `wrap`).
 * - Client: the same component runs once before hydrateRoot/createRoot, with
 *   a REAL browser history so TanStack owns SPA navigation and the URL bar.
 *
 * populateSync seeds the match chain synchronously on BOTH sides: on the
 * server because of the sandbox's no-pending-jobs contract; on the client so
 * the FIRST client render sees the same matches the server rendered
 * (otherwise hydration would pair server HTML with an empty match tree and
 * blow up). Transitioner's layout-effect load() re-runs afterwards on the
 * client's normal async path and converges to the same result.
 */
function TanstackRouterMount({ pages, propsByPageId, wrapInRouter }: TanstackRouterMountProps) {
  const ssrLocation = readSsrLocation()
  const location = ssrLocation ?? window.location.pathname + window.location.search + window.location.hash

  const rootRoute = createRootRoute({
    component: () => createElement(Outlet),
  })

  const pageRoutes = pages.map((p) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: toTanstackPath(p.path),
      component: () => createElement(p.component, propsByPageId?.[p.pageId] as object | undefined),
    }),
  )

  const routeTree = rootRoute.addChildren(pageRoutes)

  const router = createRouter({
    routeTree,
    history: ssrLocation
      ? createMemoryHistory({ initialEntries: [location] })
      : createBrowserHistory(),
    stringifySearch: rawStringifySearch,
    parseSearch: rawParseSearch,
    // Product providers that need the router context (useLocation/useNavigate
    // inside them) mount here — inside RouterProvider's context, around the
    // rendered match tree.
    InnerWrap: wrapInRouter
      ? ({ children }: { children: ReactElement }) => wrapInRouter(children)
      : undefined,
  })

  populateSync(router)

  return createElement(RouterProvider, { router })
}

// ---------------------------------------------------------------------------
// Public assembler
// ---------------------------------------------------------------------------

/** Options of {@link tanstackAssembler}. */

// TanStack's default search serializer JSON-quotes digit-only strings
// (?mpage=%222%22); every react-router-era URL and every pagination surface
// expects ?mpage=2. The assembler wires the plain-string pair so ALL routers
// it creates round-trip query strings verbatim (the ui adapter's
// useSearchParamsCompat promises the same shape; keep both in sync).
export function rawStringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null) continue
    params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

export function rawParseSearch(searchStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  const params = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr)
  params.forEach((v, k) => {
    out[k] = v
  })
  return out
}

export interface TanstackAssemblerOptions {
  /**
   * Wraps the rendered match tree inside the router context — where product
   * providers live when they (or their children) call useLocation /
   * useNavigate / useParams. Wired via TanStack's router `InnerWrap` option.
   * Must stay synchronous and side-effect-free: it runs during both SSR
   * renders and hydration.
   */
  wrapInRouter?: (children: ReactElement) => ReactElement
}

/**
 * The TanStack Router RouteAssembler (the counterpart of
 * reactRouterAssembler in ./router-react-router). assemble() returns a mount
 * component that builds the router at render time — see TanstackRouterMount
 * for why the router cannot be built here (the SSR location is not an input
 * of the RouteAssembler seam).
 */
export function tanstackAssembler(opts?: TanstackAssemblerOptions): RouteAssembler {
  return {
    assemble(pages, propsByPageId) {
      return createElement(TanstackRouterMount, {
        pages,
        propsByPageId,
        wrapInRouter: opts?.wrapInRouter,
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Public matcher (client matchPage)
// ---------------------------------------------------------------------------

/**
 * matchPage implementation for createClientEntry (the counterpart of
 * matchRoutePage): matches the pathname against the CLIENT's own route table
 * (path patterns are string literals — they survive minification, unlike the
 * component names pageId derives from) and returns the owning pageId, so the
 * hydration props script keys into the right page.
 *
 * Path patterns are the ORIGINAL table strings (':slug' syntax) — the same
 * values the SSR bundle's route JSON carries.
 *
 * Returns null when nothing but the root matched (hydrate's fallback ladder
 * takes over: embedded pageId -> warning).
 */
export function matchTanstackPage(pathname: string, pages: ReadonlyArray<PageSpec>): string | null {
  const rootRoute = createRootRoute({ component: () => null })
  const pageRoutes = pages.map((p) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path: toTanstackPath(p.path),
      component: () => null,
    }),
  )

  const router = createRouter({
    routeTree: rootRoute.addChildren(pageRoutes),
    history: createMemoryHistory({ initialEntries: [pathname] }),
    stringifySearch: rawStringifySearch,
    parseSearch: rawParseSearch,
  })

  // route ids are assigned during processRouteTree (inside createRouter), so
  // the routeId -> pageId map must be built AFTER construction.
  const pageIdByRouteId = new Map<string, string>()
  pageRoutes.forEach((route, i) => pageIdByRouteId.set(route.id, pages[i]!.pageId))

  const matches = populateSync(router)
  // Walk from the leaf up: the deepest match that is one of OUR page routes.
  // (The root route itself is always matches[0] with routeId '__root__'.)
  for (let i = matches.length - 1; i >= 0; i--) {
    const hit = pageIdByRouteId.get(matches[i]!.routeId)
    if (hit) return hit
  }
  return null
}

// ---------------------------------------------------------------------------
// renderx sandbox affordances (constants mirrored by the Go render pipeline)
// ---------------------------------------------------------------------------

/**
 * QuickJS prelude addendum the renderx sandbox needs before a TanStack SSR
 * bundle can evaluate (PoC poc/prelude.go, shims 7 + 8):
 *
 * - URLSearchParams: router-core qss.js constructs one during EVERY router
 *   construction (parseLocation -> decode). The renderx DefaultPrelude has no
 *   URLSearchParams. Minimal but spec-shaped: '+ as space' on parse, repeat
 *   keys preserved, entries() returns a plain array (iterable in QuickJS
 *   without custom Symbol.iterator plumbing).
 * - AbortController: matchRoutesInternal constructs one per match; on the
 *   synchronous render path .signal/.abort() are only touched by the async
 *   load pipeline, which never runs — a construct-only stub suffices.
 *
 * Gated with typeof checks exactly like the rest of the DefaultPrelude, so a
 * future QuickJS that grows real Web APIs is untouched. Concatenate AFTER
 * renderx.DefaultPrelude (PoolOptions.Prelude = DefaultPrelude + this).
 *
 * FRAMEWORK NOTE: this string is mirrored into Go (example/internal/webrender)
 * because Go builds the engine prelude. If renderx grows a first-class
 * TanStack affordance, that mirror should become the framework's copy and
 * this constant should reference it — today the TS constant is canonical and
 * the Go side carries a drifted-on-purpose comment pointing here.
 */
export const PRELUDE_SHIMS = `
// ---- tanstack-router addendum (@ploykit/runtime/router-tanstack, PoC 2026-10-19) ----
// URLSearchParams: router-core qss.js decode/encode runs at every router
// construction (parseLocation). QuickJS has no Web Encoding API.
if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = function URLSearchParams(init) {
    var self = this;
    self._m = new Map();
    function appendRaw(k, v) { var a = self._m.get(k) || []; a.push(String(v)); self._m.set(k, a); }
    self._appendRaw = appendRaw;
    if (typeof init === 'string') {
      var s = init.charAt(0) === '?' ? init.slice(1) : init;
      if (s) {
        s.split('&').forEach(function (pair) {
          if (!pair) return;
          var parts = pair.split('=');
          // '+' as space via split/join (NOT a regex literal): the Go render
          // pipeline mirrors this string as a raw-string literal, where a
          // backslash would double up and silently change the regex semantics.
          var k = decodeURIComponent((parts[0] || '').split('+').join(' '));
          var v = decodeURIComponent((parts[1] || '').split('+').join(' '));
          appendRaw(k, v);
        });
      }
    } else if (init && typeof init === 'object') {
      Object.keys(init).forEach(function (k) { appendRaw(k, init[k]); });
    }
  };
  globalThis.URLSearchParams.prototype.set = function (k, v) { this._m.set(k, [String(v)]); };
  globalThis.URLSearchParams.prototype.append = function (k, v) { this._appendRaw(k, v); };
  globalThis.URLSearchParams.prototype.entries = function () {
    // plain array: iterable in QuickJS without custom Symbol.iterator plumbing
    var out = [];
    this._m.forEach(function (vs, k) { vs.forEach(function (v) { out.push([k, v]); }); });
    return out;
  };
  globalThis.URLSearchParams.prototype.toString = function () {
    var out = [];
    this._m.forEach(function (vs, k) { vs.forEach(function (v) { out.push(encodeURIComponent(k) + '=' + encodeURIComponent(v)); }); });
    return out.join('&');
  };
}
// AbortController: router-core matchRoutesInternal() constructs one per match;
// on the synchronous render path only the (never-running) async load pipeline
// touches .signal/.abort().
if (typeof globalThis.AbortController === 'undefined') {
  globalThis.AbortController = function AbortController() {
    this.signal = {
      aborted: false,
      reason: undefined,
      onabort: null,
      throwIfAborted: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return false; },
    };
  };
  globalThis.AbortController.prototype.abort = function (reason) {
    this.signal.aborted = true;
    this.signal.reason = reason;
  };
}
// ---- end tanstack-router addendum ----
`

/**
 * esbuild aliases the SSR bundle build needs on top of
 * renderx.DefaultSSRAliases (PoC build.js):
 *
 * '@tanstack/router-core/isServer' -> the SERVER variant. With the default
 * (client, isServer=false) variant, `isServer ?? this.isServer` short-circuits
 * on the non-nullish false and evaluates `window?.origin` -> ReferenceError in
 * the QuickJS sandbox (window is deliberately never defined). The server
 * variant statically folds to isServer=true, so all browser probes are
 * dead-code eliminated or short-circuited, and Matches renders MatchesInner
 * without the Transitioner (which would call the forbidden async load()).
 * NOTE: the plain-default (client) resolution is the only broken one — the
 * 'development' variant (isServer = undefined) would also work via the same
 * fallthrough to `typeof document === "undefined"`.
 *
 * The value is a package-relative specifier: resolvable from any directory
 * that can resolve '@tanstack/router-core' itself. The Go render pipeline
 * mirrors this pair with an absolute node_modules path (see
 * example/internal/webrender).
 */
export const ESBUILD_ALIASES: Record<string, string> = {
  '@tanstack/router-core/isServer': '@tanstack/router-core/dist/esm/isServer/server.js',
}
