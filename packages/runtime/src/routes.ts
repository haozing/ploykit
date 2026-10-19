
import { type ComponentType, type ReactElement } from 'react'


export type RenderMode = 'static' | 'csr'


export interface RouteSpec {

  component: ComponentType<any>

  render?: RenderMode
}


export type RouteTableInput = Record<string, RouteSpec>


export interface PageSpec {
  path: string

  pageId: string
  render: RenderMode
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
    const base = kebab(componentName(spec.component)) || pathSlug(path) || 'page'
    let pageId = base
    for (let n = 2; used.has(pageId); n++) pageId = `${base}-${n}`
    used.add(pageId)
    pages.push({ path, pageId, render: spec.render ?? 'csr', component: spec.component })
  }

  return {
    pages,
    routes(propsByPageId) {
      return assembler.assemble(pages, propsByPageId)
    },
    toJSON() {
      return JSON.stringify(pages.map(({ path, pageId, render }) => ({ path, pageId, render })))
    },
  }
}
