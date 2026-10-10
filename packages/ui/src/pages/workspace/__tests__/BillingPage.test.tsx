import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, useSearchParams } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BillingPage } from '../BillingPage'

const billingMocks = vi.hoisted(() => ({ useBilling: vi.fn() }))
vi.mock('../../../../../hooks/src/hooks/useBilling', () => ({ useBilling: billingMocks.useBilling }))

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




const clientGet = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', () => {
  class ApiError extends Error {
    status: number
    code: string
    constructor(status: number, code: string, message: string) {
      super(message)
      this.status = status
      this.code = code
    }
  }
  return {
    api: { get: clientGet, post: vi.fn() },
    ApiError,
    setWorkspaceIdProvider: vi.fn(),
  }
})

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(),
}))
vi.mock('../../../components/toast', () => ({ toast: toastMocks }))


const confirmSpy = vi.hoisted(() => vi.fn(async () => true))
vi.mock('../../../components/ConfirmDialog', () => ({ useConfirm: () => confirmSpy }))

const plans = [
  { code: 'free', name: 'Free', limits: { tasks_monthly: 100, price_monthly_cents: 0, price_yearly_cents: 0 }, sort_no: 1 },
  { code: 'pro', name: 'Pro', limits: { tasks_monthly: 10000, price_monthly_cents: 990, price_yearly_cents: 9900 }, sort_no: 2 },
]
const orders = [
  { id: 'o-1', plan_code: 'pro', interval: 'yearly', amount_cents: 990, currency: 'usd', status: 'pending', created_at: '2026-10-01T00:00:00Z' },
  { id: 'o-2', plan_code: 'starter', interval: 'yearly', amount_cents: 4900, currency: 'usd', status: 'paid', created_at: '2026-09-01T00:00:00Z' },
]


function SearchProbe() {
  const [sp] = useSearchParams()
  return <span data-testid="search-params">{sp.toString()}</span>
}

function renderPage(initialUrl = '/billing') {
  billingMocks.useBilling.mockReturnValue({
    subscription: { plan_code: 'free', orders },
    plans,
    loading: false,
    refresh: vi.fn(),
  })
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <BillingPage />
        <SearchProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.post.mockResolvedValue({ action_url: 'https://checkout.example.com/s/1' })
  
  
  apiMocks.get.mockImplementation(async (url: string) => {
    if (url === '/api/billing/subscription') return { plan_code: 'free', orders: [] }
    if (url === '/api/billing/plans') return []
    throw new Error('unexpected GET ' + url)
  })
  
  clientGet.mockResolvedValue({})
})

describe('BillingPage', () => {
  it('渲染当前套餐卡、套餐卡与订单表', () => {
    renderPage()
    expect(screen.getByText('当前套餐')).toBeInTheDocument()
    expect(screen.getByText(/共 2 笔订单（待处理 1 笔）/)).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Pro')).toBeInTheDocument()
    
    expect(screen.getAllByText('¥9.90').length).toBe(1)
    expect(screen.getByText(/USD 9\.90/)).toBeInTheDocument()
    expect(screen.getByText(/USD 49\.00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '当前计划' })).toBeDisabled()
    
    expect(screen.getAllByText('pro').length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: '取消' })).toBeInTheDocument()
  })

  it('B9：价格单位"/月"两侧空格平衡（此前"¥999/月"失衡）', () => {
    renderPage()
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === ' / 月'),
    ).toBeInTheDocument()
  })

  it('P2-6：订阅/套餐加载失败 → PageError 错误态（不再静默空页谎报空数据）', async () => {
    apiMocks.get.mockReset().mockRejectedValue(new Error('网络连接失败'))
    renderPage()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('网络连接失败')
    expect(screen.queryByText('选择套餐')).not.toBeInTheDocument()
    
    expect(screen.queryByText('暂无订单')).not.toBeInTheDocument()
    expect(screen.queryByText(/共 \d+ 笔订单/)).not.toBeInTheDocument()
  })

  it('P2-6 补强：仅套餐失败（订阅正常）→ 仍进错误态，不按空套餐渲染', async () => {
    apiMocks.get.mockImplementation(async (url: string) => {
      if (url === '/api/billing/subscription') return { plan_code: 'free', orders: [] }
      throw new Error('套餐接口 500')
    })
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('套餐接口 500')
    expect(screen.queryByText('选择套餐')).not.toBeInTheDocument()
  })

  it('升级 CTA 提交 POST /api/billing/checkout 并跳转 action_url', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '升级' }))
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('/api/billing/checkout', {
        plan_code: 'pro', interval: 'monthly', channel: 'stripe',
      }),
    )
  })

  it('B7：Stripe 专属跳回文案仅在 Stripe 渠道下显示', () => {
    renderPage()
    expect(
      screen.getByText('升级立即生效；Stripe 结账完成后自动跳回。'),
    ).toBeInTheDocument()
  })

  it('interval 切换到按年 → 价格取 price_yearly_cents', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '按年' }))
    await waitFor(() => expect(screen.getByText('¥99.00')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '升级' }))
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith(
        '/api/billing/checkout',
        expect.objectContaining({ interval: 'yearly' }),
      ),
    )
  })

  it('B6：周期选择写入 URL searchParams', async () => {
    renderPage('/billing')
    expect(screen.getByTestId('search-params').textContent).toBe('')
    fireEvent.click(screen.getByRole('button', { name: '按年' }))
    await waitFor(() =>
      expect(screen.getByTestId('search-params').textContent).toBe('interval=yearly'),
    )
  })

  it('B6：渠道选择写入 URL searchParams', async () => {
    clientGet.mockResolvedValue({ billing_channels: ['stripe', 'alipay', 'manual'] })
    renderPage('/billing')
    fireEvent.click(await screen.findByRole('combobox', { name: '支付渠道' }))
    const option = await screen.findByRole('option', { name: '支付宝' })
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
    fireEvent.click(option)
    await waitFor(() =>
      expect(screen.getByTestId('search-params').textContent).toContain('channel=alipay'),
    )
  })

  it('B6：URL 带参进入 → 周期/渠道按参数初始化', async () => {
    clientGet.mockResolvedValue({ billing_channels: ['stripe', 'manual'] })
    renderPage('/billing?interval=yearly&channel=manual')
    await waitFor(() => expect(screen.getByText('¥99.00')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '升级' }))
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('/api/billing/checkout', {
        plan_code: 'pro', interval: 'yearly', channel: 'manual',
      }),
    )
  })

  it('取消 pending 订单 → POST orders/{id}/cancel；B8：确认框周期用中文、术语"待处理"', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(confirmSpy).toHaveBeenCalledWith(
      expect.objectContaining({ description: '取消 pro（按年）的待处理订单？' }),
    )
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('/api/billing/orders/o-1/cancel'),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('B8：订单卡文案与徽章术语统一（"待处理"），不再"待支付"', () => {
    renderPage()
    expect(screen.getByText(/待处理 1 笔/)).toBeInTheDocument()
    expect(screen.queryByText(/待支付/)).not.toBeInTheDocument()
  })
})

describe('BillingPage B1/G4：manual 渠道接线（渠道表动态生成）', () => {
  it('/config 只注册 manual → 渠道表仅含 manual，未注册渠道不出现；升级可用且 POST channel=manual', async () => {
    clientGet.mockResolvedValue({ billing_channels: ['manual'] })
    renderPage()

    
    
    await screen.findByText('升级立即生效；下单后请联系管理员完成线下转账，订单在管理员核销后生效。')
    expect(screen.queryByText(/Stripe 结账完成后自动跳回/)).not.toBeInTheDocument()

    const trigger = screen.getByRole('combobox', { name: '支付渠道' })
    expect(trigger).toHaveTextContent('线下转账（管理员核销）')
    fireEvent.click(trigger)
    expect(await screen.findByRole('option', { name: '线下转账（管理员核销）' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Stripe（银行卡）' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '支付宝' })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: '微信支付' })).not.toBeInTheDocument()

    const upgrade = screen.getByRole('button', { name: '升级' })
    expect(upgrade).toBeEnabled()
    fireEvent.click(upgrade)
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('/api/billing/checkout', {
        plan_code: 'pro', interval: 'monthly', channel: 'manual',
      }),
    )
  })

  it('未知渠道码回退为码本身展示（自定义渠道可选）', async () => {
    clientGet.mockResolvedValue({ billing_channels: ['manual', 'paypal'] })
    renderPage()
    fireEvent.click(await screen.findByRole('combobox', { name: '支付渠道' }))
    expect(await screen.findByRole('option', { name: '线下转账（管理员核销）' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'paypal' })).toBeInTheDocument()
  })

  it('manual 空 InfoURL（checkout 201 但无 action_url）→ 渲染线下支付指引，不按错误处理', async () => {
    clientGet.mockResolvedValue({ billing_channels: ['manual'] })
    apiMocks.post.mockResolvedValue({ action_url: '' })
    renderPage()

    
    await screen.findByText('升级立即生效；下单后请联系管理员完成线下转账，订单在管理员核销后生效。')
    fireEvent.click(screen.getByRole('button', { name: '升级' }))
    const note = await screen.findByRole('note')
    expect(note).toHaveTextContent('已创建 Pro 订单（待处理）：下单后请联系管理员完成支付，订单在管理员核销后生效。')
    expect(toastMocks.success).toHaveBeenCalledWith('订单已创建，请联系管理员完成支付')
    expect(toastMocks.error).not.toHaveBeenCalled()
    // manual 有 InfoURL 时 action_url 非空 → 正常跳转指引页（主链路测试已覆盖跳转分支）
  })

  it('/config 报零渠道 → 升级禁用 + 如实说明，不再"请切换支付渠道"式自相矛盾', async () => {
    clientGet.mockResolvedValue({ billing_channels: [] })
    renderPage()

    const upgrade = await screen.findByRole('button', { name: '升级' })
    await waitFor(() => expect(upgrade).toBeDisabled())
    expect(screen.getByText('暂不可升级：站点未配置任何支付渠道，请联系管理员。')).toBeInTheDocument()
    expect(screen.queryByText(/请切换支付渠道/)).not.toBeInTheDocument()
  })

  it('/config 失败 → 不放大为整页错误：渠道表回退已知全集不设限', async () => {
    clientGet.mockRejectedValue(new Error('config down'))
    renderPage()

    expect(await screen.findByRole('button', { name: '升级' })).toBeEnabled()
    fireEvent.click(screen.getByRole('combobox', { name: '支付渠道' }))
    expect(await screen.findByRole('option', { name: '线下转账（管理员核销）' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Stripe（银行卡）' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
