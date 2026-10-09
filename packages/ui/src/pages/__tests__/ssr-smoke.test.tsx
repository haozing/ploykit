
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { OnboardingChecklist } from '../../components/OnboardingChecklist'
import { PloykitProvider } from '../../provider/PloykitProvider'
import { LandingPage } from '../LandingPage'
import { LoginPage } from '../LoginPage'



vi.mock('../../hooks/useAuth', () => ({
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
  it('LandingPage（MemoryRouter 内）：输出非空且不摸存储 API', () => {
    const html = withPoisonedStorage(() =>
      renderToString(
        <MemoryRouter>
          <LandingPage {...landingProps} />
        </MemoryRouter>,
      ),
    )
    expect(html.length).toBeGreaterThan(0)
    expect(html).toContain('PloykitSmoke')
    expect(touched).toEqual([])
  })

  it('LoginPage（PloykitProvider + MemoryRouter 内）：输出非空且不摸存储 API', () => {
    const html = withPoisonedStorage(() =>
      renderToString(
        <PloykitProvider>
          <MemoryRouter>
            <LoginPage />
          </MemoryRouter>
        </PloykitProvider>,
      ),
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
