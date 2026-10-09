
import { beforeEach, describe, expect, it } from 'vitest'
import { emitDirective } from '../browser'

beforeEach(() => {
  document.title = ''
  document.head.querySelectorAll('meta[name],meta[property]').forEach((el) => el.remove())
})

describe('emitDirective（浏览器分支）', () => {
  it('title 写入 document.title；meta 按 name/property 落位', () => {
    emitDirective('head', [
      { tag: 'title', children: '首页' },
      { tag: 'meta', attrs: { name: 'description', content: '描述' } },
      { tag: 'meta', attrs: { property: 'og:image', content: '/og.png' } },
    ])
    expect(document.title).toBe('首页')
    expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('描述')
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe('/og.png')
  })

  it('重复发射增量更新：同名 meta 不重复追加，content 原位更新', () => {
    emitDirective('head', [{ tag: 'meta', attrs: { name: 'description', content: 'v1' } }])
    emitDirective('head', [{ tag: 'meta', attrs: { name: 'description', content: 'v2' } }])
    const metas = document.head.querySelectorAll('meta[name="description"]')
    expect(metas.length).toBe(1)
    expect(metas[0].getAttribute('content')).toBe('v2')
  })

  it('SPA 导航换页：title 覆写不残留', () => {
    emitDirective('head', [{ tag: 'title', children: 'A页' }])
    emitDirective('head', [{ tag: 'title', children: 'B页' }])
    expect(document.title).toBe('B页')
  })

  it('status 在浏览器端静默忽略（v1 仅服务端记录）', () => {
    expect(() => emitDirective('status', { code: 404 })).not.toThrow()
  })
})

describe('P3-63 补测：upsertOther（link 等非身份键标签）', () => {
  it('link 首次追加、tag+attrs 全等去重、children 写入且不重复', () => {
    document.head.innerHTML = ''
    emitDirective('head', [{ tag: 'link', attrs: { rel: 'canonical', href: '/x' } }])
    const first = document.head.querySelector('link[rel="canonical"]')
    expect(first?.getAttribute('href')).toBe('/x')

    
    emitDirective('head', [{ tag: 'link', attrs: { rel: 'canonical', href: '/x' } }])
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(1)

    
    emitDirective('head', [{ tag: 'link', attrs: { rel: 'canonical', href: '/y' } }])
    expect(document.head.querySelectorAll('link[rel="canonical"]')).toHaveLength(2)

    
    emitDirective('head', [{ tag: 'style', children: 'body{color:red}' }])
    expect(document.head.querySelector('style')?.textContent).toBe('body{color:red}')
  })
})
