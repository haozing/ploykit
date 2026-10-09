
import type { ReactElement } from 'react'
import type { Directive, PloykitHost } from './types'
import type { RouteTable } from './routes'

export interface SsrEntryOptions {
  
  routes: RouteTable
  
  render: (element: ReactElement) => string
  
  wrap: (children: ReactElement, location: string) => ReactElement
}


export interface SsrEntry {
  routes(): string
  render(pageId: string, location: string, propsJson: string): string
}

interface RenderResult {
  html: string
  directives: Directive[]
}

export function createSsrEntry({ routes: table, render, wrap }: SsrEntryOptions): SsrEntry {
  const routesFn = (): string => table.toJSON()

  const renderFn = (pageId: string, location: string, propsJson: string): string => {
    const page = table.pages.find((p) => p.pageId === pageId)
    if (!page) {
      
      throw new Error(`[ploykit/runtime] 未知 pageId：${pageId}（路由表对账失败？）`)
    }
    let props: Record<string, unknown> | undefined
    if (propsJson) {
      
      const parsed = JSON.parse(propsJson)
      props = (parsed ?? undefined) as Record<string, unknown> | undefined
    }

    const prevHost = globalThis.__ploykit_host__
    const directives: Directive[] = []
    const sink: PloykitHost = {
      directive(kind, jsonPayload) {
        directives.push({
          kind,
          payload: JSON.parse(jsonPayload) as Directive['payload'],
          seq: directives.length + 1,
        })
        prevHost?.directive(kind, jsonPayload)
      },
    }
    globalThis.__ploykit_host__ = sink
    let result: RenderResult
    try {
      const children = table.routes(props ? { [pageId]: props } : undefined)
      const html = render(wrap(children, location))
      result = { html, directives }
    } finally {
      globalThis.__ploykit_host__ = prevHost
    }
    return JSON.stringify(result)
  }

  globalThis.__ploykit_routes__ = routesFn
  globalThis.__ploykit_render__ = renderFn
  return { routes: routesFn, render: renderFn }
}
