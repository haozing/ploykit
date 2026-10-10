import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppShell } from '../AppShell'



const mocks = vi.hoisted(() => ({ impersonatedBy: undefined as string | undefined }))
vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      email: 'alice@example.com',
      display_name: 'Alice',
      impersonated_by: mocks.impersonatedBy,
    },
    workspaces: [],
    loading: false,
    refresh: vi.fn(),
    logout: vi.fn(async () => {}),
  }),
}))

const nav = [
  { path: '/app', label: '概览' },
  { path: '/realtime', label: '实时' },
]


function settingsContent() {
  return (
    <nav aria-label="设置导航侧栏">
      <a href="/app">返回产品</a>
      <ul>
        <li><a href="/settings/workspace/general">概况</a></li>
      </ul>
    </nav>
  )
}

function renderAt(path: string, withSettingsContent = true) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="*"
          element={(
            <AppShell
              brand="MyProduct"
              nav={nav}
              settingsContent={withSettingsContent ? settingsContent() : undefined}
            >
              <div>page-body</div>
            </AppShell>
          )}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AppShell 设置模式（IA v2）', () => {
  beforeEach(() => {
    mocks.impersonatedBy = undefined
  })

  it('产品路径：渲染产品 nav 项，不渲染 settingsContent', () => {
    renderAt('/app')
    expect(screen.queryByRole('link', { name: '返回产品' })).not.toBeInTheDocument()
    
    expect(screen.getAllByText('概览').length).toBeGreaterThan(0)
    expect(screen.getAllByText('实时').length).toBeGreaterThan(0)
  })

  it('/settings/*：侧栏切换为 settingsContent，产品 nav 隐藏，品牌保留', () => {
    renderAt('/settings/workspace/general')
    expect(screen.getByRole('link', { name: '返回产品' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '概况' })).toBeInTheDocument()
    expect(screen.queryByText('实时')).not.toBeInTheDocument()
    expect(screen.getByText('MyProduct')).toBeInTheDocument()
  })

  it('/account/*：同样进入设置模式', () => {
    renderAt('/account/profile')
    expect(screen.getByRole('link', { name: '返回产品' })).toBeInTheDocument()
    expect(screen.queryByText('实时')).not.toBeInTheDocument()
  })

  it('未传 settingsContent 时设置路径回退产品 nav', () => {
    renderAt('/settings/workspace/general', false)
    expect(screen.queryByRole('link', { name: '返回产品' })).not.toBeInTheDocument()

    expect(screen.getAllByText('实时').length).toBeGreaterThan(0)
  })
})

describe('AppShell 模拟会话横幅（ADR 0008）', () => {
  beforeEach(() => {
    mocks.impersonatedBy = undefined
  })

  it('impersonated_by 非空：内容区顶部持久显示警示条（顶栏之上）', () => {
    mocks.impersonatedBy = '11111111-2222-3333-4444-555555555555'
    const { container } = renderAt('/app')
    const banner = screen.getByText('您正处于管理员模拟会话')
    expect(banner).toBeInTheDocument()
    
    const bannerSlot = banner.closest('[data-slot="impersonation-banner"]')
    const header = container.querySelector('header')
    expect(bannerSlot).not.toBeNull()
    expect(header).not.toBeNull()
    expect(bannerSlot!.compareDocumentPosition(header!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('普通会话（impersonated_by 缺省）：不渲染警示条', () => {
    renderAt('/app')
    expect(screen.queryByText('您正处于管理员模拟会话')).not.toBeInTheDocument()
  })
})

describe('AppShell 地标结构（P3-23）', () => {
  it('全树唯一 <main> 地标（SidebarInset 承担），内容区滚动容器不再嵌套 main', () => {
    const { container } = renderAt('/app')
    
    expect(screen.getAllByRole('main')).toHaveLength(1)
    
    const scrollContainer = container.querySelector('main > div.flex-1.overflow-auto, [data-slot="sidebar-inset"] > div.overflow-auto')
    expect(scrollContainer).not.toBeNull()
    expect(scrollContainer!.textContent).toContain('page-body')
  })
})
