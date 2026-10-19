import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterTestHarness } from '../../router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AppShell } from '../AppShell'



const mocks = vi.hoisted(() => ({
  impersonatedBy: undefined as string | undefined,
  // permKey 过滤用例的当前工作区：null 模拟无 Provider（真实 useWorkspace 无
  // PloykitProvider 时同步抛错，走 AppShell 的 try/catch 回退）；非 null 即已挂
  // Provider 的 current（role / role_perms 按需给）。
  wsCurrent: null as
    | { id: string; name: string; slug: string; role?: string; role_perms?: string[] }
    | null,
}))
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

// 与 SettingsShell.test.tsx 同款路径 mock（经 @ploykit/hooks index re-export 生效）。
// wsCurrent === null 时与真实 useWorkspaceCtx 一样同步抛错——存量用例的无 Provider
// 回退路径逐字节不变（role/rolePerms 均为 undefined）。
vi.mock('../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => {
    if (mocks.wsCurrent === null) {
      throw new Error('must be used within PloykitProvider')
    }
    return { current: mocks.wsCurrent, switchTo: vi.fn(), clear: vi.fn() }
  },
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

// RouterTestHarness 底下的 tanstack RouterProvider 首帧为 pending（初始 load 异步
// 完成）——渲染后等 page-body 上屏再返回。
async function renderAt(path: string, withSettingsContent = true) {
  const result = render(
    <RouterTestHarness initialEntries={[path]}>
      {/* 旧 <Route path="*">（catch-all）：harness 本身即 catch-all，直接渲染 AppShell */}
      <AppShell
        brand="MyProduct"
        nav={nav}
        settingsContent={withSettingsContent ? settingsContent() : undefined}
      >
        <div>page-body</div>
      </AppShell>
    </RouterTestHarness>,
  )
  await waitFor(() => expect(screen.queryAllByText('page-body').length).toBeGreaterThan(0))
  return result
}

describe('AppShell 设置模式（IA v2）', () => {
  beforeEach(() => {
    mocks.impersonatedBy = undefined
  })

  it('产品路径：渲染产品 nav 项，不渲染 settingsContent', async () => {
    await renderAt('/app')
    expect(screen.queryByRole('link', { name: '返回产品' })).not.toBeInTheDocument()
    
    expect(screen.getAllByText('概览').length).toBeGreaterThan(0)
    expect(screen.getAllByText('实时').length).toBeGreaterThan(0)
  })

  it('/settings/*：侧栏切换为 settingsContent，产品 nav 隐藏，品牌保留', async () => {
    await renderAt('/settings/workspace/general')
    expect(screen.getByRole('link', { name: '返回产品' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '概况' })).toBeInTheDocument()
    expect(screen.queryByText('实时')).not.toBeInTheDocument()
    expect(screen.getByText('MyProduct')).toBeInTheDocument()
  })

  it('/account/*：同样进入设置模式', async () => {
    await renderAt('/account/profile')
    expect(screen.getByRole('link', { name: '返回产品' })).toBeInTheDocument()
    expect(screen.queryByText('实时')).not.toBeInTheDocument()
  })

  it('未传 settingsContent 时设置路径回退产品 nav', async () => {
    await renderAt('/settings/workspace/general', false)
    expect(screen.queryByRole('link', { name: '返回产品' })).not.toBeInTheDocument()

    expect(screen.getAllByText('实时').length).toBeGreaterThan(0)
  })
})

describe('AppShell 模拟会话横幅（ADR 0008）', () => {
  beforeEach(() => {
    mocks.impersonatedBy = undefined
  })

  it('impersonated_by 非空：内容区顶部持久显示警示条（顶栏之上）', async () => {
    mocks.impersonatedBy = '11111111-2222-3333-4444-555555555555'
    const { container } = await renderAt('/app')
    const banner = screen.getByText('您正处于管理员模拟会话')
    expect(banner).toBeInTheDocument()
    
    const bannerSlot = banner.closest('[data-slot="impersonation-banner"]')
    const header = container.querySelector('header')
    expect(bannerSlot).not.toBeNull()
    expect(header).not.toBeNull()
    expect(bannerSlot!.compareDocumentPosition(header!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('普通会话（impersonated_by 缺省）：不渲染警示条', async () => {
    await renderAt('/app')
    expect(screen.queryByText('您正处于管理员模拟会话')).not.toBeInTheDocument()
  })
})

describe('AppShell 地标结构（P3-23）', () => {
  it('全树唯一 <main> 地标（SidebarInset 承担），内容区滚动容器不再嵌套 main', async () => {
    const { container } = await renderAt('/app')

    expect(screen.getAllByRole('main')).toHaveLength(1)
    
    const scrollContainer = container.querySelector('main > div.flex-1.overflow-auto, [data-slot="sidebar-inset"] > div.overflow-auto')
    expect(scrollContainer).not.toBeNull()
    expect(scrollContainer!.textContent).toContain('page-body')
  })
})


describe('AppShell 侧栏增强（自 stock 镜像化后上提至组合层）', () => {
  const sidebarState = () => document.querySelector('[data-slot="sidebar"]')?.getAttribute('data-state')

  it('P2-17：sidebar_state=false cookie → 初值折叠（stock provider 只写不读，回读在组合层）', async () => {
    document.cookie = 'sidebar_state=false; path=/'
    await renderAt('/app', false)
    expect(sidebarState()).toBe('collapsed')
    document.cookie = 'sidebar_state=; path=/; max-age=0'
  })

  it('P2-17：无 cookie → 默认展开', async () => {
    document.cookie = 'sidebar_state=; path=/; max-age=0'
    await renderAt('/app', false)
    expect(sidebarState()).toBe('expanded')
  })

  it('P3-1：输入焦点时 Ctrl+B 不折叠侧栏（捕获阶段拦截 stock 全局监听）', async () => {
    render(
      <RouterTestHarness initialEntries={['/app']}>
        <AppShell brand="MyProduct" nav={nav}>
          <input aria-label="输入框" />
        </AppShell>
      </RouterTestHarness>,
    )
    await waitFor(() => expect(screen.getByRole('textbox', { name: '输入框' })).toBeInTheDocument())
    expect(sidebarState()).toBe('expanded')
    const input = screen.getByRole('textbox', { name: '输入框' })
    fireEvent.keyDown(input, { key: 'b', ctrlKey: true })
    expect(sidebarState()).toBe('expanded')
  })
})

describe('AppShell permKey 细粒度权限过滤（role_perms 集合门控）', () => {
  const permNav = [
    { path: '/app', label: '概览' },
    { path: '/workspace', label: '工作区', permKey: 'workspace:read' },
    { path: '/billing', label: '计费', permKey: 'billing:read' },
  ]

  async function renderPermNav() {
    const result = render(
      <RouterTestHarness initialEntries={['/app']}>
        <AppShell brand="MyProduct" nav={permNav}>
          <div>page-body</div>
        </AppShell>
      </RouterTestHarness>,
    )
    await waitFor(() => expect(screen.queryAllByText('page-body').length).toBeGreaterThan(0))
    return result
  }

  beforeEach(() => {
    mocks.wsCurrent = null
  })

  it('role_perms 已知：集合含该键的项渲染，不含的隐藏（owner 不特判，纯集合包含）', async () => {
    mocks.wsCurrent = {
      id: 'ws-1',
      name: 'Acme',
      slug: 'acme',
      role: 'member',
      role_perms: ['workspace:read', 'members:read'],
    }
    await renderPermNav()
    expect(screen.getAllByText('概览').length).toBeGreaterThan(0)
    expect(screen.getAllByText('工作区').length).toBeGreaterThan(0)
    expect(screen.queryByText('计费')).not.toBeInTheDocument()
  })

  it('role_perms 缺失（旧载荷）：permKey 项默认显示（向后兼容）', async () => {
    mocks.wsCurrent = { id: 'ws-1', name: 'Acme', slug: 'acme', role: 'member' }
    await renderPermNav()
    expect(screen.getAllByText('工作区').length).toBeGreaterThan(0)
    expect(screen.getAllByText('计费').length).toBeGreaterThan(0)
  })

  it('无 Provider 回退路径：rolePerms 未知，permKey 项同样默认显示', async () => {
    // wsCurrent=null → mock 同步抛错，走 AppShell try/catch（与真实无 Provider 等价）
    await renderPermNav()
    expect(screen.getAllByText('计费').length).toBeGreaterThan(0)
    expect(screen.getAllByText('工作区').length).toBeGreaterThan(0)
  })
})
