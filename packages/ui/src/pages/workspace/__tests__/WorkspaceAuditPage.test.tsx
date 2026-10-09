import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WorkspaceAuditPage } from '../WorkspaceAuditPage'

const auditMocks = vi.hoisted(() => ({
  useAudit: vi.fn(),
  exportAuditCsv: vi.fn(),
}))
vi.mock('../../../hooks/useAudit', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../hooks/useAudit')>()
  return { ...orig, useAudit: auditMocks.useAudit, exportAuditCsv: auditMocks.exportAuditCsv }
})

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(),
}))
vi.mock('../../../components/toast', () => ({ toast: toastMocks }))

const items = [
  {
    id: 'ev-1', workspace_id: 'ws-1', actor_type: 'user', actor_id: 'u-1',
    actor_snapshot: { email: 'alice@example.com' },
    action: 'workspace.rename', resource_type: 'workspace',
    resource_id: 'ws-1', metadata: {}, created_at: '2026-10-01T08:00:00Z',
  },
  {
    id: 'ev-2', workspace_id: 'ws-1', actor_type: 'system', actor_id: null,
    actor_snapshot: {}, action: 'billing.plan_changed', resource_type: 'workspace',
    resource_id: 'ws-1', metadata: {}, created_at: '2026-10-02T08:00:00Z',
  },
]

function stubAudit(overrides: Record<string, unknown> = {}) {
  auditMocks.useAudit.mockReturnValue({
    wsId: 'ws-1', items, total: 2, loading: false, error: null, refetch: vi.fn(),
    ...overrides,
  })
}


function renderPage() {
  return render(<MemoryRouter><WorkspaceAuditPage /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  auditMocks.exportAuditCsv.mockResolvedValue(undefined)
})

describe('WorkspaceAuditPage', () => {
  it('渲染过滤行与审计表（时间/操作者/动作/资源）', () => {
    stubAudit()
    renderPage()
    expect(screen.getByText('审计日志')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /查询/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /导出 CSV/ })).toBeInTheDocument()
    expect(screen.getByText('alice@example.com')).toBeInTheDocument()
    expect(screen.getByText('workspace.rename')).toBeInTheDocument()
    
    expect(
      screen.getByText((_, el) =>
        el?.getAttribute('data-slot') === 'data-table-pagination' &&
        /共\s*2\s*条\s*·\s*第\s*1\/1\s*页/.test(el.textContent ?? ''),
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  it('过滤条件随“查询”提交（日期补 RFC3339 边界），offset 归零', async () => {
    auditMocks.useAudit.mockImplementation((filters: { action: string; from: string; to: string }, _limit: number, offset: number) => ({
      wsId: 'ws-1', items: [], total: 0, loading: false, error: null, refetch: vi.fn(), _filters: filters, _offset: offset,
    }))
    renderPage()

    fireEvent.change(screen.getByPlaceholderText('如 workspace.rename'), { target: { value: 'workspace.rename' } })
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-10-05' } })
    fireEvent.click(screen.getByRole('button', { name: /查询/ }))

    await waitFor(() => expect(auditMocks.useAudit).toHaveBeenCalled())
    const lastCall = auditMocks.useAudit.mock.calls.at(-1)
    expect(lastCall?.[0]).toMatchObject({
      action: 'workspace.rename',
      from: '2026-10-01T00:00:00Z',
      to: '2026-10-05T23:59:59Z',
    })
    expect(lastCall?.[2]).toBe(0)
  })

  it('加载中显示 PageLoading；错误显示重试', () => {
    const { rerender } = renderPage()
    stubAudit({ loading: true, items: [] })
    rerender(<MemoryRouter><WorkspaceAuditPage /></MemoryRouter>)
    expect(screen.getByText('加载审计日志…')).toBeInTheDocument()

    stubAudit({ loading: false, items: [], error: new Error('boom') })
    rerender(<MemoryRouter><WorkspaceAuditPage /></MemoryRouter>)
    expect(screen.getByText('boom')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('导出 CSV 调用 exportAuditCsv（当前过滤条件）', async () => {
    stubAudit()
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /导出 CSV/ }))
    await waitFor(() => expect(auditMocks.exportAuditCsv).toHaveBeenCalledTimes(1))
    expect(toastMocks.success).toHaveBeenCalled()
  })
})
