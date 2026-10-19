import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RouterTestHarness, useLocation } from '../../router'
import { UserMenu } from '../UserMenu'
import { Toaster } from '../toast'
import type { PKUser } from '../../provider/PloykitProvider'


const logout = vi.fn(async () => {})
const mocks = vi.hoisted(() => ({ isPlatformAdmin: false, noProvider: false }))
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
