// Router-agnostic route-pattern matcher (#29): the DEFAULT pathname → pageId
// resolver used by hydration, so products no longer need to wire a router
// matcher. It must understand exactly the syntax routeTable / PageSpec.path
// carries: static segments, `:param`, and a trailing `*` catch-all.
import type { ComponentType } from 'react'
import { describe, expect, it } from 'vitest'
import { matchPageByPath } from '../match'
import type { PageSpec } from '../routes'

// The matcher never touches components; a bare function keeps PageSpec honest
// without pulling react-dom into this pure-logic suite.
function Stub(): null {
  return null
}

function page(path: string, pageId: string): PageSpec {
  return { path, pageId, render: 'static', component: Stub as ComponentType<unknown> }
}

function pages(...entries: Array<[string, string]>): PageSpec[] {
  return entries.map(([path, pageId]) => page(path, pageId))
}

describe('matchPageByPath：静态段 / :param / 尾部 *', () => {
  const table = pages(
    ['/', 'home'],
    ['/blog/:slug', 'blog-post'],
    ['/blog/new', 'blog-new'],
    ['/settings/workspace/*', 'workspace-settings'],
    ['/*', 'catch-all'],
  )

  it('/blog/hello 命中 /blog/:slug', () => {
    expect(matchPageByPath('/blog/hello', table)).toBe('blog-post')
  })

  it('/ 命中 /（catch-all 不吞根路径）', () => {
    expect(matchPageByPath('/', table)).toBe('home')
  })

  it('/settings/workspace/audit 命中 /settings/workspace/*（未声明精确静态页时）', () => {
    // No exact static page for /settings/workspace/audit exists here, so the
    // workspace catch-all owns it; the dedicated static page (if declared)
    // wins via specificity — covered separately below.
    expect(matchPageByPath('/settings/workspace/audit', table)).toBe('workspace-settings')
  })

  it('/whatever/deep 命中 /* catch-all', () => {
    expect(matchPageByPath('/whatever/deep', table)).toBe('catch-all')
  })

  it('静态 /blog/new 比 /blog/:slug 更具体（most-specific wins）', () => {
    expect(matchPageByPath('/blog/new', table)).toBe('blog-new')
  })

  it('尾斜杠容错：/blog/hello/ 仍命中 /blog/:slug', () => {
    expect(matchPageByPath('/blog/hello/', table)).toBe('blog-post')
    expect(matchPageByPath('/blog/new/', table)).toBe('blog-new')
    expect(matchPageByPath('/', table)).toBe('home')
  })

  it('无命中 → null（不含 catch-all 的表）', () => {
    const noCatchAll = pages(['/', 'home'], ['/blog/:slug', 'blog-post'])
    expect(matchPageByPath('/nope', noCatchAll)).toBeNull()
    expect(matchPageByPath('/blog', noCatchAll)).toBeNull()
    expect(matchPageByPath('/blog/a/b', noCatchAll)).toBeNull()
  })
})

describe('matchPageByPath：模式语义细节', () => {
  it(':param 只吃一个非空段（/blog 与 /blog/a/b 均不命中 /blog/:slug）', () => {
    const table = pages(['/blog/:slug', 'blog-post'])
    expect(matchPageByPath('/blog', table)).toBeNull()
    expect(matchPageByPath('/blog/a/b', table)).toBeNull()
  })

  it('* 吃一段或多段剩余段，但 /* 不匹配 /', () => {
    const table = pages(['/*', 'catch-all'])
    expect(matchPageByPath('/', table)).toBeNull()
    expect(matchPageByPath('/a', table)).toBe('catch-all')
    expect(matchPageByPath('/a/b/c', table)).toBe('catch-all')
  })

  it('/settings/workspace/* 不匹配 /settings/workspace（需至少一段剩余）', () => {
    const table = pages(['/settings/workspace/*', 'workspace-settings'], ['/settings/workspace', 'workspace-home'])
    expect(matchPageByPath('/settings/workspace', table)).toBe('workspace-home')
    expect(matchPageByPath('/settings/workspace/audit', table)).toBe('workspace-settings')
  })

  it('静态深层页胜过 catch-all（静态段数更高）', () => {
    const table = pages(['/*', 'catch-all'], ['/settings/workspace/audit', 'audit'])
    expect(matchPageByPath('/settings/workspace/audit', table)).toBe('audit')
  })

  it('参数页与 catch-all 同段数时参数页更具体（非 catch-all 优先）', () => {
    const table = pages(['/a/*', 'a-catch-all'], ['/a/:id', 'a-detail'])
    expect(matchPageByPath('/a/x', table)).toBe('a-detail')
  })

  it('静态段数相同、模式段数多者胜（/a/:x/:y 胜过 /a/*）', () => {
    const table = pages(['/a/*', 'a-catch-all'], ['/a/:x/:y', 'a-deep-params'])
    expect(matchPageByPath('/a/p/q', table)).toBe('a-deep-params')
  })

  it('平局按声明顺序取最早（deterministic）', () => {
    const table = pages(['/:a/:b', 'first'], ['/:c/:d', 'second'])
    expect(matchPageByPath('/x/y', table)).toBe('first')
  })

  it('大小写敏感、不做 decodeURI（参数段可含任意非 / 字符）', () => {
    const table = pages(['/Blog/:slug', 'BlogPage'], ['/blog/:slug', 'blog-post'])
    expect(matchPageByPath('/Blog/x', table)).toBe('BlogPage')
    expect(matchPageByPath('/blog/a%2Fb', table)).toBe('blog-post')
    expect(matchPageByPath('/blog/café.1', table)).toBe('blog-post')
    expect(matchPageByPath('/blog/a/b', table)).toBeNull()
  })
})
