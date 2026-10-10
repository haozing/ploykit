import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { UserMenu } from '../UserMenu'
import { Toaster } from '../toast'
import type { PKUser } from '../../provider/PloykitProvider'


const logout = vi.fn(async () => {})
const mocks = vi.hoisted(() => ({ isPlatformAdmin: false }))
vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({
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
  }),
}))

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      {/* Toaster 在路由外常驻：logout 失败兜底用例断言 toast 文案实际可见
          （若随切换路由卸载，跳转后 toast 不再渲染） */}
      <Toaster />
      <Routes>
        <Route path="/login" element={<div>login-page</div>} />
        <Route path="/account/profile" element={<div>account-profile-page</div>} />
        <Route path="/account/notifications" element={<div>notifications-page</div>} />
        <Route path="/admin" element={<div>admin-page</div>} />
        <Route path="*" element={<UserMenu />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('UserMenu', () => {
  beforeEach(() => {
    logout.mockClear()
    mocks.isPlatformAdmin = false
  })

  it('渲染头像 initials fallback', () => {
    renderAt('/app')
    expect(screen.getByRole('button', { name: '用户菜单' })).toHaveTextContent('A')
  })

  it('默认项：账户设置（→/account/profile）；普通用户无管理控制台', async () => {
    renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '账户设置' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '管理控制台' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '个人设置' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '通知偏好' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeVisible()
  })

  it('账户设置点击跳 /account/profile', async () => {
    renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '账户设置' }))
    await waitFor(() => expect(screen.getByText('account-profile-page')).toBeInTheDocument())
  })

  it('is_platform_admin：出现管理控制台（→/admin）', async () => {
    mocks.isPlatformAdmin = true
    renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '管理控制台' }))
    await waitFor(() => expect(screen.getByText('admin-page')).toBeInTheDocument())
  })

  it('退出登录调用 logout 并跳 /login', async () => {
    renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }))
    await waitFor(() => expect(logout).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('login-page')).toBeInTheDocument())
  })

  it('P3-11：logout 抛错不困死用户——toast 提示失败仍照常跳转登录页', async () => {
    logout.mockRejectedValueOnce(new Error('network down'))
    renderAt('/app')
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '退出登录' }))
    
    expect(await screen.findByText('退出登录失败，请稍后在登录页重试')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('login-page')).toBeInTheDocument())
  })
})
