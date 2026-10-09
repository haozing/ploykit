
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, StaticRouter } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'
import { createClientEntry, PROPS_SCRIPT_ID, serializeProps } from '../hydrate'
import { routeTable } from '../routes'

function StaticPage(props: { title?: string; items?: string[] }) {
  
  const { title = '默认标题', items = ['默认项'] } = props ?? {}
  return (
    <main>
      <h1>{title}</h1>
      <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </main>
  )
}

const table = routeTable({ '/page': { component: StaticPage, render: 'static' } })


function serverRender(propsByPageId?: Record<string, unknown>): string {
  return renderToString(
    createElement(StaticRouter, { location: '/page' }, table.routes(propsByPageId)),
  )
}


function assemble(bodyHtml: string, propsScript: string): void {
  document.body.innerHTML = `<div id="root">${bodyHtml}</div>
<script type="application/json" id="${PROPS_SCRIPT_ID}" data-page-id="static-page">${propsScript}</script>`
}

beforeEach(() => {
  document.body.innerHTML = ''
})

describe('createClientEntry 水合组合链（真 hydrateRoot）', () => {
  it('带 props 水合：服务端 HTML 与客户端树同构，内容存活且无水合错误', () => {
    const props = { title: '服务端标题', items: ['a', 'b'] }
    assemble(serverRender({ 'static-page': props }), serializeProps(props))
    const errors: unknown[] = []
    const orig = console.error
    console.error = (...args: unknown[]) => errors.push(args)
    try {
      createClientEntry({ routes: table, mount: (c) => createElement(MemoryRouter, { initialEntries: ['/page'] }, c) })
    } finally {
      console.error = orig
    }
    expect(document.querySelector('h1')?.textContent).toBe('服务端标题')
    expect(document.querySelectorAll('li')).toHaveLength(2)
    
    
    expect(errors).toEqual([])
  })

  it('null props 端到端（P2-27）：水合侧解构默认值生效，与 SSR 侧同渲染', () => {
    
    assemble(serverRender(undefined), 'null')
    const errors: unknown[] = []
    const orig = console.error
    console.error = (...args: unknown[]) => errors.push(args)
    try {
      createClientEntry({ routes: table, mount: (c) => createElement(MemoryRouter, { initialEntries: ['/page'] }, c) })
    } finally {
      console.error = orig
    }
    
    expect(document.querySelector('h1')?.textContent).toBe('默认标题')
    expect(document.querySelectorAll('li')).toHaveLength(1)
    expect(errors).toEqual([])
  })
})
