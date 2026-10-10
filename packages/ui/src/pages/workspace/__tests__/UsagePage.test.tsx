import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { MemoryRouter } from 'react-router'
import { UsagePage } from '../UsagePage'

const usageMocks = vi.hoisted(() => ({ useUsage: vi.fn() }))
vi.mock('../../../../../hooks/src/hooks/useUsage', () => ({ useUsage: usageMocks.useUsage }))

const usage = {
  workspace_id: 'ws-1',
  plan_code: 'starter',
  period: '2026-10',
  items: [
    { key: 'tasks_monthly', limit: 1000, used: 250, granted: 0, period: '2026-10' },
    { key: 'seats', limit: -1, used: 3, granted: 0, period: '2026-10' },
  ],
}


const usageWithReserved = {
  workspace_id: 'ws-1',
  plan_code: 'pro',
  period: '2026-10',
  items: [
    {
      key: 'tasks_monthly', limit: 1000, used: 250, granted: 0, reserved: 120, period: '2026-10',
      reservations: [
        { id: 'rsv-1', amount: 80, status: 'reserved', expires_at: '2026-10-07T12:34:56Z' },
        { id: 'rsv-2', amount: 40, status: 'reserved', expires_at: '2026-10-07T09:00:00Z' },
      ],
    },
    
    { key: 'seats', limit: 10, used: 2, granted: 0, reserved: 0, period: '2026-10' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('UsagePage', () => {
  it('加载中显示 PageLoading', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: 'ws-1', usage: null, loading: true, error: null, refetch: vi.fn(),
    })
    render(<UsagePage />)
    expect(screen.getByText('加载用量数据…')).toBeInTheDocument()
  })

  it('按维度渲染卡片：used/limit 进度，limit=-1 显示“不限量”', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: 'ws-1', usage, loading: false, error: null, refetch: vi.fn(),
    })
    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    )

    
    expect(screen.getAllByText('任务数（本月）').length).toBeGreaterThanOrEqual(1)
    
    expect(screen.getByText(/250 \/ 1,000/)).toBeInTheDocument()
    expect(screen.getAllByRole('progressbar')).toHaveLength(2)

    
    expect(screen.getByText('不限量')).toBeInTheDocument()
    expect(screen.getByText(/3 \/ ∞/)).toBeInTheDocument()

    
    expect(screen.getByText(/starter/)).toBeInTheDocument()
    expect(screen.getByText(/2026-10/)).toBeInTheDocument()
  })

  it('B2：卡内正文不出现原始 API 键，中文标签进卡题与进度行，原始键留 title 悬停', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: 'ws-1', usage, loading: false, error: null, refetch: vi.fn(),
    })
    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    )

    
    expect(screen.queryByText('tasks_monthly')).not.toBeInTheDocument()
    expect(screen.queryByText('seats')).not.toBeInTheDocument()

    
    expect(screen.getByTitle('tasks_monthly')).toBeInTheDocument()

    
    const card = screen.getByTitle('tasks_monthly').closest('div[data-slot="card"]')
    expect(card).toBeTruthy()
    expect(within(card as HTMLElement).getAllByText('任务数（本月）').length).toBeGreaterThanOrEqual(2)
  })

  it('B6：大数字千分位（12,500 / 50,000）', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: 'ws-1',
      usage: {
        workspace_id: 'ws-1',
        plan_code: 'free',
        period: '2026-10',
        items: [
          { key: 'tasks_monthly', limit: 50000, used: 12500, granted: 0, period: '2026-10' },
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/12,500 \/ 50,000/)).toBeInTheDocument()
  })

  it('已满卡片：已用尽徽标 + 升级 CTA（文案不承诺“将被拒绝”）+ 命中区 ≥24px 补偿', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: 'ws-1',
      usage: {
        workspace_id: 'ws-1',
        plan_code: 'free',
        period: '2026-10',
        items: [
          
          { key: 'workspaces', limit: 1, used: 3, granted: 0, period: '2026-10' },
        ],
      },
      loading: false, error: null, refetch: vi.fn(),
    })
    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    )

    expect(screen.getByText('已用尽')).toBeInTheDocument()
    expect(screen.getByText(/已用尽，可升级套餐提高上限/)).toBeInTheDocument()
    expect(screen.queryByText(/超额操作将被拒绝/)).not.toBeInTheDocument()

    
    const link = screen.getByRole('link', { name: '升级套餐' })
    expect(link.getAttribute('href')).toBe('/settings/workspace/billing')
    expect(link.className).toContain('py-1.5')
    expect(link.className).toContain('-my-1.5')
  })

  it('reserved 缺省（老后端/未重生成类型）→ 回退两段展示，无“预留中”段落', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: 'ws-1', usage, loading: false, error: null, refetch: vi.fn(),
    })
    render(<UsagePage />)

    expect(screen.queryByText(/预留中/)).not.toBeInTheDocument()
    expect(screen.queryByText(/预留明细/)).not.toBeInTheDocument()
    expect(screen.getByText(/250 \/ 1,000/)).toBeInTheDocument()
  })

  it('三段展示：已用 / 预留中 / 上限（reserved>0 的维度渲染分段条与第三段数值）', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: 'ws-1', usage: usageWithReserved, loading: false, error: null, refetch: vi.fn(),
    })
    render(
      <MemoryRouter>
        <UsagePage />
      </MemoryRouter>,
    )

    
    const card = screen.getByTitle('tasks_monthly').closest('div[data-slot="card"]')
    expect(card).toBeTruthy()
    const scope = within(card as HTMLElement)

    
    expect(scope.getByText(/250/)).toBeInTheDocument()
    expect(scope.getByText(/120/)).toBeInTheDocument()
    expect(scope.getByText(/1,000/)).toBeInTheDocument()
    expect(scope.getAllByText(/预留中/).length).toBeGreaterThan(0)

    
    expect(scope.getAllByRole('progressbar')).toHaveLength(1)
    expect(scope.getByTestId('progress-indicator-used')).toBeInTheDocument()
    expect(scope.getByTestId('progress-indicator-reserved')).toBeInTheDocument()

    
    const seats = screen.getByTitle('seats').closest('div[data-slot="card"]')
    expect(within(seats as HTMLElement).queryByTestId('progress-indicator-reserved')).not.toBeInTheDocument()
  })

  it('预留明细可展开：数量/状态/到期时间（DataTable 复用）', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: 'ws-1', usage: usageWithReserved, loading: false, error: null, refetch: vi.fn(),
    })
    render(<UsagePage />)

    const summary = screen.getByText('预留明细（2 笔）')
    const details = summary.closest('details') as HTMLDetailsElement
    expect(details).toBeTruthy()
    expect(details.open).toBe(false)

    
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('2026-10-07 12:34')).toBeInTheDocument()
    expect(screen.getByText('2026-10-07 09:00')).toBeInTheDocument()
    
    expect(screen.getAllByText('预留中').length).toBeGreaterThanOrEqual(2)

    fireEvent.click(summary)
    expect(details.open).toBe(true)
  })

  it('无工作区上下文 → 引导空态', () => {
    usageMocks.useUsage.mockReturnValue({
      wsId: '', usage: null, loading: false, error: null, refetch: vi.fn(),
    })
    render(<UsagePage />)
    expect(screen.getByText('请先创建并选择一个工作区')).toBeInTheDocument()
  })
})
