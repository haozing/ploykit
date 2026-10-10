import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useLocation } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { MembersPage } from '../MembersPage'



const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
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


const locationLog: string[] = []
function LocationProbe() {
  const loc = useLocation()
  locationLog.push(`${loc.pathname}${loc.search}`)
  return null
}

function renderPage(initialEntries?: string[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <LocationProbe />
        <MembersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const member = {
  user_id: 'u-1', email: 'owner@example.com', display_name: 'Owner',
  role: 'owner', created_at: '2026-01-01T00:00:00Z',
}
const admin = {
  user_id: 'u-2', email: 'admin@example.com', display_name: 'Admin',
  role: 'admin', created_at: '2026-02-01T00:00:00Z',
}
const invitation = {
  id: 'inv-1', workspace_id: 'ws-1', email: 'new@example.com', role: 'member',
  status: 'pending', expires_at: '2026-12-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
}
const shareLink = {
  id: 'link-1', code_prefix: 'abcd', role: 'member', max_uses: 10, uses: 2,
  expires_at: '2026-12-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  locationLog.length = 0
  wsMocks.role = 'owner'
  
  apiMocks.get.mockImplementation(async (path: string) => {
    if (path.startsWith('/api/workspaces/ws-1/members')) {
      return { items: [member, admin], total: 2 }
    }
    if (path.startsWith('/api/workspaces/ws-1/invitations')) {
      return { items: [invitation], total: 1 }
    }
    if (path.startsWith('/api/workspaces/ws-1/share-links')) {
      return { items: [shareLink], total: 1 }
    }
    throw new Error('unexpected GET ' + path)
  })
  apiMocks.post.mockResolvedValue({})
  apiMocks.patch.mockResolvedValue({})
  apiMocks.delete.mockResolvedValue({})
})

describe('MembersPage', () => {
  it('加载后渲染成员表（邮箱/角色 + 分页底栏总数来自信封 total）', async () => {
    renderPage()
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument()
    expect(screen.getByText('admin@example.com')).toBeInTheDocument()
    expect(screen.getByText('所有者')).toBeInTheDocument()
    
    expect(await screen.findByText('2')).toBeInTheDocument()
  })

  it('邀请成员：提交正确的 path 与 payload', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /邀请成员/ }))

    const emailInput = await screen.findByLabelText('邮箱')
    fireEvent.change(emailInput, { target: { value: 'new@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }))

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/invitations',
        { email: 'new@example.com', role: 'member' },
      ),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('移除成员 409（last owner）→ 透出冲突文案', async () => {
    apiMocks.delete.mockRejectedValue(
      new ApiError(409, 'E_CONFLICT', 'cannot remove the last owner'),
    )
    renderPage()
    await screen.findByText('admin@example.com')

    fireEvent.click(screen.getByRole('button', { name: '移除' }))
    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())
    expect(toastMocks.error.mock.calls[0][0]).toContain('请先转移或删除工作区')
  })

  it('角色变更 Select 走 PATCH members/{userId} {role}', async () => {
    renderPage()
    const trigger = await screen.findByRole('combobox', { name: /admin@example.com 的角色/ })
    fireEvent.click(trigger)
    const option = await screen.findByRole('option', { name: '成员' })

    
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
    fireEvent.click(option)

    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/members/u-2',
        { role: 'member' },
      ),
    )
  })

  
  it('owner：member/admin 行出现"转让所有权"→ ImpactConfirmation 勾选后 POST transfer-ownership', async () => {
    renderPage()
    await screen.findByText('admin@example.com')

    
    const transferBtn = screen.getByRole('button', { name: '转让所有权' })
    expect(screen.getAllByRole('button', { name: '转让所有权' })).toHaveLength(1)
    fireEvent.click(transferBtn)

    
    expect(await screen.findByText('转让所有权给 admin@example.com')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('我理解并接受以上影响'))
    fireEvent.click(screen.getByRole('button', { name: '确认转让' }))

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/transfer-ownership',
        { user_id: 'u-2' },
      ),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('转让所有权 409（目标已是 owner/钩子拦截）→ toast 透出本地化语义', async () => {
    apiMocks.post.mockRejectedValue(
      new ApiError(409, 'E_CONFLICT', 'target is already an owner'),
    )
    renderPage()
    await screen.findByText('admin@example.com')

    fireEvent.click(screen.getByRole('button', { name: '转让所有权' }))
    fireEvent.click(await screen.findByLabelText('我理解并接受以上影响'))
    fireEvent.click(screen.getByRole('button', { name: '确认转让' }))

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())
    
    
    expect(toastMocks.error.mock.calls[0][0]).toContain('对方已是所有者')
  })
})

describe('MembersPage 角色门控（member 只读）', () => {
  beforeEach(() => {
    wsMocks.role = 'member'
  })

  it('member：无邀请/分享链接/移除/撤销/角色变更控件，列表只读展示', async () => {
    renderPage()
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument()

    expect(screen.queryByRole('button', { name: /邀请成员/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /创建分享链接/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '移除' })).not.toBeInTheDocument()
    
    expect(screen.queryByRole('button', { name: '转让所有权' })).not.toBeInTheDocument()
    
    expect(screen.queryByRole('combobox', { name: /admin@example.com 的角色/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('管理员').length).toBeGreaterThan(0)
  })

  it('member：邀请/分享链接两个 tab 无撤销按钮（只读）', async () => {
    renderPage()
    await screen.findByText('owner@example.com')
    fireEvent.click(screen.getByRole('tab', { name: /邀请/ }))
    expect(await screen.findByText('new@example.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /分享链接/ }))
    expect(await screen.findByText(/abcd/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument()
  })
})

describe('MembersPage 角色门控（admin 可管理但不可转让所有权）', () => {
  beforeEach(() => {
    wsMocks.role = 'admin'
  })

  it('admin：可见移除但无转让所有权（发起方必须是 owner，守卫在 workspace 域）', async () => {
    renderPage()
    await screen.findByText('admin@example.com')

    expect(screen.getByRole('button', { name: '移除' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '转让所有权' })).not.toBeInTheDocument()
  })
})

describe('MembersPage B7：邀请邮箱语义 type=email（zod 兜底保留）', () => {
  it('输入框 type=email + autoComplete；非法邮箱仍由 zod 拦截（不发请求）', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /邀请成员/ }))

    const emailInput = await screen.findByLabelText('邮箱')
    expect(emailInput).toHaveAttribute('type', 'email')
    expect(emailInput).toHaveAttribute('autocomplete', 'email')
    
    expect(emailInput.closest('form')).toHaveAttribute('novalidate')

    fireEvent.change(emailInput, { target: { value: 'not-an-email' } })
    fireEvent.click(screen.getByRole('button', { name: '发送邀请' }))
    expect(await screen.findByText('邮箱格式不正确')).toBeInTheDocument()
    expect(apiMocks.post).not.toHaveBeenCalled()
  })
})

describe('MembersPage B9：分享链接空态补 CTA（与邀请空态同构）', () => {
  beforeEach(() => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/workspaces/ws-1/members')) {
        return { items: [member], total: 1 }
      }
      if (path.startsWith('/api/workspaces/ws-1/invitations')) {
        return { items: [], total: 0 }
      }
      if (path.startsWith('/api/workspaces/ws-1/share-links')) {
        return { items: [], total: 0 }
      }
      throw new Error('unexpected GET ' + path)
    })
  })

  it('分享链接空态 hint 指向页头主动作；邀请空态同构对照', async () => {
    renderPage()
    await screen.findByText('owner@example.com')

    fireEvent.click(screen.getByRole('tab', { name: /分享链接/ }))
    expect(
      await screen.findByText(/点击右上角“创建分享链接”生成兑换码/),
    ).toBeInTheDocument()

    
    fireEvent.click(screen.getByRole('tab', { name: /邀请/ }))
    expect(
      await screen.findByText(/点击右上角“邀请成员”发送新邀请/),
    ).toBeInTheDocument()
  })
})

describe('MembersPage K5：tab/分页状态进 URL（searchParams）', () => {
  it('默认无参数 → 成员 Tab；默认值不写入地址栏', async () => {
    renderPage()
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument()
    expect(locationLog.at(-1)).toBe('/')
  })

  it('URL ?tab=share-links 直达分享链接 Tab（刷新不回默认）', async () => {
    renderPage(['/?tab=share-links'])
    expect(await screen.findByText(/abcd/)).toBeInTheDocument()
  })

  it('非法 tab 参数回落成员 Tab；点击 Tab 写入地址栏', async () => {
    renderPage(['/?tab=bogus'])
    expect(await screen.findByText('owner@example.com')).toBeInTheDocument()
    
    expect(screen.queryByText('new@example.com')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /邀请/ }))
    expect(await screen.findByText('new@example.com')).toBeInTheDocument()
    
    expect(locationLog.at(-1)).toBe('/?tab=invitations')
  })

  it('翻页写入页码参数（total 120 > 50/页 → 下一页可用）', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/workspaces/ws-1/members')) {
        return { items: [member, admin], total: 120 }
      }
      if (path.startsWith('/api/workspaces/ws-1/invitations')) {
        return { items: [invitation], total: 1 }
      }
      if (path.startsWith('/api/workspaces/ws-1/share-links')) {
        return { items: [shareLink], total: 1 }
      }
      throw new Error('unexpected GET ' + path)
    })
    renderPage()
    await screen.findByText('owner@example.com')

    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    await waitFor(() => expect(locationLog.at(-1)).toBe('/?mpage=2'))
  })

  it('URL 直达 ?mpage=2 → 请求带 page=2 且分页栏显示第 2 页', async () => {
    renderPage(['/?mpage=2'])
    await screen.findByText('owner@example.com')
    await waitFor(() =>
      expect(apiMocks.get).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/members?page=2&page_size=50',
      ),
    )
  })
})
