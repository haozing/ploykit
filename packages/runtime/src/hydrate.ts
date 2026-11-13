
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

// 本包不依赖 vite（连 devDependencies 都不引），DEV 探测用局部交叉类型断言
// 读取，刻意不做 declare global——那会与消费方的 vite/client 类型声明
// （ImportMeta.env: ImportMetaEnv）发生同名成员的合并冲突。只缓存
// import.meta 本身、.env 在调用点读取：vitest 的 import.meta.env 是可变
// 代理（vi.stubEnv 要在导入后仍能生效），模块顶层快照掉 .env 会把值冻死。
// vite 语义下 dev server 为 true、生产 build 为 false；非 vite 消费方打包
// 时 `import.meta.env` 不存在 → undefined → 判假，断言静默不启用。
const importMeta = import.meta as ImportMeta & {
  readonly env?: { readonly DEV?: boolean }
}

// Dev-期 pageId 漂移断言（audit §3.5①）：双侧路由表各自推导 pageId（SSR
// bundle 与客户端 bundle 是两次独立构建，组件名/displayName 两侧可不同，
// 典型如生产压缩只 mangling 客户端一侧、或两侧组件改名不同步），漂移时
// props 脚本里内嵌的 SSR pageId 在客户端表里找不到。水合回退梯子本来就用
// pathname 匹配兜住了 props（props 不丢），所以漂移在浏览器里零症状——
// 但它意味着「内嵌 pageId」这条兜底轨彻底失效（一旦 pathname 匹配也失手
// ——basename 型 URL、非标准模式语法——页面就静默丢 props），且 dev 期
// 出现的漂移几乎总是命名事故（Login vs RegisterPage 拼错）而非合法的压缩
// 效应（后者只发生在生产构建）。因此只在 import.meta.env.DEV（vite 语义：
// dev server 真、生产 build 假；非 vite 消费方打包时该键不定义 →
// undefined → 假，不误报）console.error 一次，点名两侧 pageId 与修法
// （组件名/displayName 两侧对齐，或 lazyPage 的 name 参数）。只在梯子第
// 2 级命中（pathname 匹配成功）时才有「漂移但已兜住」可言——第 3 级命中
// 说明 pageId 本来就一致，第 4 级（双失手）已有自己的 hydration-miss
// 事件，不在此重复。
function warnPageIdDriftIfDev(pathname: string, hydrated: HydratePayload, matchedPageId: string): void {
  if (!importMeta.env?.DEV) return
  console.error(
    '[ploykit/runtime] pageId 漂移：SSR props 脚本内嵌 pageId "%s" 不在客户端路由表中，pathname "%s" 经路径匹配解析到 "%s"。' +
      'props 本次已按路径匹配送达，但内嵌 pageId 兜底轨已失效（pathname 也匹配不上时会静默丢 props）。' +
      '请把两侧路由表的组件名/displayName 对齐（lazyPage(name, ...) 的 name 参数两侧传同一字面量）。',
    hydrated.pageId,
    pathname,
    matchedPageId,
  )
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
  if (defaultPageId) {
    if (defaultPageId !== hydrated.pageId && !table.pages.some((p) => p.pageId === hydrated.pageId)) {
      warnPageIdDriftIfDev(pathname, hydrated, defaultPageId)
    }
    return { [defaultPageId]: hydrated.props }
  }
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
