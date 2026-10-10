import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WebhooksPage } from '../WebhooksPage'

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}))
vi.mock('../../../../../hooks/src/hooks/useApi', () => ({ useApi: () => apiMocks }))

const wsMock = vi.hoisted(() => ({
  current: {
    id: 'ws-1', name: 'Acme', slug: 'acme', plan_code: 'free', role: 'owner',
  },
}))
vi.mock('../../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    ...wsMock,
    switchTo: vi.fn(),
    clear: vi.fn(),
  }),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(),
}))
vi.mock('../../../components/toast', () => ({ toast: toastMocks }))


const confirmMock = vi.hoisted(() => ({ calls: [] as Array<{ title?: string; description?: string }>, ret: true }))
vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => async (opts: { title?: string; description?: string }) => {
    confirmMock.calls.push(opts)
    return confirmMock.ret
  },
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <WebhooksPage />
    </QueryClientProvider>,
  )
}

const subscription = {
  id: 'sub-1', workspace_id: 'ws-1', event_types: ['task.created'],
  url: 'https://example.com/hook', description: 'CI 触发', is_active: true,
  created_at: '2026-06-01T00:00:00Z',
}
const delivery = {
  id: 'dlv-1', subscription_id: 'sub-1', event_id: 'evt-1', event_type: 'task.created',
  status: 'delivered', attempts: 1, last_status_code: 200,
  delivered_at: '2026-06-02T00:00:00Z', created_at: '2026-06-02T00:00:00Z',
}

beforeEach(() => {
  vi.clearAllMocks()
  wsMock.current = {
    id: 'ws-1', name: 'Acme', slug: 'acme', plan_code: 'free', role: 'owner',
  }
  confirmMock.calls.length = 0
  confirmMock.ret = true
  apiMocks.get.mockImplementation(async (path: string) => {
    if (path.endsWith('/subscriptions')) return { items: [subscription] }
    if (path.includes('/deliveries')) return { items: [delivery] }
    if (path.endsWith('/events')) {
      return { items: [{ type: 'task.created', description: '任务创建' }, { type: 'task.deleted', description: '任务删除' }] }
    }
    throw new Error('unexpected GET ' + path)
  })
  apiMocks.post.mockResolvedValue({})
  apiMocks.patch.mockResolvedValue(subscription)
  apiMocks.delete.mockResolvedValue({})
})

describe('WebhooksPage（从 example 提升进框架）', () => {
  it('渲染订阅表（URL/事件 chips/Switch/最近投递）', async () => {
    renderPage()
    expect(await screen.findByText('https://example.com/hook')).toBeInTheDocument()
    expect(screen.getByText('task.created')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /暂停订阅/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('已投递')).toBeInTheDocument() 
  })

  it('Switch 暂停订阅 → PATCH subscriptions/{id} {is_active:false}', async () => {
    renderPage()
    const sw = await screen.findByRole('switch', { name: /暂停订阅/ })
    fireEvent.click(sw)
    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/webhooks/subscriptions/sub-1',
        { is_active: false },
      ),
    )
  })

  it('行操作菜单：删除（destructive）→ DELETE subscriptions/{id}', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /example.com\/hook 的操作/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '删除' }))
    await waitFor(() =>
      expect(apiMocks.delete).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/webhooks/subscriptions/sub-1',
      ),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('创建订阅：提交正确 payload，secret 走 SecretModal 一次性展示', async () => {
    apiMocks.post.mockResolvedValue({ subscription, secret: 'whsec_abc123' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /创建订阅/ }))

    fireEvent.change(await screen.findByLabelText('回调 URL'), {
      target: { value: 'https://example.com/hook' },
    })
    
    const checkbox = screen.getByRole('checkbox', { name: /task\.created/ })
    fireEvent.click(checkbox)
    fireEvent.click(screen.getByRole('button', { name: '创建订阅' }))

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('/api/workspaces/ws-1/webhooks/subscriptions', {
        url: 'https://example.com/hook',
        description: '',
        events: ['task.created'],
      }),
    )
    
    await waitFor(() => expect(screen.getByText('whsec_abc123')).toBeInTheDocument())
  })

  it('投递记录页签：状态 Badge + 重投 POST deliveries/{id}/redeliver', async () => {
    apiMocks.post.mockResolvedValue({ ...delivery, id: 'dlv-2', event_id: 'evt-2' })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /投递记录/ }))

    fireEvent.click(await screen.findByRole('button', { name: '重新投递' }))
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/webhooks/deliveries/dlv-1/redeliver',
      ),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  

  it('轮换密钥：确认弹窗明示 24h 宽限双签名，POST rotate-secret，新明文走 SecretModal 一次性展示', async () => {
    apiMocks.post.mockImplementation(async (path: string) => {
      if (path.endsWith('/rotate-secret')) return { secret: 'whk_rotated_new' }
      return {}
    })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /example.com\/hook 的操作/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '轮换密钥' }))

    
    await waitFor(() => expect(confirmMock.calls.length).toBeGreaterThan(0))
    expect(confirmMock.calls[0].description).toContain('24h 宽限期')
    expect(confirmMock.calls[0].description).toContain('双签名')

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        '/api/workspaces/ws-1/webhooks/subscriptions/sub-1/rotate-secret',
      ),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledWith('密钥已轮换'))
    
    expect(await screen.findByText('whk_rotated_new')).toBeInTheDocument()
    expect(screen.getByText('Webhook 签名密钥轮换成功')).toBeInTheDocument()
  })

  it('P2-5：member 不渲染任何写入口（创建/Switch/行菜单/重投），只读浏览', async () => {
    wsMock.current = { ...wsMock.current, role: 'member' }
    renderPage()

    
    expect(await screen.findByText('已启用')).toBeInTheDocument()
    
    expect(screen.queryByRole('button', { name: /创建订阅/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /example.com\/hook 的操作/ })).not.toBeInTheDocument()
    
    fireEvent.click(await screen.findByRole('tab', { name: '投递记录' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '重新投递' })).not.toBeInTheDocument())
  })

  it('轮换密钥失败 → toast.error，不弹 SecretModal', async () => {
    apiMocks.post.mockRejectedValue(new Error('boom'))
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /example.com\/hook 的操作/ }))
    fireEvent.click(await screen.findByRole('menuitem', { name: '轮换密钥' }))

    await waitFor(() => expect(toastMocks.error).toHaveBeenCalled())
    expect(screen.queryByText(/whk_/)).not.toBeInTheDocument()
  })

  

  it('B3：点击事件目录 label 文本区可切换选中（恰好一次，不双发）', async () => {
    apiMocks.post.mockResolvedValue({ subscription, secret: 'whsec_abc123' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /创建订阅/ }))

    fireEvent.change(await screen.findByLabelText('回调 URL'), {
      target: { value: 'https://example.com/hook' },
    })
    
    fireEvent.click(await screen.findByText('任务创建'))
    fireEvent.click(screen.getByRole('button', { name: '创建订阅' }))

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('/api/workspaces/ws-1/webhooks/subscriptions', {
        url: 'https://example.com/hook',
        description: '',
        
        events: ['task.created'],
      }),
    )
  })

  it('B3：直接点方块本体仍单次切换（label 接管处理不与 Checkbox 自身双发）', async () => {
    apiMocks.post.mockResolvedValue({ subscription, secret: 'whsec_abc123' })
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /创建订阅/ }))

    fireEvent.change(await screen.findByLabelText('回调 URL'), {
      target: { value: 'https://example.com/hook' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /task\.created/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /task\.deleted/ }))
    fireEvent.click(screen.getByRole('button', { name: '创建订阅' }))

    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('/api/workspaces/ws-1/webhooks/subscriptions', {
        url: 'https://example.com/hook',
        description: '',
        events: ['task.created', 'task.deleted'],
      }),
    )
  })

  

  it('B5：投递记录 15s 轮询（页面可见时自动 refetch，进度无需手动刷新）', async () => {
    
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      renderPage()
      await screen.findByText('已投递') 
      const deliveriesCalls = () =>
        apiMocks.get.mock.calls.filter(([p]: [string]) => p.includes('/deliveries')).length
      const before = deliveriesCalls()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(15_000)
      })
      
      expect(deliveriesCalls()).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })

  

  it('B8：订阅已删的投递行标注"已删除订阅"，命中行显示归属 URL', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/subscriptions')) return { items: [subscription] }
      if (path.includes('/deliveries')) {
        return {
          items: [
            delivery,
            { ...delivery, id: 'dlv-orphan', subscription_id: 'sub-gone', event_id: 'evt-2' },
          ],
        }
      }
      if (path.endsWith('/events')) {
        return { items: [{ type: 'task.created', description: '任务创建' }] }
      }
      throw new Error('unexpected GET ' + path)
    })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /投递记录/ }))

    await screen.findByText('evt-2')
    expect(screen.getByText('已删除订阅')).toBeInTheDocument()
    
    expect(screen.getAllByText('https://example.com/hook').length).toBeGreaterThan(0)
  })

  it('B8：订阅列表未成功加载时不误标"已删除订阅"（显示 —）', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/subscriptions')) throw new Error('subs down')
      if (path.includes('/deliveries')) return { items: [delivery] }
      if (path.endsWith('/events')) return { items: [] }
      throw new Error('unexpected GET ' + path)
    })
    renderPage()
    fireEvent.click(await screen.findByRole('tab', { name: /投递记录/ }))

    await screen.findByText('evt-1')
    expect(screen.queryByText('已删除订阅')).not.toBeInTheDocument()
  })
})
