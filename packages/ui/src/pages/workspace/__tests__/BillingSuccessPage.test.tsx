import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BillingSuccessPage } from '../BillingSuccessPage'



let queryData: unknown = null
let queryStamp = 0

let cacheData: unknown = null
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: queryData, dataUpdatedAt: queryStamp, isPending: false, error: null }),
  useQueryClient: () => ({ getQueryData: () => cacheData }),
}))

vi.mock('../../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    current: { id: 'ws-1', name: 'Acme', slug: 'acme', plan_code: 'free', role: 'owner' },
    switchTo: vi.fn(),
    clear: vi.fn(),
  }),
}))

const apiMocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}))
vi.mock('../../../../../hooks/src/hooks/useApi', () => ({ useApi: () => apiMocks }))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(),
}))
vi.mock('../../../components/toast', () => ({ toast: toastMocks }))

const PAID_SUB = {
  plan_code: 'pro',
  orders: [
    { id: 'o-paid', plan_code: 'pro', interval: 'monthly', amount_cents: 990, currency: 'usd', status: 'paid', created_at: '2026-10-05T00:00:00Z' },
  ],
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/billing/success']}>
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
        <Route path="/settings/workspace/billing" element={<div>billing-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

function rerenderPage(rerender: (node: ReactNode) => void) {
  rerender(
    <MemoryRouter initialEntries={['/billing/success']}>
      <Routes>
        <Route path="/billing/success" element={<BillingSuccessPage />} />
        <Route path="/settings/workspace/billing" element={<div>billing-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  queryData = null
  queryStamp = 0
  cacheData = null
})

describe('BillingSuccessPage', () => {
  it('轮询期间渲染骨架与提示', () => {
    queryData = { plan_code: 'free', orders: [] }
    queryStamp = 1
    renderPage()
    expect(screen.getByText('正在确认支付结果…')).toBeInTheDocument()
    expect(screen.getByText(/请勿关闭页面/)).toBeInTheDocument()
  })

  it('出现已支付订单 → toast 成功并跳转计费页', async () => {
    queryData = { plan_code: 'free', orders: [] }
    queryStamp = 1
    const { rerender } = renderPage()

    
    queryData = PAID_SUB
    queryStamp = 2
    rerenderPage(rerender)

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledWith('支付成功，套餐已生效'))
    await waitFor(() => expect(screen.getByText('billing-page')).toBeInTheDocument())
  })

  it('套餐变化（无新订单）同样判定成功', async () => {
    queryData = { plan_code: 'free', orders: [] }
    queryStamp = 1
    const { rerender } = renderPage()
    queryData = { plan_code: 'pro', orders: [] }
    queryStamp = 2
    rerenderPage(rerender)
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('P1-4：数据无变化轮询（data 引用不变、dataUpdatedAt 前进）→ 达到上限后超时兜底回跳', async () => {
    const unchanged = { plan_code: 'free', orders: [] }
    queryData = unchanged
    queryStamp = 1
    const { rerender } = renderPage()

    
    
    for (let i = 2; i <= 14; i++) {
      queryStamp = i
      rerenderPage(rerender)
    }
    await waitFor(() => expect(toastMocks.info).toHaveBeenCalledWith('支付结果确认超时，可稍后在计费页查看'))
    await waitFor(() => expect(screen.getByText('billing-page')).toBeInTheDocument())
    expect(toastMocks.success).not.toHaveBeenCalled()
  })

  it('P1-4：基线来自 query 缓存（支付完成早于首次轮询）→ 首询即判定成功', async () => {
    
    cacheData = { plan_code: 'free', orders: [] }
    
    queryData = PAID_SUB
    queryStamp = 1
    renderPage()

    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledWith('支付成功，套餐已生效'))
    await waitFor(() => expect(screen.getByText('billing-page')).toBeInTheDocument())
  })
})
