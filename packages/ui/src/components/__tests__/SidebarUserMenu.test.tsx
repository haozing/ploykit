import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RouterTestHarness } from '../../router'
import { SidebarProvider } from '../ui/sidebar'
import { SidebarUserMenu } from '../SidebarUserMenu'
import type { UserMenuExtraItem } from '../UserMenu'

const logout = vi.fn(async () => {})
const mocks = vi.hoisted(() => ({
  noProvider: false,
  // perm/permKey 过滤用例的当前工作区：null 模拟无 Provider（真实 useWorkspace
  // 无 PloykitProvider 时同步抛错，走 useWorkspaceRoleSafe 的 try/catch 回退）。
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
        is_platform_admin: false,
      },
      workspaces: [],
      loading: false,
      refresh: vi.fn(),
      logout,
    }
  },
}))
// 与 AppShell.test.tsx 同款路径 mock（经 @ploykit/hooks index re-export 生效）。
vi.mock('../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => {
    if (mocks.wsCurrent === null) {
      throw new Error('must be used within PloykitProvider')
    }
    return { current: mocks.wsCurrent, switchTo: vi.fn(), clear: vi.fn() }
  },
}))

async function renderMenu(
  labels?: { accountSettings?: string; logout?: string; userMenuAria?: string; logoutFailedToast?: string },
  items?: UserMenuExtraItem[],
) {
  const result = render(
    <RouterTestHarness initialEntries={['/app']}>
      <SidebarProvider>
        <SidebarUserMenu labels={labels} items={items} />
      </SidebarProvider>
    </RouterTestHarness>,
  )
  await act(async () => {})
  return result
}

describe('SidebarUserMenu', () => {
  beforeEach(() => {
    logout.mockClear()
    mocks.noProvider = false
    mocks.wsCurrent = null
    document.cookie = 'sidebar_state=; path=/; max-age=0'
  })

  it('默认渲染：用户卡 + 菜单项为内置中文', async () => {
    await renderMenu()
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    expect(await screen.findByRole('menu')).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: '账户设置' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '退出登录' })).toBeVisible()
  })

  it('无 Provider（useAuth 抛错）：渲染空，不抛错（AppShell 不强制 Provider）', async () => {
    mocks.noProvider = true
    await renderMenu()
    expect(screen.queryByRole('button', { name: '用户菜单' })).not.toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('labels 覆盖：自定义文案替换默认中文（aria-label + 退出登录）', async () => {
    await renderMenu({ logout: 'Sign out', userMenuAria: 'User menu' })
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '退出登录' })).not.toBeInTheDocument()
  })
})

describe('SidebarUserMenu 面板条目权限过滤（perm / permKey）', () => {
  const gatedItems: UserMenuExtraItem[] = [
    { label: '计费账单', to: '/settings/workspace/billing', permKey: 'billing:read' },
    { label: '工作区设置', to: '/settings/workspace', permKey: 'workspace:read' },
    { label: '成员管理', to: '/settings/workspace/members', perm: 'owner' },
    { label: '通知偏好', to: '/account/notifications' },
  ]

  async function renderWithItems() {
    const result = await renderMenu(undefined, gatedItems)
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    await screen.findByRole('menu')
    return result
  }

  it('role_perms 已知且不含键：permKey 项隐藏，含键的项显示，无门控项不受影响', async () => {
    mocks.wsCurrent = {
      id: 'ws-1', name: 'Acme', slug: 'acme',
      role: 'member', role_perms: ['workspace:read', 'members:read'],
    }
    await renderWithItems()
    expect(screen.queryByRole('menuitem', { name: '计费账单' })).not.toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '工作区设置' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '通知偏好' })).toBeVisible()
  })

  it('role_perms 已知且含键：permKey 项显示', async () => {
    mocks.wsCurrent = {
      id: 'ws-1', name: 'Acme', slug: 'acme',
      role: 'member', role_perms: ['billing:read'],
    }
    await renderWithItems()
    expect(screen.getByRole('menuitem', { name: '计费账单' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '工作区设置' })).not.toBeInTheDocument()
  })

  it('role_perms 缺失（旧载荷）：permKey 项默认显示（向后兼容）', async () => {
    mocks.wsCurrent = { id: 'ws-1', name: 'Acme', slug: 'acme', role: 'member' }
    await renderWithItems()
    expect(screen.getByRole('menuitem', { name: '计费账单' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '工作区设置' })).toBeVisible()
  })

  it('无 Provider：rolePerms 未知，permKey 项同样默认显示', async () => {
    // wsCurrent=null → mock 同步抛错，走 useWorkspaceRoleSafe 的 try/catch 回退
    await renderWithItems()
    expect(screen.getByRole('menuitem', { name: '计费账单' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '工作区设置' })).toBeVisible()
  })

  it('perm: owner — member 隐藏；owner 显示', async () => {
    mocks.wsCurrent = { id: 'ws-1', name: 'Acme', slug: 'acme', role: 'member', role_perms: [] }
    const member = await renderWithItems()
    expect(screen.queryByRole('menuitem', { name: '成员管理' })).not.toBeInTheDocument()
    member.unmount()

    mocks.wsCurrent = { id: 'ws-1', name: 'Acme', slug: 'acme', role: 'owner', role_perms: [] }
    await renderWithItems()
    expect(screen.getByRole('menuitem', { name: '成员管理' })).toBeVisible()
  })
})
