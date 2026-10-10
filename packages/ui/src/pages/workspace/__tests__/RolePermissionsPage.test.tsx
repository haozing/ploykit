import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { RolePermissionsPage } from '../RolePermissionsPage'

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}))
vi.mock('../../../../../hooks/src/hooks/useApi', () => ({ useApi: () => apiMocks }))

vi.mock('../../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    current: { id: 'ws-1', name: 'Acme', slug: 'acme', plan_code: 'free', role: 'owner' },
    switchTo: vi.fn(),
    clear: vi.fn(),
  }),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(),
}))
vi.mock('../../../components/toast', () => ({ toast: toastMocks }))

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => async () => true,
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/settings/workspace/roles']}>
        <Routes>
          <Route path="/settings/workspace/roles" element={<RolePermissionsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const ROLES = {
  items: [
    {
      role: 'admin',
      perms: ['members:read', 'workspace:read'],
      overridden: false,
      defaults: ['members:read', 'workspace:read'],
    },
    {
      role: 'member',
      perms: ['workspace:read'],
      overridden: true,
      defaults: ['members:read', 'workspace:read'],
    },
  ],
  catalog: ['members:read', 'roles:manage', 'workspace:read'],
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.get.mockResolvedValue(ROLES)
  apiMocks.put.mockResolvedValue(ROLES.items[1])
  apiMocks.delete.mockResolvedValue(undefined)
  apiMocks.post.mockResolvedValue({})
})

describe('RolePermissionsPage', () => {
  it('渲染两个可配置角色与权限矩阵（member 标记已自定义）', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: '管理员' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /成员/ })).toBeInTheDocument()
    expect(screen.getByText('已自定义')).toBeInTheDocument()
    // catalog 权限逐项渲染（admin 卡内 + member 卡内各一份）
    expect(screen.getAllByText('roles:manage').length).toBeGreaterThanOrEqual(2)
  })

  it('勾选并保存 → PUT /api/workspaces/{id}/roles/{role}', async () => {
    renderPage()
    await screen.findByText('管理员')
    // admin 卡内勾选 roles:manage（第一份），保存（第一份按钮）
    const boxes = screen.getAllByRole('checkbox', { name: 'roles:manage' })
    fireEvent.click(boxes[0])
    const save = screen.getAllByRole('button', { name: '保存修改' })[0]
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() => {
      expect(apiMocks.put).toHaveBeenCalledWith('/api/workspaces/ws-1/roles/admin', {
        perms: ['members:read', 'roles:manage', 'workspace:read'],
      })
    })
    expect(toastMocks.success).toHaveBeenCalled()
  })

  it('E_REAUTH_REQUIRED → 弹验证对话框 → 确认密码后自动重试原请求', async () => {
    apiMocks.put.mockRejectedValueOnce(
      new ApiError(403, 'E_REAUTH_REQUIRED', 'password confirmation required', {
        max_age_seconds: 900,
      }),
    )
    renderPage()
    await screen.findByText('管理员')

    const boxes = screen.getAllByRole('checkbox', { name: 'members:read' })
    // member 卡（第二个）：取消勾选 members:read（已勾选）→ dirty
    fireEvent.click(boxes[1])
    fireEvent.click(screen.getAllByRole('button', { name: '保存修改' })[1])

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('当前密码'), {
      target: { value: 'correct horse' },
    })
    fireEvent.click(screen.getByRole('button', { name: '验证并继续' }))

    await waitFor(() => {
      expect(apiMocks.post).toHaveBeenCalledWith('/auth/confirm-password', {
        password: 'correct horse',
      })
    })
    await waitFor(() => {
      expect(apiMocks.put).toHaveBeenCalledTimes(2)
    })
    expect(toastMocks.success).toHaveBeenCalledWith('已验证，操作已重试')
  })

  it('恢复默认（已自定义角色）→ DELETE 并提示', async () => {
    renderPage()
    await screen.findByText('已自定义')
    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }))
    await waitFor(() => {
      expect(apiMocks.delete).toHaveBeenCalledWith('/api/workspaces/ws-1/roles/member')
    })
    expect(toastMocks.success).toHaveBeenCalled()
  })
})
