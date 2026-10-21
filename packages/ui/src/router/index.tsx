/**
 * Router adapter — the single import point for routing inside @ploykit/ui.
 *
 * EVERY module in this package imports routing primitives from HERE, never
 * from `@tanstack/react-router` directly. The coordinating pass adds a
 * sentinel test enforcing this with a static import graph check.
 *
 * The adapter wraps @tanstack/react-router (chosen by
 * docs/delivery-audit-proposal-orkome-tanstack-router-2026-10-19.md) and
 * smooths the surface differences so that components and pages map over
 * mechanically:
 *
 * - `navigate(path)`            -> imperative navigation by path string
 * - `useParams()`               -> `Record<string, string | undefined>`
 * - `useLocation()`             -> `{ pathname, search, hash, state }` with
 *                                  `search` as a STRING (leading `?`) and
 *                                  `hash` WITHOUT the leading `#`
 * - `useSearchParamsCompat()`   -> the classic
 *                                  `[URLSearchParams, setSearchParams]`
 *                                  tuple incl. functional updates and the
 *                                  `{ replace }` option
 * - `RouterTestHarness`         -> test mount helper (memory history)
 *
 * Consumers of this package mount a real @tanstack/react-router at their own
 * root; nothing here creates one (except the test harness below).
 */
import * as React from 'react'
import {
  Link as TanStackLink,
  RouterProvider,
  createMemoryHistory,
  createRouter,
  createRootRoute,
  createRoute,
  useLocation as useTanStackLocation,
  useNavigate as useTanStackNavigate,
  useParams as useTanStackParams,
  useRouter as useTanStackRouter,
  useSearch as useTanStackSearch,
} from '@tanstack/react-router'

// ---------------------------------------------------------------------------
// Re-exports (typed passthrough)
// ---------------------------------------------------------------------------

/**
 * Typed passthrough of TanStack Router's `Link`.
 *
 * Props: `to` (path string), optional `search`, `params`, `replace`,
 * `state`, `preload`, `activeProps`/`inactiveProps`, plus anchor props
 * (`className`, `children`, ...). Renders an `<a>` element.
 */
export const Link = TanStackLink

/** The full props object accepted by {@link Link}. */
export type LinkProps = React.ComponentProps<typeof TanStackLink>

/**
 * Imperative navigation hook.
 *
 * Divergence from the TanStack original, kept deliberately: the returned
 * function ALSO accepts a bare path string, because every internal call
 * site navigates by path (`navigate('/login')`, `navigate(item.to)`).
 * Passing a path string navigates with `{ to: path }`.
 * Passing a TanStack `NavigateOptions` object is forwarded untouched.
 *
 * @returns an async function that navigates and resolves when committed.
 */
export function useNavigate(): UseNavigateFn {
  const navigate = useTanStackNavigate()
  return React.useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (to: string | NavigateInput) => {
      if (typeof to === 'string') return navigate({ to } as any)
      // Loose adapter shape -> TanStack's route-tree-validated options.
      // Validated at runtime by the host router (unknown paths fail loudly
      // in dev, exactly like the pre-adapter code).
      return navigate(to as any)
    },
    [navigate],
  ) as UseNavigateFn
}

/** Accepted argument shapes of the function returned by {@link useNavigate}. */
export type NavigateInput = {
  to?: string
  replace?: boolean
  params?: Record<string, string | number>
  search?: true | Record<string, unknown> | ((prev: Record<string, unknown>) => Record<string, unknown>)
  state?: unknown
  hash?: string
}

/** The navigate function returned by {@link useNavigate}. */
export type UseNavigateFn = (to: string | NavigateInput) => Promise<void>

/**
 * Path parameters of the current matched route.
 *
 * Loosened on purpose: TanStack's strict `useParams({ strict: false })`
 * typing is keyed on the concrete route tree, which this package does not
 * own. Callers destructure (`const { id = '' } = useParams()`), so a loose
 * record keeps them mechanical.
 *
 * @returns the current route's path params (possibly empty).
 */
export function useParams(): Record<string, string | undefined> {
  return useTanStackParams({ strict: false }) as Record<string, string | undefined>
}

/**
 * Current location with a react-router-shaped surface:
 *
 * - `pathname`: path including the leading `/` (no search/hash)
 * - `search`: search string INCLUDING the leading `?` (empty string when
 *   there are no params) — TanStack calls this `searchStr`
 * - `hash`: hash WITHOUT the leading `#` (empty string when absent)
 * - `state`: the in-memory history state (or null)
 *
 * Host detection uses `useRouter({ warn: false })`, which returns `undefined`
 * outside a `RouterProvider` instead of throwing. A host that runs another
 * router (react-router) or a plain SPA therefore gets a `window.history`-backed
 * fallback rather than a render crash — before 2026-10-21 this hook threw
 * `Cannot read properties of null (reading 'isServer')`, which killed the whole
 * LoginPage for any non-TanStack consumer (risk-engine field report).
 *
 * The branch is stable per environment: a router provider wraps consumers at
 * mount time and is never inserted around an already-mounted subtree.
 *
 * @returns the normalized current location object.
 */
export function useLocation(): LocationCompat {
  const router = useTanStackRouter({ warn: false })
  if (!router) return useHistoryFallbackLocation()
  return useTanStackLocationCompat()
}

function useTanStackLocationCompat(): LocationCompat {
  const location = useTanStackLocation()
  return {
    pathname: location.pathname,
    search: location.searchStr,
    hash: location.hash,
    state: (location.state ?? null) as LocationCompat['state'],
  }
}

/** Reads `window.history` directly — deliberately non-reactive: this path serves
 *  one-shot consumers (e.g. SignInForm's redirect target) in hosts without a
 *  TanStack router; reactive consumers run a router and take the branch above. */
function useHistoryFallbackLocation(): LocationCompat {
  if (typeof window === 'undefined') {
    return { pathname: '', search: '', hash: '', state: null }
  }
  const { pathname, search, hash } = window.location
  const state = window.history.state
  // react-router stores location state under `usr` (the rest of the object is
  // its own bookkeeping: key/idx). Unwrap it so `location.state.from` reads the
  // same value it does under TanStack.
  const usr = state && typeof state === 'object' && 'usr' in state
    ? (state as { usr?: unknown }).usr
    : state
  return {
    pathname: pathname ?? '',
    search: search ?? '',
    hash: (hash ?? '').replace(/^#/, ''),
    state: usr ?? null,
  }
}

/** Normalized location object returned by {@link useLocation}. */
export interface LocationCompat {
  /** Path including the leading `/`, without search or hash. */
  pathname: string
  /** Search string including the leading `?`; `''` when there is none. */
  search: string
  /** Hash without the leading `#`; `''` when there is none. */
  hash: string
  /** In-memory history state, `null` when unset. */
  state: unknown
}

// ---------------------------------------------------------------------------
// useSearchParamsCompat — the react-router useSearchParams surface
// ---------------------------------------------------------------------------

/**
 * Search-parameter state + setter, matching the classic
 * `[URLSearchParams, setSearchParams]` tuple so call sites map over 1:1.
 *
 * The getter is a live `URLSearchParams` built from the router location.
 * The setter accepts:
 * - a `URLSearchParams` / init-object / `[key, value][]` — replaces the
 *   query string entirely (react-router semantics);
 * - a function `(prev: URLSearchParams) => init` — functional update.
 *
 * Options: `{ replace?: boolean }` — replace the current history entry
 * instead of pushing (default push). Other navigation options (`state`,
 * `hash`) pass through to the underlying navigate call.
 *
 * @returns the `[URLSearchParams, setSearchParams]` tuple.
 */
export function useSearchParamsCompat(): SearchParamsCompat {
  const location = useTanStackLocation()
  const navigate = useTanStackNavigate()

  const searchParams = React.useMemo(
    () => new URLSearchParams(location.searchStr),
    [location.searchStr],
  )

  const setSearchParams = React.useCallback(
    (
      next:
        | URLSearchParams
        | Record<string, string>
        | [string, string][]
        | string
        | ((prev: URLSearchParams) => URLSearchParams | Record<string, string> | [string, string][] | string),
      options?: SetSearchParamsOptions,
    ) => {
      const init =
        typeof next === 'function'
          ? next(new URLSearchParams(location.searchStr))
          : next
      const params = init instanceof URLSearchParams ? init : new URLSearchParams(init)
      const search: Record<string, string> = {}
      params.forEach((value, key) => {
        search[key] = value
      })
      void navigate({
        // TanStack's `search` takes an object / updater, not a string.
        // An empty object clears the query string entirely.
        search,
        replace: options?.replace,
        state: options?.state as Record<string, unknown> | undefined,
      } as any)
    },
    [navigate, location.searchStr],
  )

  return [searchParams, setSearchParams]
}

/**
 * Options accepted by the setter of {@link useSearchParamsCompat}.
 * `replace: true` swaps the current history entry instead of pushing.
 */
export interface SetSearchParamsOptions {
  replace?: boolean
  state?: unknown
}

/** The `[URLSearchParams, setSearchParams]` tuple type. */
export type SearchParamsCompat = [
  URLSearchParams,
  (
    next:
      | URLSearchParams
      | Record<string, string>
      | [string, string][]
      | string
      | ((prev: URLSearchParams) => URLSearchParams | Record<string, string> | [string, string][] | string),
    options?: SetSearchParamsOptions,
  ) => void,
]

// ---------------------------------------------------------------------------
// Raw-string search serialization — the adapter's serialization contract
// ---------------------------------------------------------------------------

/**
 * Plain-string search serializer for the router the HOST APPLICATION creates.
 * TanStack's default JSON-encodes digit-only strings (?mpage=%222%22), which
 * breaks the react-router-shaped URLs useSearchParamsCompat promises
 * (?mpage=2). Wire both into createRouter:
 *
 *   createRouter({ ..., stringifySearch: rawStringifySearch, parseSearch: rawParseSearch })
 *
 * RouterTestHarness does this automatically; production routers must too,
 * or every numeric search param gets quoted on first navigation.
 */
export function rawStringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(search)) {
    if (v === undefined || v === null) continue
    params.set(k, String(v))
  }
  const s = params.toString()
  return s ? `?${s}` : ''
}

/** Pair of {@link rawStringifySearch} — parses a query string to a record. */
export function rawParseSearch(searchStr: string): Record<string, string> {
  const out: Record<string, string> = {}
  const s = searchStr.startsWith('?') ? searchStr.slice(1) : searchStr
  if (!s) return out
  // Not URLSearchParams.forEach/for..of: the renderx QuickJS prelude shim
  // implements a subset (this split-based form matches its '+' semantics and
  // runs in the SSR sandbox, where forEach is absent).
  for (const pair of s.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawK = eq < 0 ? pair : pair.slice(0, eq)
    const rawV = eq < 0 ? '' : pair.slice(eq + 1)
    out[decodeURIComponent(rawK.split('+').join(' '))] = decodeURIComponent(rawV.split('+').join(' '))
  }
  return out
}

// ---------------------------------------------------------------------------
// RouterTestHarness — test-only mount helper
// ---------------------------------------------------------------------------

/** Options of {@link RouterTestHarness}. */
export interface RouterTestHarnessProps {
  /**
   * Initial history entries, react-router MemoryRouter style
   * (e.g. `['/app']`). The last entry is the initial location.
   */
  initialEntries?: string[]
  /** The element tree mounted inside the router context. */
  children: React.ReactNode
}

/**
 * Test harness: mounts `children` inside a real @tanstack/react-router
 * backed by an in-memory history, replacing the old react-router
 * `MemoryRouter` wrap in component tests.
 *
 * A catch-all route renders `children` at any path. The router instance is
 * created once per `initialEntries`; `children` is handed through a stable
 * context slot so re-renders (assertion-driven DOM churn) never rebuild or
 * remount the router.
 *
 * @param props see {@link RouterTestHarnessProps}
 * @returns the mounted router context with `children` rendered.
 */

// TanStack's default search serializer JSON-encodes digit-only strings
// (?mpage=%222%22) — react-router semantics are ?mpage=2. The harness (and
// every production router the adapter documents) uses the plain-string pair
// so useSearchParamsCompat round-trips RR-shaped URLs byte-for-byte.

export function RouterTestHarness({ initialEntries = ['/'], children }: RouterTestHarnessProps) {
  // Hold `children` in a ref-backed slot: the router tree (root route
  // component) must be referentially stable across renders, while test
  // assertions re-render `children` freely.
  const childrenSlot = React.useRef(children)
  childrenSlot.current = children

  const router = React.useMemo(() => {
    const rootRoute = createRootRoute({
      component: () => childrenSlot.current,
    })
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      component: () => childrenSlot.current,
    })
    const catchAllRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '$',
      component: () => childrenSlot.current,
    })
    const routeTree = rootRoute.addChildren([indexRoute, catchAllRoute])
    return createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries }),
      stringifySearch: rawStringifySearch,
      parseSearch: rawParseSearch,
    })
    // `initialEntries` is the only creation input; children flow through the ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialEntries)])

  return React.createElement(RouterProvider, { router })
}

// NOTE: this package deliberately does NOT augment
// `@tanstack/react-router`'s `Register` interface — the host application
// owns the typed route tree. A module augmentation here would merge into
// every consumer's build and hijack their typed-router inference.
