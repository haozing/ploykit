import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RouterTestHarness, useLocation } from '../../router'
import { UserMenu, type UserMenuExtraItem } from '../UserMenu'
import { Toaster } from '../toast'
import type { PKUser } from '../../provider/PloykitProvider'


const logout = vi.fn(async () => {})
const mocks = vi.hoisted(() => ({
  isPlatformAdmin: false,
  noProvider: false,
  // perm/permKey 过滤用例的当前工作区：null 模拟无 Provider（真实 useWorkspace
  // 无 PloykitProvider 时同步抛错，走 useWorkspaceRoleSafe 的 try/catch 回退）；
  // 非 null 即已挂 Provider 的 current（role / role_perms 按需给）。
  wsCurrent: null as
    | { id: string; name: string; slug: string; role?: string; role_perms?: string[] }
    | null,
}))
vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => {
    // noProvider 模拟无 PloykitProvider：真实 useAuthCtx 同步抛错。
    if (mocks.noProvider) throw new Error('must be used within PloykitProvider')
    return {
      user: {
        email: 'alice@example.com',
        display_name: 'Alice',
        avatar_url: undefined,
        is_platform_admin: mocks.isPlatformAdmin,
      } as PKUser,
      workspaces: [],
      loading: false,
      refresh: vi.fn(),
      logout,
    }
  },
}))
// 与 AppShell.test.tsx 同款路径 mock（经 @ploykit/hooks index re-export 生效）。
// wsCurrent === null 时与真实 useWorkspaceCtx 一样同步抛错——无 Provider 回退路径。
vi.mock('../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => {
    if (mocks.wsCurrent === null) {
      throw new Error('must be used within PloykitProvider')
    }
    return { current: mocks.wsCurrent, switchTo: vi.fn(), clear: vi.fn() }
  },
}))

// 路径探针：替代 react-router 的 <Routes>/<Route> 标记页。Toaster 在路由
// 分支外常驻：logout 失败兜底用例断言 toast 文案实际可见（若随切换路由
// 卸载，跳转后 toast 不再渲染）。
function TestRoutes() {
  const { pathname } = useLocation()
  let page: React.ReactNode
  switch (pathname) {
    case '/login':
      page = <div>login-page</div>
      break
    case '/account/profile':
      page = <div>account-profile-page</div>
      break
    case '/account/notifications':
      page = <div>notifications-page</div>
      break
    case '/admin':
      page = <div>admin-page</div>
      break
    default:
      page = <UserMenu />
  }
  return (
    <>
      <Toaster />
      {page}
    </>
  )
}

// TanStack Router 的首次挂载是异步的（match + commit 走 microtask），
// render 后需要一次 act flush 才能断言同步 getByRole。
async function renderAt(path: string) {
  const result = render(
    <RouterTestHarness initialEntries={[path]}>
      <TestRoutes />
    </RouterTestHarness>,
  )
  await act(async () => {})
  return result
}

describe('UserMenu', () => {
  beforeEach(() => {
    logout.mockClear()
    mocks.isPlatformAdmin = false
    mocks.noProvider = false
  })

  it('渲染头像 initials fallback', async () => {
    await renderAt('/app')
    expect(screen.getByRole('button', { name: '用户菜单' })).toHaveTextContent('A')
  })

  it('默认项：账户设置（→/account/profile）；普通用户无管理控制台', async () => {
    await renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '账户设置' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '管理控制台' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '个人设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '通知偏好' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeVisible()
  })

  it('账户设置点击跳 /account/profile', async () => {
    await renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '账户设置' }))
    await waitFor(() => expect(screen.getByText('account-profile-page')).toBeInTheDocument())
  })

  it('is_platform_admin：出现管理控制台（→/admin）', async () => {
    mocks.isPlatformAdmin = true
    await renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '管理控制台' }))
    await waitFor(() => expect(screen.getByText('admin-page')).toBeInTheDocument())
  })

  it('退出登录调用 logout 并跳 /login', async () => {
    await renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }))
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('login-page')).toBeInTheDocument())
  })

  it('P3-11：logout 抛错不困死用户——toast 提示失败仍照常跳转登录页', async () => {
    logout.mockRejectedValueOnce(new Error('network down'))
    await renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }))
    
    expect(await screen.findByText('退出登录失败，请稍后在登录页重试')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('login-page')).toBeInTheDocument())
  })

  it('无 Provider（useAuth 抛错）：渲染空，不抛错（AppShell 不强制 Provider）', async () => {
    mocks.noProvider = true
    const { container } = await renderAt('/app')
    expect(screen.queryByRole('button', { name: '用户菜单' })).not.toBeInTheDocument()
    expect(container.querySelector('[data-slot="dropdown-menu-trigger"]')).not.toBeInTheDocument()
  })

  it('labels 覆盖：自定义文案替换默认中文（菜单项 / aria-label / 失败 toast）', async () => {
    render(
      <RouterTestHarness initialEntries={['/app']}>
        <UserMenu
          labels={{
            accountSettings: 'Account settings',
            logout: 'Sign out',
            userMenuAria: 'User menu',
            logoutFailedToast: 'Sign-out failed',
          }}
        />
        <Toaster />
      </RouterTestHarness>,
    )
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    expect(await screen.findByRole('menuitem', { name: 'Account settings' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '账户设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '退出登录' })).not.toBeInTheDocument()

    logout.mockRejectedValueOnce(new Error('network down'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    // sonner 的 toast store 是模块级全局、跨用例保留，故只断言覆盖文案上屏，
    // 不断言默认文案缺席。
    expect(await screen.findByText('Sign-out failed')).toBeInTheDocument()
  })
})

describe('UserMenu 面板条目权限过滤（perm / permKey）', () => {
  const gatedItems: UserMenuExtraItem[] = [
    { label: '计费账单', to: '/settings/workspace/billing', permKey: 'billing:read' },
    { label: '工作区设置', to: '/settings/workspace', permKey: 'workspace:read' },
    { label: '成员管理', to: '/settings/workspace/members', perm: 'owner' },
    { label: '通知偏好', to: '/account/notifications' },
  ]

  async function renderWithItems(items: UserMenuExtraItem[]) {
    const result = render(
      <RouterTestHarness initialEntries={['/app']}>
        <UserMenu items={items} />
        <Toaster />
      </RouterTestHarness>,
    )
    await act(async () => {})
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    await screen.findByRole('menu')
    return result
  }

  beforeEach(() => {
    logout.mockClear()
    mocks.isPlatformAdmin = false
    mocks.noProvider = false
    mocks.wsCurrent = null
  })

  it('role_perms 已知且不含键：permKey 项隐藏，含键的项显示，无门控项不受影响', async () => {
    mocks.wsCurrent = {
      id: 'ws-1', name: 'Acme', slug: 'acme',
      role: 'member', role_perms: ['workspace:read', 'members:read'],
    }
    await renderWithItems(gatedItems)
    expect(screen.queryByRole('menuitem', { name: '计费账单' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '工作区设置' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '通知偏好' })).toBeVisible()
  })

  it('role_perms 已知且含键：permKey 项显示', async () => {
    mocks.wsCurrent = {
      id: 'ws-1', name: 'Acme', slug: 'acme',
      role: 'member', role_perms: ['billing:read'],
    }
    await renderWithItems(gatedItems)
    expect(screen.getByRole('menuitem', { name: '计费账单' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '工作区设置' })).not.toBeInTheDocument()
  })

  it('role_perms 缺失（旧载荷）：permKey 项默认显示（向后兼容）', async () => {
    mocks.wsCurrent = { id: 'ws-1', name: 'Acme', slug: 'acme', role: 'member' }
    await renderWithItems(gatedItems)
    expect(screen.getByRole('menuitem', { name: '计费账单' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '工作区设置' })).toBeVisible()
  })

  it('无 Provider：rolePerms 未知，permKey 项同样默认显示', async () => {
    // wsCurrent=null → mock 同步抛错，走 useWorkspaceRoleSafe 的 try/catch 回退
    await renderWithItems(gatedItems)
    expect(screen.getByRole('menuitem', { name: '计费账单' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '工作区设置' })).toBeVisible()
  })

  it('perm: owner — member 隐藏（角色级门控）', async () => {
    mocks.wsCurrent = { id: 'ws-1', name: 'Acme', slug: 'acme', role: 'member', role_perms: [] }
    await renderWithItems(gatedItems)
    expect(screen.queryByRole('menuitem', { name: '成员管理' })).not.toBeInTheDocument()
    // 未门控项照常渲染
    expect(screen.getByRole('menuitem', { name: '通知偏好' })).toBeVisible()
  })

  it('perm: owner — owner 显示，admin 不满足（九宫格）', async () => {
    mocks.wsCurrent = { id: 'ws-1', name: 'Acme', slug: 'acme', role: 'owner', role_perms: [] }
    const first = await renderWithItems(gatedItems)
    expect(screen.getByRole('menuitem', { name: '成员管理' })).toBeVisible()
    first.unmount()

    mocks.wsCurrent = { id: 'ws-1', name: 'Acme', slug: 'acme', role: 'admin', role_perms: [] }
    await renderWithItems(gatedItems)
    expect(screen.queryByRole('menuitem', { name: '成员管理' })).not.toBeInTheDocument()
  })
})
