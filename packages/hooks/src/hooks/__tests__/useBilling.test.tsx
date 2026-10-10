import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkspaceContext, type WorkspaceContextValue } from '../../provider/PloykitProvider'
import { useBilling, useUsagePreview, type UsagePreviewResp } from '../useBilling'






const mockedGet = vi.hoisted(() => vi.fn())
const mockedPost = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', () => ({
  api: { get: mockedGet, post: mockedPost },
  setWorkspaceIdProvider: vi.fn(),
}))

const samplePreview: UsagePreviewResp = {
  period: '2026-10',
  items: [
    { dim: 'tasks_monthly', used: 120, included: 100, unit_cents: 10, projected_overage_cents: 200 },
  ],
  projected_total_cents: 200,
}

function Probe() {
  const { preview, loading } = useUsagePreview()
  if (loading) return <div>loading</div>
  return <div data-testid="preview">{preview ? JSON.stringify(preview) : 'none'}</div>
}

function wsValue(wsId: string | null): WorkspaceContextValue {
  return {
    current: wsId ? ({ id: wsId } as WorkspaceContextValue['current']) : null,
    switchTo: vi.fn(),
    clear: vi.fn(),
  }
}

function renderProbe(wsId: string | null, qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <WorkspaceContext.Provider value={wsValue(wsId)}>
        <Probe />
      </WorkspaceContext.Provider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  mockedGet.mockReset()
  mockedPost.mockReset()
})

describe('useUsagePreview', () => {
  it('请求 /api/billing/usage-preview 并吐出响应', async () => {
    mockedGet.mockResolvedValueOnce(samplePreview)
    renderProbe('ws-1', new QueryClient())

    await waitFor(() => expect(screen.getByTestId('preview').textContent).toBe(JSON.stringify(samplePreview)))
    expect(mockedGet).toHaveBeenCalledWith('/api/billing/usage-preview')
  })

  it('queryKey 携带工作区 id：同一 QueryClient 下切换工作区重新拉取', async () => {
    mockedGet.mockResolvedValueOnce(samplePreview)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { rerender } = renderProbe('ws-1', qc)
    await waitFor(() => expect(screen.getByTestId('preview').textContent).toBe(JSON.stringify(samplePreview)))
    expect(mockedGet).toHaveBeenCalledTimes(1)

    mockedGet.mockResolvedValueOnce({ ...samplePreview, projected_total_cents: 0, items: [] })
    rerender(
      <QueryClientProvider client={qc}>
        <WorkspaceContext.Provider value={wsValue('ws-2')}>
          <Probe />
        </WorkspaceContext.Provider>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(mockedGet).toHaveBeenCalledTimes(2), { timeout: 2000 })
  })

  it('未选工作区不发请求，preview 为 null', () => {
    renderProbe(null, new QueryClient())
    expect(screen.getByTestId('preview').textContent).toBe('none')
    expect(mockedGet).not.toHaveBeenCalled()
  })
})

describe('useBilling checkout（P2-2：失败可诊断）', () => {
  function CheckoutProbe() {
    const { checkout, checkoutError } = useBilling()
    return (
      <div>
        <button onClick={() => void checkout('pro', 'monthly', 'manual').catch(() => {})}>go</button>
        <div data-testid="checkout-error">{checkoutError ? String((checkoutError as Error).message) : 'none'}</div>
      </div>
    )
  }

  it('结账失败：checkout 返回 null 且错误经 checkoutError 暴露（不再吞错）', async () => {
    mockedGet.mockResolvedValue([]) 
    mockedPost.mockRejectedValueOnce(new Error('channel unavailable'))
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <WorkspaceContext.Provider value={wsValue('ws-1')}>
          <CheckoutProbe />
        </WorkspaceContext.Provider>
      </QueryClientProvider>,
    )
    screen.getByRole('button', { name: 'go' }).click()
    await waitFor(() => expect(mockedPost).toHaveBeenCalledWith('/api/billing/checkout', {
      plan_code: 'pro', interval: 'monthly', channel: 'manual',
    }))
    await waitFor(() => expect(screen.getByTestId('checkout-error').textContent).toBe('channel unavailable'))
  })

  it('未选工作区：checkout 直接返回 null，不发请求', async () => {
    mockedGet.mockResolvedValue([])
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={qc}>
        <WorkspaceContext.Provider value={wsValue(null)}>
          <CheckoutProbe />
        </WorkspaceContext.Provider>
      </QueryClientProvider>,
    )
    screen.getByRole('button', { name: 'go' }).click()
    await waitFor(() => expect(screen.getByTestId('checkout-error').textContent).toBe('none'))
    expect(mockedPost).not.toHaveBeenCalled()
  })
})
