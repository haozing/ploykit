
import type { ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { matchPageByPath } from './match'
import type { PageSpec, RouteTable } from './routes'


export const PROPS_SCRIPT_ID = '__PLOYKIT_PROPS__'


export function serializeProps(props: unknown): string {
  return JSON.stringify(props ?? null).replace(/</g, '\\u003c')
}

export interface HydratePayload {
  pageId: string
  props: unknown
}


export function readPropsScript(doc: Document = document): HydratePayload | null {
  const el = doc.getElementById(PROPS_SCRIPT_ID)
  if (!el || !el.textContent) return null
  const pageId = el.getAttribute('data-page-id')
  if (!pageId) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(el.textContent)
  } catch (err) {
    
    
    
    
    
    
    console.error('[ploykit/runtime] props script JSON 解析失败，回退 SPA 挂载', err)
    return null
  }
  
  
  
  
  return { pageId, props: parsed ?? undefined }
}

export interface ClientEntryOptions {

  routes: RouteTable

  mount: (children: ReactElement) => ReactElement

  container?: HTMLElement | null

  // OPTIONAL override for pathname → owning pageId resolution. The built-in
  // default (matchPageByPath) already understands the standard routeTable /
  // PageSpec pattern syntax (`:param` and a trailing `*`), so products do not
  // need to wire a matcher at all. Pass an override only when the router's
  // route semantics differ from that syntax or when the URL does not spell
  // the bare route path (e.g. an app base path): the consumer implementation
  // (react-router's matchRoutePage, TanStack's matchTanstackPage, or a custom
  // one) runs FIRST and its non-null result wins. A null result falls through
  // to the default matcher, then to the embedded-pageId fallback.
  matchPage?: (pathname: string, pages: PageSpec[]) => string | null
}

// Resolve the page that owns the SSR payload. The ladder, in order:
//
// 1. Consumer `matchPage` override (non-null result wins).
// 2. Default `matchPageByPath`: route path patterns are string literals, so
//    they survive client-bundle minification and are identical in the SSR and
//    client bundles — unlike pageIds derived from component display names,
//    which production minification mangles in the client bundle only (pageId
//    is derived from component display names via routeTable). Matching the
//    current URL against the client table itself therefore works by default,
//    with no router library and no consumer wiring.
// 3. Legacy embedded-pageId keying: for non-minified bundles (or setups where
//    the URL does not spell the bare route path) the client pageId still
//    agrees with the SSR-embedded one.
// 4. Genuine mismatch: emit a structured `ploykit:hydration-miss` browser
//    event (for server-side/monitoring capture) plus one console.error, then
//    mount WITHOUT props. Loader-driven pages — pages that render only their
//    loader props and never fetch client-side — render EMPTY in this case;
//    that is exactly why the event exists (a console-only signal is invisible
//    outside the browser).
function propsForHydration(
  table: RouteTable,
  hydrated: HydratePayload,
  matchPage?: (pathname: string, pages: PageSpec[]) => string | null,
): Record<string, unknown> | undefined {
  const pathname = window.location.pathname
  if (matchPage) {
    const pageId = matchPage(pathname, table.pages)
    if (pageId) return { [pageId]: hydrated.props }
  }
  const defaultPageId = matchPageByPath(pathname, table.pages)
  if (defaultPageId) return { [defaultPageId]: hydrated.props }
  if (table.pages.some((p) => p.pageId === hydrated.pageId)) {
    return { [hydrated.pageId]: hydrated.props }
  }
  console.error(
    '[ploykit/runtime] props script present but no route matched "%s" (embedded pageId "%s" not in the client route table); mounting without props — loader-driven pages will render empty; dispatched "ploykit:hydration-miss" for monitoring',
    pathname,
    hydrated.pageId,
  )
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    if (typeof CustomEvent !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('ploykit:hydration-miss', {
          detail: { pathname: window.location.pathname, embeddedPageId: hydrated.pageId },
        }),
      )
    }
  }
  return undefined
}

export function createClientEntry({
  routes: table,
  mount,
  container,
  matchPage,
}: ClientEntryOptions): void {
  const rootEl = container ?? document.getElementById('root')
  if (!rootEl) throw new Error('[ploykit/runtime] 未找到挂载点 #root')
  const hydrated = readPropsScript()
  if (hydrated) {

    hydrateRoot(rootEl, mount(table.routes(propsForHydration(table, hydrated, matchPage))))
    return
  }

  createRoot(rootEl).render(mount(table.routes()))
}
