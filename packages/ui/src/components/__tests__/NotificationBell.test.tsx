import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NotificationBell } from '../NotificationBell'







const mockedGet = vi.hoisted(() => vi.fn())
const mockedPost = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', () => ({
  api: { get: mockedGet, post: mockedPost },
  setWorkspaceIdProvider: vi.fn(),
}))

type N = {
  id: string; type: string; title: string; body: string
  link?: string | null; count: number; read_at?: string | null; created_at: string
}

const now = '2026-10-06T08:00:00Z'
const unreadItem: N = {
  id: 'n-1', type: 'quota_near_limit', title: '用量接近上限',
  body: '本月任务数已用 90%', link: '/settings/workspace/usage', count: 1,
  read_at: null, created_at: now,
}
const readItem: N = {
  id: 'n-2', type: 'task_comment', title: '已读的历史通知', body: '',
  count: 2, read_at: '2026-10-05T08:00:00Z', created_at: '2026-10-05T07:00:00Z',
}


function dispatchGet(badgeCount: number, list: N[]) {
  return (url: string) => {
    if (url === '/api/notifications/badge') return Promise.resolve({ count: badgeCount })
    if (url.startsWith('/api/notifications?')) return Promise.resolve(list)
    return Promise.reject(new Error(`unexpected GET ${url}`))
  }
}

function countCalls(urlPrefix: string) {
  return mockedGet.mock.calls.filter(([u]) => (u as string).startsWith(urlPrefix)).length
}

function renderBell(onNavigate?: (link: string) => void) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <NotificationBell onNavigate={onNavigate} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedPost.mockReset()
  mockedPost.mockResolvedValue(undefined)
})

describe('NotificationBell', () => {
  it('未读角标：badge 查询渲染服务端未读数；0 时无角标', async () => {
    mockedGet.mockImplementation(dispatchGet(3, []))
    const { unmount } = renderBell()
    await waitFor(() => expect(screen.getByText('3')).toBeInTheDocument())
    unmount()

    mockedGet.mockImplementation(dispatchGet(0, []))
    renderBell()
    
    await waitFor(() => expect(countCalls('/api/notifications/badge')).toBe(2))
    
    expect(screen.getByRole('button', { name: '通知' })).toBeInTheDocument()
    expect(screen.queryByText('0')).not.toBeInTheDocument()
  })

  it('未读数超 99 截断显示 99+', async () => {
    mockedGet.mockImplementation(dispatchGet(120, []))
    renderBell()
    await waitFor(() => expect(screen.getByText('99+')).toBeInTheDocument())
  })

  it('打开下拉加载最近通知（limit=8）；关闭态不拉列表', async () => {
    const get = dispatchGet(1, [unreadItem, readItem])
    mockedGet.mockImplementation(get)
    renderBell()

    
    await waitFor(() => expect(countCalls('/api/notifications?')).toBe(0))

    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    expect(await screen.findByText('用量接近上限')).toBeInTheDocument()
    expect(screen.getByText('已读的历史通知')).toBeInTheDocument()
    expect(mockedGet).toHaveBeenCalledWith('/api/notifications?limit=8')
  })

  it('单条已读：POST /:id/read 成功后按前缀失效 badge（立即重拉）与 list（重开面板时重拉）', async () => {
    mockedGet.mockImplementation(dispatchGet(2, [unreadItem]))
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    await screen.findByText('用量接近上限')
    const badgeCallsBefore = countCalls('/api/notifications/badge')
    const listCallsBefore = countCalls('/api/notifications?')

    
    
    fireEvent.click(screen.getByText('用量接近上限'))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/notifications/n-1/read'))
    await waitFor(() => {
      expect(countCalls('/api/notifications/badge')).toBeGreaterThan(badgeCallsBefore)
    }, { timeout: 2000 })
    expect(mockedPost).not.toHaveBeenCalledWith('/api/notifications/read-all')

    
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    await waitFor(() => {
      expect(countCalls('/api/notifications?')).toBeGreaterThan(listCallsBefore)
    }, { timeout: 2000 })
  })

  it('全部已读：POST /read-all 并失效查询', async () => {
    mockedGet.mockImplementation(dispatchGet(2, [unreadItem, readItem]))
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    fireEvent.click(await screen.findByText('全部已读'))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/notifications/read-all'))
    await waitFor(() => {
      expect(countCalls('/api/notifications/badge')).toBeGreaterThanOrEqual(2)
    }, { timeout: 2000 })
  })

  it('外点关闭：面板外 mousedown 关闭下拉', async () => {
    mockedGet.mockImplementation(dispatchGet(1, [unreadItem]))
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    await screen.findByText('用量接近上限')

    fireEvent.mouseDown(document.body)
    expect(screen.queryByText('用量接近上限')).not.toBeInTheDocument()

    
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    await screen.findByText('用量接近上限')
    fireEvent.mouseDown(screen.getByText('用量接近上限'))
    expect(screen.getByText('用量接近上限')).toBeInTheDocument()
  })

  it('点击带 link 的通知：onNavigate(link) 回调触发且面板关闭', async () => {
    mockedGet.mockImplementation(dispatchGet(1, [unreadItem]))
    const onNavigate = vi.fn()
    renderBell(onNavigate)
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    fireEvent.click(await screen.findByText('用量接近上限'))

    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('/settings/workspace/usage'))
    expect(screen.queryByText('用量接近上限')).not.toBeInTheDocument()
  })

  it('点击无 link 的通知：不触发 onNavigate，仅走已读', async () => {
    mockedGet.mockImplementation(dispatchGet(1, [{ ...unreadItem, link: null }]))
    const onNavigate = vi.fn()
    renderBell(onNavigate)
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    fireEvent.click(await screen.findByText('用量接近上限'))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/notifications/n-1/read'))
    expect(onNavigate).not.toHaveBeenCalled()
  })
})

describe('P2-7/P2-19：加载态与键盘化', () => {
  it('P2-7：列表加载中显示"加载中…"而非"暂无通知"空态', async () => {
    let resolveList!: (v: N[]) => void
    mockedGet.mockImplementation((url: string) => {
      if (url === '/api/notifications/badge') return Promise.resolve({ count: 0 })
      if (url.startsWith('/api/notifications?')) return new Promise<N[]>((res) => { resolveList = res })
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    renderBell()
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    expect(await screen.findByText('加载中…')).toBeInTheDocument()
    expect(screen.queryByText('暂无通知')).not.toBeInTheDocument()

    resolveList([])
    await waitFor(() => expect(screen.getByText('暂无通知')).toBeInTheDocument())
  })

  it('P2-19：条目为 button（Tab/Enter 可操作）；触发钮带 aria-haspopup/expanded', async () => {
    mockedGet.mockImplementation(dispatchGet(1, [unreadItem]))
    renderBell()
    const trigger = screen.getByRole('button', { name: '通知' })
    expect(trigger).toHaveAttribute('aria-haspopup', 'true')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    
    const item = await screen.findByRole('button', { name: /用量接近上限/ })
    fireEvent.click(item)
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/notifications/n-1/read'))
  })
})
