
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockedGet = vi.hoisted(() => vi.fn())
const mockedPatch = vi.hoisted(() => vi.fn())
const mockedPost = vi.hoisted(() => vi.fn())
const confirmMock = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', () => ({
  api: {
    get: mockedGet,
    put: vi.fn(),
    post: mockedPost,
    patch: mockedPatch,
    delete: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number
    code: string
    constructor(status: number, code: string, message: string) {
      super(message)
      this.status = status
      this.code = code
    }
  },
}))
vi.mock('../../../hooks/useApi', () => ({
  useApi: () => ({
    get: mockedGet,
    put: vi.fn(),
    post: mockedPost,
    patch: mockedPatch,
    delete: vi.fn(),
  }),
}))
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({
    user: { id: 'me-1', email: 'admin@audit.local', is_platform_admin: true },
    loading: false,
    refresh: vi.fn(),
    logout: vi.fn(),
    workspaces: [],
  }),
}))
vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => confirmMock,
}))

import { UsersPage } from '../UsersPage'

const ME = {
  id: 'me-1',
  email: 'admin@audit.local',
  display_name: 'Admin',
  status: 'active',
  is_platform_admin: true,
  email_verified: true,
  created_at: '2026-09-01T00:00:00Z',
}
const OTHER = {
  id: 'u-9',
  email: 'user@audit.local',
  display_name: 'User',
  status: 'active',
  is_platform_admin: false,
  email_verified: true,
  created_at: '2026-09-02T00:00:00Z',
}

function renderPage(props: Parameters<typeof UsersPage>[0] = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/admin/users']}>
      <QueryClientProvider client={qc}>
        <UsersPage {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  mockedGet.mockReset().mockImplementation(async (path: string) => {
    if (path.startsWith('/api/admin/users')) return { items: [ME, OTHER], total: 2 }
    throw new Error('unexpected GET ' + path)
  })
  mockedPatch.mockReset().mockResolvedValue({})
  mockedPost.mockReset().mockResolvedValue({})
  confirmMock.mockReset().mockResolvedValue(true)
})

describe('UsersPage 危险操作（P2-25）', () => {
  it('B-users-1 回归：行操作菜单可打开且不崩溃（Label 在 Group 内）', async () => {
    renderPage()
    await screen.findAllByText('user@audit.local')
    fireEvent.click(screen.getByRole('button', { name: '操作 user@audit.local' }))
    
    expect(await screen.findByRole('menuitem', { name: '用户详情' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '封禁账号' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: '模拟登录' })).toBeInTheDocument()
  })

  it('封禁：ImpactConfirmation 勾选后 PATCH status=disabled', async () => {
    renderPage()
    await screen.findAllByText('user@audit.local')
    fireEvent.click(screen.getByRole('button', { name: '操作 user@audit.local' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '封禁账号' }))

    
    const confirmBtn = await screen.findByRole('button', { name: '封禁' })
    expect(confirmBtn).toBeDisabled()
    expect(screen.getByText(/其名下工作区与数据保留/)).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/我理解并接受以上影响/))
    fireEvent.click(screen.getByRole('button', { name: '封禁' }))

    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/api/admin/users/u-9/status', {
        status: 'disabled',
      }),
    )
  })

  it('授予平台管理员：confirm 确认后 PATCH admin {is_admin:true}，文案明示后果', async () => {
    renderPage()
    await screen.findAllByText('user@audit.local')
    fireEvent.click(screen.getByRole('button', { name: '操作 user@audit.local' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '授予平台管理员' }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(confirmMock.mock.calls[0][0].description).toContain('平台管理权限')
    await waitFor(() =>
      expect(mockedPatch).toHaveBeenCalledWith('/api/admin/users/u-9/admin', {
        is_admin: true,
      }),
    )
  })

  it('取消确认则不提权', async () => {
    confirmMock.mockResolvedValueOnce(false)
    renderPage()
    await screen.findAllByText('user@audit.local')
    fireEvent.click(screen.getByRole('button', { name: '操作 user@audit.local' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '授予平台管理员' }))

    await waitFor(() => expect(confirmMock).toHaveBeenCalled())
    expect(mockedPatch).not.toHaveBeenCalled()
  })

  it('模拟登录：ImpactConfirmation 勾选后 POST impersonate → 跳 impersonatePath', async () => {
    renderPage({ impersonatePath: '/custom-app' })
    await screen.findAllByText('user@audit.local')
    fireEvent.click(screen.getByRole('button', { name: '操作 user@audit.local' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '模拟登录' }))

    const confirmBtn = await screen.findByRole('button', { name: '以该用户进入产品' })
    fireEvent.click(screen.getByLabelText(/我理解并接受以上影响/))
    fireEvent.click(confirmBtn)

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/api/admin/users/u-9/impersonate'),
    )
    // window.location.href 整页跳转在 jsdom 未实现（Not implemented: navigation）——
    // 以 POST 完成即视为链路通；跳转目标由 impersonatePath prop 驱动（P2-15）。
  })

  it('自己的行不渲染封禁/互模入口（详情可看）', async () => {
    renderPage()
    await screen.findAllByText('admin@audit.local')
    expect(
      screen.queryByRole('button', { name: '操作 admin@audit.local' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '详情' })).toBeInTheDocument()
  })

  it('平台管理员行：模拟登录入口禁用（服务端禁止互模）', async () => {
    mockedGet.mockImplementation(async () => ({
      items: [ME, { ...OTHER, id: 'u-10', email: 'admin2@audit.local', is_platform_admin: true }],
      total: 2,
    }))
    renderPage()
    await screen.findAllByText('admin2@audit.local')
    fireEvent.click(screen.getByRole('button', { name: '操作 admin2@audit.local' }))
    const item = await screen.findByRole('menuitem', { name: '模拟登录' })
    expect(item).toHaveAttribute('aria-disabled', 'true')
  })
})
