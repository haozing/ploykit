
import { renderToString } from 'react-dom/server'
import * as React from 'react'
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingChecklist } from '../../components/OnboardingChecklist'
import { PloykitProvider } from '@ploykit/hooks'
import { LandingPage } from '../LandingPage'
import { LoginPage } from '../LoginPage'

// SSR 冒烟不走 RouterTestHarness：RouterProvider 在同步 renderToString 里处于
// pending（初始 load 未完成），只会吐出 <!--$--><!--/$-->。按 tanstack 官方 SSR
// 流程先 await router.load() 再渲染——这正是消费方 entry-server 的接线形态。
async function ssrRenderAt(path: string, children: React.ReactNode): Promise<string> {
  const childrenSlot = { current: children }
  const rootRoute = createRootRoute({ component: () => childrenSlot.current })
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => childrenSlot.current })
  const catchAllRoute = createRoute({ getParentRoute: () => rootRoute, path: '$', component: () => childrenSlot.current })
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, catchAllRoute]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  return withPoisonedStorage(() => renderToString(React.createElement(RouterProvider, { router })))
}



vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { email: 'ssr@example.com', display_name: 'SSR' },
    workspaces: [{ id: 'ws-1', name: 'Acme' }],
    loading: false,
    error: null,
    refresh: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
  }),
}))



const touched: string[] = []

function poison(name: string): () => void {
  const desc = Object.getOwnPropertyDescriptor(globalThis, name)
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get() {
      touched.push(name)
      throw new Error(`[SSR 冒烟] 渲染期访问了浏览器 API：${name}`)
    },
  })
  return () => {
    if (desc) Object.defineProperty(globalThis, name, desc)
    else delete (globalThis as Record<string, unknown>)[name]
  }
}

function withPoisonedStorage(render: () => string): string {
  const restore = ['localStorage', 'sessionStorage'].map(poison)
  try {
    return render()
  } finally {
    restore.forEach((r) => r())
  }
}

const landingProps = {
  brand: 'PloykitSmoke',
  tagline: '构建快',
  description: '冒烟落地页',
  features: [{ icon: '⚡', title: '快', desc: '很快' }],
  plans: [{ name: 'Free', price: '¥0', features: ['a'], cta: '注册' }],
}

describe('ui 包 SSR 渲染冒烟（R2：渲染期禁摸浏览器 API）', () => {
  it('LandingPage（tanstack memory router 内）：输出非空且不摸存储 API', async () => {
    const html = await ssrRenderAt('/', <LandingPage {...landingProps} />)
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('PloykitSmoke')
    expect(touched).toEqual([])
  })

  it('LoginPage（PloykitProvider + tanstack memory router 内）：输出非空且不摸存储 API', async () => {
    const html = await ssrRenderAt(
      '/login',
      React.createElement(PloykitProvider, null, <LoginPage />),
    )
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('登录')
    expect(touched).toEqual([])
  })

  it('OnboardingChecklist（R2 回归对象）：渲染期不读 localStorage，输出非空', () => {
    const html = withPoisonedStorage(() =>
      renderToString(
        <OnboardingChecklist items={[{ key: 'a', label: '冒烟引导项', done: false }]} />,
      ),
    )
    
    
    expect(html).toContain('冒烟引导项')
    expect(touched).toEqual([])
  })
})
