import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { WorkspaceGeneralPage } from '../WorkspaceGeneralPage'

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}))
vi.mock('../../../hooks/useApi', () => ({ useApi: () => apiMocks }))

const wsMocks = vi.hoisted(() => ({ role: 'owner' as string }))
vi.mock('../../../hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    current: { id: 'ws-1', name: 'Acme', slug: 'acme', plan_code: 'free', role: wsMocks.role },
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
      <MemoryRouter initialEntries={['/settings/workspace/general']}>
        <Routes>
          <Route path="/settings/workspace/general" element={<WorkspaceGeneralPage />} />
          <Route path="/app" element={<div>app-page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  wsMocks.role = 'owner'
  apiMocks.patch.mockResolvedValue({})
  apiMocks.post.mockResolvedValue({})
  apiMocks.delete.mockResolvedValue(undefined)
})

describe('WorkspaceGeneralPage', () => {
  it('渲染名称表单（slug 只读）与危险区', async () => {
    renderPage()
    const nameInput = await screen.findByLabelText('工作区名称')
    expect(nameInput).toHaveValue('Acme')
    expect(screen.getByLabelText('Slug（只读）')).toBeDisabled()
    expect(screen.getByRole('button', { name: '退出工作区' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '删除工作区' })).toBeInTheDocument()
  })

  it('重命名提交 PATCH /api/workspaces/{id} {name}', async () => {
    renderPage()
    const nameInput = await screen.findByLabelText('工作区名称')
    fireEvent.change(nameInput, { target: { value: 'Acme Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('/api/workspaces/ws-1', { name: 'Acme Renamed' }),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('退出工作区 409（last owner）→ 直显中文可行动文案，不再英文原文+括号补丁（B7）', async () => {
    apiMocks.post.mockRejectedValue(
      new ApiError(409, 'E_CONFLICT', 'last owner cannot leave; transfer or delete the workspace'),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '退出工作区' }))
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())
    const text = toastMocks.error.mock.calls[0][0]
    expect(text).toContain('最后一个所有者不能离开工作区')
    
    expect(text).not.toContain('last owner')
    
    expect(screen.getByRole('button', { name: '保存修改' })).toBeInTheDocument()
  })

  it('删除工作区：ImpactConfirmation 确认后 DELETE /api/workspaces/{id}', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '删除工作区' }))

    
    expect(await screen.findByText('所有成员立即失去访问权限')).toBeInTheDocument()
    const accept = screen.getByRole('checkbox')
    fireEvent.click(accept)
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))

    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledWith('/api/workspaces/ws-1'))
    await waitFor(() => expect(screen.getByText('app-page')).toBeInTheDocument())
  })

  it('BeforeDelete 钩子拦截（409）→ 错误经通用映射转中文（G7.4 后不再直出英文原文）', async () => {
    apiMocks.delete.mockRejectedValue(
      new ApiError(409, 'E_CONFLICT', 'workspace cannot be deleted: open orders exist'),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '删除工作区' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '永久删除' }))

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())
    
    expect(toastMocks.error.mock.calls[0][0]).toContain('工作区暂时无法删除')
    expect(toastMocks.error.mock.calls[0][0]).not.toContain('cannot be deleted')
  })

  it('纯空格名称被拒（B10：trim 后非空），0 网络请求', async () => {
    renderPage()
    const nameInput = await screen.findByLabelText('工作区名称')
    fireEvent.change(nameInput, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('请输入工作区名称')
    expect(apiMocks.patch).not.toHaveBeenCalled()
  })

  it('首尾空白在提交前被 trim（B10：落库名称不带空白）', async () => {
    renderPage()
    const nameInput = await screen.findByLabelText('工作区名称')
    fireEvent.change(nameInput, { target: { value: '  Acme Renamed  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('/api/workspaces/ws-1', { name: 'Acme Renamed' }),
    )
  })
})

describe('WorkspaceGeneralPage 角色门控（IA v2 矩阵）', () => {
  it('admin：可改名，不可删除（删除卡隐藏），退出可见', async () => {
    wsMocks.role = 'admin'
    renderPage()
    const nameInput = await screen.findByLabelText('工作区名称')
    expect(nameInput).toBeEnabled()
    expect(screen.getByRole('button', { name: '保存修改' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除工作区' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出工作区' })).toBeInTheDocument()
  })

  it('member：名称只读（无保存按钮），删除卡隐藏，退出仍可见（后端兜底 last-owner）', async () => {
    wsMocks.role = 'member'
    renderPage()
    const nameInput = await screen.findByLabelText('工作区名称')
    expect(nameInput).toBeDisabled()
    expect(screen.queryByRole('button', { name: '保存修改' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '删除工作区' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '退出工作区' })).toBeInTheDocument()
  })
})
