
import type { ReactElement } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { matchRoutes } from 'react-router'
import type { RouteTable } from './routes'


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
}

// pageId is derived from component display names (routeTable), and production
// minification mangles those names in the client bundle while the SSR bundle
// keeps them (the Go esbuild build sets no minify flags) — so the pageId
// embedded in the props script cannot be trusted as a key into the client's
// own route table. Route path patterns are string literals: they survive
// minification and are identical in both bundles, so the props' owning page is
// resolved by matching the current URL against the client table itself. The
// last match is the leaf of the matched branch, i.e. the page that owns the
// payload.
function propsForHydration(
  table: RouteTable,
  hydrated: HydratePayload,
): Record<string, unknown> | undefined {
  const matches = matchRoutes(
    table.pages.map((p) => ({ path: p.path, id: p.pageId })),
    window.location.pathname,
  )
  const leaf = matches && matches[matches.length - 1]
  if (leaf && leaf.route.id) return { [leaf.route.id]: hydrated.props }
  // Fallback for setups where the URL does not spell the bare route path
  // (e.g. an app base path): a non-minified client bundle still agrees with
  // the embedded pageId, so keep the legacy keying there.
  if (table.pages.some((p) => p.pageId === hydrated.pageId)) {
    return { [hydrated.pageId]: hydrated.props }
  }
  console.warn(
    '[ploykit/runtime] props script present but no route matched "%s" (embedded pageId "%s" not in the client route table); mounting without props (page will fetch its own data)',
    window.location.pathname,
    hydrated.pageId,
  )
  return undefined
}

export function createClientEntry({ routes: table, mount, container }: ClientEntryOptions): void {
  const rootEl = container ?? document.getElementById('root')
  if (!rootEl) throw new Error('[ploykit/runtime] 未找到挂载点 #root')
  const hydrated = readPropsScript()
  if (hydrated) {
    
    hydrateRoot(rootEl, mount(table.routes(propsForHydration(table, hydrated))))
    return
  }
  
  createRoot(rootEl).render(mount(table.routes()))
}
