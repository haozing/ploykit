import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterTestHarness, useLocation } from '../../../router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { WorkspaceGeneralPage } from '../WorkspaceGeneralPage'

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}))
vi.mock('../../../../../hooks/src/hooks/useApi', () => ({ useApi: () => apiMocks }))

const wsMocks = vi.hoisted(() => ({ role: 'owner' as string }))
vi.mock('../../../../../hooks/src/hooks/useWorkspace', () => ({
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

// 旧 <Route path> 分发的等价探针：RouterTestHarness 是 catch-all，不做路由分发；
// 用 useLocation 按路径渲染目标内容（/app 占位供「退出工作区」跳转断言）。
function RouteContentProbe() {
  const { pathname } = useLocation()
  if (pathname === '/app') return <div>app-page</div>
  return <WorkspaceGeneralPage />
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <RouterTestHarness initialEntries={['/settings/workspace/general']}>
        <RouteContentProbe />
      </RouterTestHarness>
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
    const nameInput = await screen.findByLabelText('Workspace name')
    expect(nameInput).toHaveValue('Acme')
    expect(screen.getByLabelText('Slug (read-only)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Leave workspace' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete workspace' })).toBeInTheDocument()
  })

  it('重命名提交 PATCH /api/workspaces/{id} {name}', async () => {
    renderPage()
    const nameInput = await screen.findByLabelText('Workspace name')
    fireEvent.change(nameInput, { target: { value: 'Acme Renamed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('/api/workspaces/ws-1', { name: 'Acme Renamed' }),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('退出工作区 409（last owner）→ 直显可行动文案，不再英文原文+括号补丁（B7）', async () => {
    apiMocks.post.mockRejectedValue(
      new ApiError(409, 'E_CONFLICT', 'last owner cannot leave; transfer or delete the workspace'),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Leave workspace' }))
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())
    const text = toastMocks.error.mock.calls[0][0]
    expect(text).toContain('The last owner cannot leave the workspace')

    expect(text).not.toContain('last owner cannot leave;')

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('删除工作区：ImpactConfirmation 确认后 DELETE /api/workspaces/{id}', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete workspace' }))


    expect(await screen.findByText('All members immediately lose access')).toBeInTheDocument()
    const accept = screen.getByRole('checkbox')
    fireEvent.click(accept)
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledWith('/api/workspaces/ws-1'))
    await waitFor(() => expect(screen.getByText('app-page')).toBeInTheDocument())
  })

  it('BeforeDelete 钩子拦截（409）→ 错误经通用映射转中文（G7.4 后不再直出英文原文）', async () => {
    apiMocks.delete.mockRejectedValue(
      new ApiError(409, 'E_CONFLICT', 'workspace cannot be deleted: open orders exist'),
    )
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete workspace' }))
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }))

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())

    expect(toastMocks.error.mock.calls[0][0]).toContain('The workspace cannot be deleted yet')
    expect(toastMocks.error.mock.calls[0][0]).not.toContain(': open orders exist')
  })

  it('纯空格名称被拒（B10：trim 后非空），0 网络请求', async () => {
    renderPage()
    const nameInput = await screen.findByLabelText('Workspace name')
    fireEvent.change(nameInput, { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))


    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a workspace name')
    expect(apiMocks.patch).not.toHaveBeenCalled()
  })

  it('首尾空白在提交前被 trim（B10：落库名称不带空白）', async () => {
    renderPage()
    const nameInput = await screen.findByLabelText('Workspace name')
    fireEvent.change(nameInput, { target: { value: '  Acme Renamed  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('/api/workspaces/ws-1', { name: 'Acme Renamed' }),
    )
  })
})

describe('WorkspaceGeneralPage 角色门控（IA v2 矩阵）', () => {
  it('admin：可改名，不可删除（删除卡隐藏），退出可见', async () => {
    wsMocks.role = 'admin'
    renderPage()
    const nameInput = await screen.findByLabelText('Workspace name')
    expect(nameInput).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave workspace' })).toBeInTheDocument()
  })

  it('member：名称只读（无保存按钮），删除卡隐藏，退出仍可见（后端兜底 last-owner）', async () => {
    wsMocks.role = 'member'
    renderPage()
    const nameInput = await screen.findByLabelText('Workspace name')
    expect(nameInput).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Leave workspace' })).toBeInTheDocument()
  })
})
