
import { createElement, type ComponentType, type ReactElement } from 'react'
import { Route, Routes } from 'react-router'


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

export function routeTable(input: RouteTableInput): RouteTable {
  
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
      return createElement(
        Routes,
        null,
        pages.map((p) =>
          createElement(Route, {
            key: p.path,
            path: p.path,
            element: createElement(p.component, propsByPageId?.[p.pageId]),
          }),
        ),
      )
    },
    toJSON() {
      return JSON.stringify(pages.map(({ path, pageId, render }) => ({ path, pageId, render })))
    },
  }
}
