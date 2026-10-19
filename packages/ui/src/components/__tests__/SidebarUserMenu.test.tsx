import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RouterTestHarness } from '../../router'
import { SidebarProvider } from '../ui/sidebar'
import { SidebarUserMenu } from '../SidebarUserMenu'

const logout = vi.fn(async () => {})
const mocks = vi.hoisted(() => ({ noProvider: false }))
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

async function renderMenu(labels?: { accountSettings?: string; logout?: string; userMenuAria?: string; logoutFailedToast?: string }) {
  const result = render(
    <RouterTestHarness initialEntries={['/app']}>
      <SidebarProvider>
        <SidebarUserMenu labels={labels} />
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
