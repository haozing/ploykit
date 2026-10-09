import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SchedulesPage } from '../SchedulesPage'
import { browserTzLabel, formatDateTimeTz } from '../../../lib/utils'



const apiMocks = vi.hoisted(() => ({
  get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(),
}))
vi.mock('../../../hooks/useApi', () => ({ useApi: () => apiMocks }))

const clientPost = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', () => {
  class ApiError extends Error {
    status: number
    code?: string
    constructor(status: number, code: string | undefined, message: string) {
      super(message)
      this.status = status
      this.code = code
    }
  }
  return {
    api: { post: clientPost },
    ApiError,
    setWorkspaceIdProvider: vi.fn(),
  }
})

vi.mock('../../../hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    current: { id: 'ws-1', name: 'Acme', slug: 'acme', plan_code: 'free', role: 'owner' },
    switchTo: vi.fn(),
    clear: vi.fn(),
  }),
}))



const confirmMock = vi.hoisted(() => ({ calls: [] as Array<{ title?: string; description?: string }>, ret: true }))
vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => async (opts: { title?: string; description?: string }) => {
    confirmMock.calls.push(opts)
    return confirmMock.ret
  },
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(),
}))
vi.mock('../../../components/toast', () => ({ toast: toastMocks }))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <SchedulesPage />
    </QueryClientProvider>,
  )
}

const plan = {
  id: 'plan-1', workspace_id: 'ws-1', kind: 'task.cleanup',
  cron_expr: '0 9 * * *', timezone: 'Asia/Shanghai',
  next_fire_at: '2026-10-07T01:00:00Z', misfire: 'skip',
  last_fired_at: null, created_at: '2026-10-06T00:00:00Z', enabled: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  confirmMock.calls.length = 0
  confirmMock.ret = true
  apiMocks.get.mockImplementation(async (path: string) => {
    if (path === '/api/schedules') return { items: [plan] }
    throw new Error('unexpected GET ' + path)
  })
  apiMocks.post.mockResolvedValue(plan)
  apiMocks.patch.mockResolvedValue({ ...plan, enabled: false })
  apiMocks.delete.mockResolvedValue(undefined)
  clientPost.mockResolvedValue({ items: ['2026-10-07T01:00:00Z', '2026-10-08T01:00:00Z', '2026-10-09T01:00:00Z'] })
})

describe('SchedulesPage（调度页：列表/启停/新建）', () => {
  it('渲染计划表（kind/表达式/时区/错过策略/下次触发/Switch）', async () => {
    renderPage()
    expect(await screen.findByText('task.cleanup')).toBeInTheDocument()
    expect(screen.getByText('0 9 * * *')).toBeInTheDocument()
    expect(screen.getByText('Asia/Shanghai')).toBeInTheDocument()
    expect(screen.getByText('错过跳过')).toBeInTheDocument()
    expect(screen.getByText('每天 09:00')).toBeInTheDocument() 
    expect(screen.getByRole('switch', { name: /停用计划 task.cleanup/ })).toHaveAttribute('aria-checked', 'true')
  })

  it('Switch 停用 → PATCH /api/schedules/{id} {enabled:false}', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('switch', { name: /停用计划/ }))
    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('/api/schedules/plan-1', { enabled: false }),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('新建计划：填 kind + CronInput 预览 + 提交 POST /api/schedules', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: /创建计划/ }))

    fireEvent.change(await screen.findByLabelText('触发标识（kind）'), {
      target: { value: 'task.cleanup' },
    })

    
    fireEvent.change(screen.getByLabelText('Cron 表达式'), { target: { value: '0 9 * * *' } })
    fireEvent.click(screen.getByRole('button', { name: /预览下次 3 次/ }))
    await waitFor(() =>
      expect(clientPost).toHaveBeenCalledWith('/api/schedules/preview', {
        cron_expr: '0 9 * * *',
        timezone: expect.any(String),
        count: 3,
      }),
    )

    fireEvent.click(screen.getByRole('button', { name: '创建计划' }))
    await waitFor(() =>
      expect(apiMocks.post).toHaveBeenCalledWith('/api/schedules', {
        kind: 'task.cleanup',
        cron_expr: '0 9 * * *',
        timezone: expect.any(String),
        misfire: 'skip',
      }),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('空态：无计划时显示引导', async () => {
    apiMocks.get.mockResolvedValue({ items: [] })
    renderPage()
    expect(await screen.findByText('暂无调度计划')).toBeInTheDocument()
  })

  

  it('删除：确认弹窗回显 kind+下次触发+不可恢复，放行后 DELETE /api/schedules/{id}', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))

    
    expect(confirmMock.calls.length).toBe(1)
    expect(confirmMock.calls[0].title).toBe('删除调度计划')
    expect(confirmMock.calls[0].description).toContain('task.cleanup')
    expect(confirmMock.calls[0].description).toContain('每天 09:00')
    expect(confirmMock.calls[0].description).toContain('Asia/Shanghai')
    expect(confirmMock.calls[0].description).toContain('不可恢复')

    await waitFor(() => expect(apiMocks.delete).toHaveBeenCalledWith('/api/schedules/plan-1'))
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalledWith('计划 task.cleanup 已删除'))
  })

  it('删除：确认取消时不发 DELETE', async () => {
    confirmMock.ret = false
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => expect(confirmMock.calls.length).toBe(1))
    expect(apiMocks.delete).not.toHaveBeenCalled()
  })

  

  it('编辑：对话框回填行值（kind 只读），改 cron 提交 PATCH 只含改动字段', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))

    
    const kindInput = await screen.findByLabelText('触发标识（kind，不可修改）')
    expect(kindInput).toHaveValue('task.cleanup')
    expect(kindInput).toBeDisabled()
    expect(screen.getByLabelText('Cron 表达式')).toHaveValue('0 9 * * *')

    
    fireEvent.change(screen.getByLabelText('Cron 表达式'), { target: { value: '30 8 * * 1' } })
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))

    await waitFor(() =>
      expect(apiMocks.patch).toHaveBeenCalledWith('/api/schedules/plan-1', { cron_expr: '30 8 * * 1' }),
    )
    await waitFor(() => expect(toastMocks.success).toHaveBeenCalled())
  })

  it('编辑：无改动提交直接关窗，不发 PATCH', async () => {
    renderPage()
    fireEvent.click(await screen.findByRole('button', { name: '编辑' }))
    await screen.findByLabelText('触发标识（kind，不可修改）')
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }))
    await waitFor(() => expect(screen.queryByLabelText('触发标识（kind，不可修改）')).not.toBeInTheDocument())
    expect(apiMocks.patch).not.toHaveBeenCalled()
  })

  

  it('下次触发正文带 (GMT±X) 口径，title 提示计划时区与显示口径', async () => {
    renderPage()
    
    expect(await screen.findByText(formatDateTimeTz(plan.next_fire_at))).toBeInTheDocument()
    
    
    const labeled = screen.getByTitle(`计划时区 Asia/Shanghai；此处按浏览器本地时区（${browserTzLabel()}）显示`)
    expect(labeled).toHaveTextContent(formatDateTimeTz(plan.next_fire_at))
  })

  it('最近触发同样带口径标注（有值行）', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/api/schedules') {
        return { items: [{ ...plan, last_fired_at: '2026-10-06T01:00:00Z' }] }
      }
      throw new Error('unexpected GET ' + path)
    })
    renderPage()
    expect(await screen.findByText(formatDateTimeTz('2026-10-06T01:00:00Z'))).toBeInTheDocument()
  })

  

  it('kind code 带 break-all + max-w 收纳（100 字符边界不再把列推出视口）', async () => {
    apiMocks.get.mockImplementation(async (path: string) => {
      if (path === '/api/schedules') {
        const longKind = 'a'.repeat(100)
        return { items: [{ ...plan, kind: longKind }] }
      }
      throw new Error('unexpected GET ' + path)
    })
    renderPage()
    const code = await screen.findByText('a'.repeat(100))
    expect(code.tagName).toBe('CODE')
    expect(code).toHaveClass('break-all')
    expect(code.className).toContain('max-w-')
  })
})
