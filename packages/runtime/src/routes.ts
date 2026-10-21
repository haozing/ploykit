
import { type ComponentType, type ReactElement } from 'react'


export type RenderMode = 'static' | 'csr'


/**
 * 「这张服务端渲染出来的 HTML 之后还要不要 JS」——与 render 正交的第二根轴。
 *
 * - `load`（缺省）：注入 props 脚本 + 客户端入口，浏览器水合（现状）。
 * - `none`：两者都不注入，HTML 即终态，页面零 JS。只对 `render: 'static'`
 *   合法（CSR 页没有水合概念，声明 none 等于让它永不挂载，是配置错误）。
 *
 * 判定标准是「水合能换来什么」：纯展示、无状态、导航只靠 <a href> 的页面
 * （落地页/声明式内容页）水合只换来路由拦截，代价是整个客户端入口的体积；
 * 一旦页面有 useState/useEffect/onClick，就必须是 `load`。
 */
export type HydrateMode = 'none' | 'load'


export interface RouteSpec {

  component: ComponentType<any>

  render?: RenderMode

  hydrate?: HydrateMode
}


export type RouteTableInput = Record<string, RouteSpec>


export interface PageSpec {
  path: string

  pageId: string
  render: RenderMode
  hydrate: HydrateMode
  component: ComponentType<any>
}


// 路由树组装缝（router 无关）：routeTable 只负责 pageId 推导与路由真源，
// 「怎么把 pages 拼成一棵可渲染的元素树」由消费方注入。react-router 实现
// 在 @ploykit/runtime/router-react-router 子路径（reactRouterAssembler）；
// TanStack Router 等其他 router 的消费方自行实现本接口 —— 这样主入口的
// 模块图不包含任何具体 router（orkome：TanStack 消费方连 hooks 桶都进不
// 来，因为运行时值导入被 react-router 传染）。
export interface RouteAssembler {

  // 组装完整路由树；propsByPageId 按 pageId 注入对应页面组件的 props
  // （SSR/水合数据通道，见 hydrate.ts）。minwin：现无任何调用点需要「单页
  // 组装」，故不设 pageElement —— 需要时再加（minimal wins）。
  assemble(pages: PageSpec[], propsByPageId?: Record<string, unknown>): ReactElement
}


export interface RouteTable {
  pages: PageSpec[]

  routes(propsByPageId?: Record<string, unknown>): ReactElement

  toJSON(): string
}



const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g

function kebab(s: string): string {
  return s
    .replace(CAMEL_BOUNDARY, '$1-$2')
    .replace(/[^a-zA-Z0-9-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function componentName(c: ComponentType<any>): string {




  return (c && (c.displayName || c.name)) || ''
}


function pathSlug(path: string): string {
  return kebab(path.split('/').filter((s) => s && !s.startsWith(':')).join('-')) || 'root'
}

// assembler 必填（无缺省实现）：缺省即静态导入 react-router，会把主入口
// 模块图重新耦合回具体 router —— 与本缝的存在目的相悖。RR 消费方显式传
// reactRouterAssembler（@ploykit/runtime/router-react-router）。
export function routeTable(input: RouteTableInput, assembler: RouteAssembler): RouteTable {

  const pages: PageSpec[] = []
  const used = new Set<string>()
  for (const [path, spec] of Object.entries(input)) {
    const render = spec.render ?? 'csr'
    const hydrate = spec.hydrate ?? 'load'
    // 配置错误在构表时爆炸（构建 / 启动失败），不留到渲染期：CSR 页本来
    // 就没水合这回事，声明 none 只会得到一个永不挂载的页面。
    if (hydrate === 'none' && render !== 'static') {
      throw new Error(
        `[ploykit/runtime] 路由 ${path} 声明了 hydrate: 'none' 但 render=${render}；` +
          `只有 render: 'static' 的页面可以跳过水合（CSR 页必须挂载才有内容）`,
      )
    }
    const base = kebab(componentName(spec.component)) || pathSlug(path) || 'page'
    let pageId = base
    for (let n = 2; used.has(pageId); n++) pageId = `${base}-${n}`
    used.add(pageId)
    pages.push({ path, pageId, render, hydrate, component: spec.component })
  }

  return {
    pages,
    routes(propsByPageId) {
      return assembler.assemble(pages, propsByPageId)
    },
    toJSON() {
      return JSON.stringify(pages.map(({ path, pageId, render, hydrate }) => ({ path, pageId, render, hydrate })))
    },
  }
}
