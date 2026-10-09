// @vitest-environment node

import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { emitDirective } from '../browser'
import { routeTable } from '../routes'
import { createSsrEntry } from '../server'
import type { PloykitHost } from '../types'

function Landing() {
  return <div>landing-body</div>
}
function BlogPost(props: { title?: string }) {
  return <article>{props?.title ?? 'post-body'}</article>
}
function SeoPage(props: { title?: string }) {
  
  emitDirective('head', [{ tag: 'title', children: props?.title ?? '默认标题' }])
  return <main>seo-body</main>
}

const table = routeTable({
  '/': { component: Landing, render: 'static' },
  '/blog/:slug': { component: BlogPost, render: 'static' },
  '/seo': { component: SeoPage, render: 'static' },
})

afterEach(() => {
  delete globalThis.__ploykit_render__
  delete globalThis.__ploykit_routes__
  delete globalThis.__ploykit_host__
})

function setup() {
  return createSsrEntry({
    routes: table,
    render: (el) => renderToString(el),
    wrap: (children, location) => createElement(StaticRouter, { location }, children),
  })
}

describe('createSsrEntry', () => {
  it('挂载 __ploykit_routes__ / __ploykit_render__ 全局（沙箱对话面）', () => {
    setup()
    expect(typeof globalThis.__ploykit_routes__).toBe('function')
    expect(typeof globalThis.__ploykit_render__).toBe('function')
  })

  it('__ploykit_routes__() 返回路由表 JSON 投影（pageId 声明序）', () => {
    expect(JSON.parse(setup().routes())).toEqual([
      { path: '/', pageId: 'landing', render: 'static' },
      { path: '/blog/:slug', pageId: 'blog-post', render: 'static' },
      { path: '/seo', pageId: 'seo-page', render: 'static' },
    ])
  })

  it('__ploykit_render__：props 按 pageId 注入，返回 {html, directives}', () => {
    const out = JSON.parse(setup().render('blog-post', '/blog/hello', JSON.stringify({ title: 'Hello' })))
    expect(out.html).toContain('Hello')
    expect(out.html).toContain('<article>')
    expect(out.directives).toEqual([])
  })

  it('渲染期指令按渲染隔离收集并随结果返回；已注入宿主时逐条转发且渲染后恢复', () => {
    const forwarded: Array<[string, string]> = []
    const host: PloykitHost = { directive: (k, j) => forwarded.push([k, j]) }
    globalThis.__ploykit_host__ = host

    const out = JSON.parse(setup().render('seo-page', '/seo', 'null'))
    expect(out.html).toContain('seo-body')
    expect(out.directives).toEqual([
      { kind: 'head', payload: [{ tag: 'title', children: '默认标题' }], seq: 1 },
    ])
    expect(forwarded).toEqual([['head', JSON.stringify([{ tag: 'title', children: '默认标题' }])]])
    expect(globalThis.__ploykit_host__).toBe(host)
  })

  it('未知 pageId → 抛错（对账失败显式爆炸，G5）', () => {
    expect(() => setup().render('nope', '/', 'null')).toThrow(/pageId/)
  })
})

describe('P3-63 补测：非法 props / 多指令 seq', () => {
  it('propsJson 非法 JSON → 直接抛错（§5.7 fail-fast，不静默降级）', () => {
    expect(() => setup().render('blog-post', '/blog/x', '{oops')).toThrow()
  })

  it('propsJson "null" → 不注入键：组件按缺省 props 渲染（P2-27 服务端语义）', () => {
    const out = JSON.parse(setup().render('blog-post', '/blog/x', 'null'))
    
    expect(out.html).toContain('post-body')
  })

  it('单次渲染多条指令：seq 按 1..n 递增（Go 侧按 seq 排序消费）', () => {
    function MultiDirective() {
      emitDirective('head', [{ tag: 'title', children: '多指令页' }])
      emitDirective('head', [{ tag: 'meta', attrs: { name: 'description', content: 'd' } }])
      emitDirective('status', { code: 404 })
      return <main>multi-body</main>
    }
    const t = routeTable({ '/multi': { component: MultiDirective, render: 'static' } })
    const entry = createSsrEntry({
      routes: t,
      render: (el) => renderToString(el),
      wrap: (children, location) => createElement(StaticRouter, { location }, children),
    })
    const out = JSON.parse(entry.render('multi-directive', '/multi', 'null'))
    expect(out.html).toContain('multi-body')
    expect(out.directives.map((d: { seq: number }) => d.seq)).toEqual([1, 2, 3])
    expect(out.directives[2]).toEqual({ kind: 'status', payload: { code: 404 }, seq: 3 })
  })
})
