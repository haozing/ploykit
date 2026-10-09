
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { routeTable } from '../routes'

function Landing() {
  return <div>landing-body</div>
}
function BlogPost(props: { title?: string }) {
  return <article>{props?.title ?? 'post-body'}</article>
}
function Dashboard() {
  return <div>dash-body</div>
}

function buildTable() {
  return routeTable({
    '/': { component: Landing, render: 'static' },
    '/blog/:slug': { component: BlogPost, render: 'static' },
    '/app': { component: Dashboard },
  })
}

const projection = (t: ReturnType<typeof buildTable>) =>
  t.pages.map(({ path, pageId, render }) => ({ path, pageId, render }))

describe('routeTable pageId 稳定性', () => {
  it('同声明序两次生成：pageId/投影逐字段一致（构建期与运行期对账前提）', () => {
    const a = buildTable()
    const b = buildTable()
    expect(projection(b)).toEqual(projection(a))
    expect(b.toJSON()).toBe(a.toJSON())
  })

  it('pageId 由组件名 kebab 生成（BlogPost → blog-post），render 缺省 csr', () => {
    const pages = Object.fromEntries(buildTable().pages.map((p) => [p.path, p]))
    expect(pages['/'].pageId).toBe('landing')
    expect(pages['/blog/:slug'].pageId).toBe('blog-post')
    expect(pages['/blog/:slug'].render).toBe('static')
    expect(pages['/app'].render).toBe('csr')
  })

  it('匿名组件回退路径静态段；同名组件按声明序去重（-2 后缀）', () => {
    const anon = () => <div />
    Object.defineProperty(anon, 'name', { value: '' })
    const dup1 = () => <div />
    const dup2 = () => <div />
    Object.defineProperty(dup1, 'name', { value: 'Same' })
    Object.defineProperty(dup2, 'name', { value: 'Same' })

    const t = routeTable({
      '/x/anon': { component: anon },
      '/a': { component: dup1 },
      '/b': { component: dup2 },
    })
    expect(projection(t)).toEqual([
      { path: '/x/anon', pageId: 'x-anon', render: 'csr' },
      { path: '/a', pageId: 'same', render: 'csr' },
      { path: '/b', pageId: 'same-2', render: 'csr' },
    ])
  })

  it('toJSON 投影不含组件引用（Go 侧消费 {path, pageId, render}）', () => {
    expect(JSON.parse(buildTable().toJSON())).toEqual([
      { path: '/', pageId: 'landing', render: 'static' },
      { path: '/blog/:slug', pageId: 'blog-post', render: 'static' },
      { path: '/app', pageId: 'dashboard', render: 'csr' },
    ])
  })
})

describe('routeTable routes() 树', () => {
  it('props 按 pageId 注入对应组件（SSR 同款：路由命中 BlogPost 并吃到 Loader 数据）', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/blog/hello']}>
        {buildTable().routes({ 'blog-post': { title: 'Hello-SSR' } })}
      </MemoryRouter>,
    )
    expect(html).toContain('Hello-SSR')
    expect(html).toContain('<article>')
  })

  it('不传 props：组件用缺省 props 渲染（SPA 同款）', () => {
    const html = renderToString(
      <MemoryRouter initialEntries={['/blog/hello']}>{buildTable().routes()}</MemoryRouter>,
    )
    expect(html).toContain('post-body')
  })
})
