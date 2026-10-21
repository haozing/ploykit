// router-tanstack 子路径的版本钉死回归哨兵：本文件锁住 renderx PoC 验证过的
// 全部脆弱面（VERDICT.md「fragility register」）——
//   1. populateSync 依赖的 router 内部（matchRoutes/stores/_committed/batch）
//      —— tanstack 升级改名时这里先红，而不是所有产品的 SSR 白屏；
//   2. package.json 的精确 pin（无 caret）；
//   3. 组装器对两条路由渲染出各自命中的内容 + matchTanstackPage 的 pathname
//      → pageId 映射（镜像 router-react-router 的 router 无关测试风格）。
// 注意：本文件 import '@tanstack/react-router' 是被测面本身，不受主桶
// router 无关哨兵（router-agnostic.test.tsx）约束。
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { routeTable } from '../routes'
import {
  ESBUILD_ALIASES,
  matchTanstackPage,
  PRELUDE_SHIMS,
  setTanstackSsrLocation,
  SSR_LOCATION_KEY,
  tanstackAssembler,
  TANSTACK_PINNED_VERSION,
} from '../router-tanstack'

const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..')

function Home({ marker }: { marker?: string }) {
  return (
    <h1>
      home-content{marker ? <i data-marker={marker}>:{marker}</i> : null}
    </h1>
  )
}

function Work() {
  return <p>work-page-content</p>
}

const table = routeTable(
  {
    '/': { component: Home, render: 'static' },
    '/works/:slug': { component: Work, render: 'static' },
  },
  tanstackAssembler(),
)

// createSsrEntry 的真实接线顺序：routes 元素先建，wrap 记录 SSR 位置，然后
// 才 renderToString（TanstackRouterMount 在渲染期读取）。这里复刻该顺序。
function ssrRender(routesElement: React.ReactNode, location: string): string {
  setTanstackSsrLocation(location) // = entry-server 的 wrap(children, loc)
  return renderToString(routesElement)
}

describe('@ploykit/runtime/router-tanstack（版本钉死哨兵）', () => {
  it('package.json 将 @tanstack/react-router 精确 pin 在 TANSTACK_PINNED_VERSION（无 caret）', () => {
    const manifest = JSON.parse(readFileSync(join(srcDir, '..', 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }
    expect(TANSTACK_PINNED_VERSION).toBe('1.170.45')
    expect(manifest.dependencies['@tanstack/react-router']).toBe(TANSTACK_PINNED_VERSION)
  })

  it('组装器 routes() 对 / 渲染首页内容（loader 无关路由同步出匹配链）', () => {
    const html = ssrRender(table.routes(), '/')
    expect(html).toContain('home-content')
    expect(html).not.toContain('work-page-content')
  })

  it('组装器 routes() 对 /works/xxx 渲染参数页内容（路由互斥，非逐页平铺）', () => {
    const html = ssrRender(table.routes(), '/works/xxx')
    expect(html).toContain('work-page-content')
    expect(html).not.toContain('home-content')
  })

  it('matchTanstackPage：pathname → 拥页 pageId（字面量 path 模式，压缩后两端一致）', () => {
    expect(table.pages.map((p) => p.pageId)).toEqual(['home', 'work'])
    expect(matchTanstackPage('/', table.pages)).toBe('home')
    expect(matchTanstackPage('/works/hello', table.pages)).toBe('work')
    expect(matchTanstackPage('/nope', table.pages)).toBeNull()
  })

  it('propsByPageId 按 pageId 注入对应页面（水合数据通道）', () => {
    const html = ssrRender(table.routes({ home: { marker: 'from-ssr' } }), '/')
    expect(html).toContain('data-marker="from-ssr"')
  })

  it('连续两次渲染互不串味（memory-history router 每渲染新建，PoC longevity 断言）', () => {
    expect(ssrRender(table.routes(), '/works/one')).toContain('work-page-content')
    expect(ssrRender(table.routes(), '/')).toContain('home-content')
    expect(ssrRender(table.routes(), '/works/two')).toContain('work-page-content')
  })

  // 回归：lazyPage 的 preload 钩子必须转发（否则 defaultPreload 静默失效），
  // 但转发行为本身会让 router-core 的 routeNeedsLoad 认定该路由"需要加载"，
  // match 状态变 pending → Match 渲染 pending 分支（无 pendingComponent 即空白）
  // → 整页白屏、路由 chunk 从不被请求。两件事必须同时成立：
  // 钩子可达 + 首帧照常渲染。这条锁住后者。
  it('带 preload 钩子的懒组件仍能同步渲染出内容（不得落入 pending 分支）', () => {
    const LazyLike = () => <p>lazy-like-content</p>
    ;(LazyLike as typeof LazyLike & { preload?: () => void }).preload = () => {}

    const preloadTable = routeTable(
      { '/lazy': { component: LazyLike, render: 'static' } },
      tanstackAssembler(),
    )
    expect(ssrRender(preloadTable.routes(), '/lazy')).toContain('lazy-like-content')
  })

  it('ESBUILD_ALIASES 把 router-core 的 isServer 重定向到 server 变体（沙箱 window 探针消除）', () => {
    expect(ESBUILD_ALIASES['@tanstack/router-core/isServer']).toContain('/isServer/server')
  })

  it('PRELUDE_SHIMS：URLSearchParams + AbortController 两个 shim，均带 typeof 守卫与 PoC 语义', () => {
    expect(PRELUDE_SHIMS).toContain("typeof globalThis.URLSearchParams === 'undefined'")
    expect(PRELUDE_SHIMS).toContain("typeof globalThis.AbortController === 'undefined'")
    expect(PRELUDE_SHIMS).toContain('AbortController.prototype.abort')
    // 无 backtick：Go 侧 raw string 镜像（example/internal/webrender）可直接内嵌
    expect(PRELUDE_SHIMS).not.toContain('`')
  })

  it('SSR 位置通道：未设置时回落 /，设置后全局可读（单线程同步渲染下安全）', () => {
    delete (globalThis as Record<string, unknown>)[SSR_LOCATION_KEY]
    setTanstackSsrLocation('/x')
    expect((globalThis as Record<string, unknown>)[SSR_LOCATION_KEY]).toBe('/x')
  })
})

// TanStack's default search serializer JSON-quotes digit-only values
// (?mpage=%222%22) — pagination silently breaks on the first interaction.
// The assembler wires the plain-string pair into every router it creates;
// these helpers are exported so host applications can wire the same contract.
describe('plain-string search serialization', () => {
  it('numeric values serialize without JSON quotes', async () => {
    const { rawStringifySearch, rawParseSearch } = await import('../router-tanstack')
    expect(rawStringifySearch({ mpage: 2, q: 'x' })).toBe('?mpage=2&q=x')
    expect(rawStringifySearch({ page: '3' })).toBe('?page=3')
    expect(rawStringifySearch({})).toBe('')
    expect(rawParseSearch('?mpage=2')).toEqual({ mpage: '2' })
    // round-trip
    expect(rawParseSearch(rawStringifySearch({ page: 7 }))).toEqual({ page: '7' })
    // the old default would have produced %22-quoted digits
    expect(rawStringifySearch({ mpage: 2 })).not.toContain('%22')
  })
})
