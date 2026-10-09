import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useState } from 'react'
import { CronInput, describeCron, timezoneOptions, type CronValue } from '../CronInput'





const mockedPost = vi.hoisted(() => vi.fn())
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
    api: { post: mockedPost },
    ApiError,
    setWorkspaceIdProvider: vi.fn(),
  }
})


function Harness({ initial }: { initial: CronValue }) {
  const [v, setV] = useState(initial)
  return <CronInput value={v} onChange={setV} />
}

function renderInput(initial: CronValue = { cron: '', timezone: 'UTC' }) {
  return render(<Harness initial={initial} />)
}

beforeEach(() => {
  mockedPost.mockReset()
})

describe('CronInput（批次 11 前端件：预览走后端 cronx 单一事实源）', () => {
  it('空表达式：提示五字段格式，预览按钮禁用', () => {
    renderInput()
    expect(screen.getByTestId('cron-hint')).toHaveTextContent('五字段：分 时 日 月 周')
    expect(screen.getByRole('button', { name: /预览下次 3 次/ })).toBeDisabled()
  })

  it('输入校验（人类可读描述）：常见档位映射中文短语', () => {
    renderInput()
    const input = screen.getByLabelText('Cron 表达式')
    fireEvent.change(input, { target: { value: '0 9 * * *' } })
    expect(screen.getByTestId('cron-hint')).toHaveTextContent('每天 09:00')

    fireEvent.change(input, { target: { value: '15 * * * *' } })
    expect(screen.getByTestId('cron-hint')).toHaveTextContent('每小时（第 15 分）')
  })

  it('describeCron 纯函数：每分钟/每周/复杂表达式原样显示', () => {
    expect(describeCron('* * * * *')).toBe('每分钟')
    expect(describeCron('30 8 * * 1')).toBe('每周一 08:30')
    expect(describeCron('0 9 1 * *')).toBe('0 9 1 * *') 
    expect(describeCron('not cron')).toBe('not cron')
  })

  it('时区下拉：内置常用列表兜底可用，切换更新所选时区', () => {
    const zones = timezoneOptions()
    expect(zones.length).toBeGreaterThan(0)
    expect(zones).toContain('UTC')
    expect(zones).toContain('Asia/Shanghai')

    renderInput()
    const select = screen.getByLabelText('时区')
    expect((select as HTMLSelectElement).value).toBe('UTC')
    fireEvent.change(select, { target: { value: 'Asia/Shanghai' } })
    expect((select as HTMLSelectElement).value).toBe('Asia/Shanghai')
  })

  it('预览：POST /api/schedules/preview {cron_expr, timezone, count} 并渲染 3 项', async () => {
    mockedPost.mockResolvedValue({
      items: ['2026-10-07T01:00:00Z', '2026-10-08T01:00:00Z', '2026-10-09T01:00:00Z'],
    })
    renderInput({ cron: '0 9 * * *', timezone: 'Asia/Shanghai' })

    fireEvent.click(screen.getByRole('button', { name: /预览下次 3 次/ }))
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/api/schedules/preview', {
        cron_expr: '0 9 * * *',
        timezone: 'Asia/Shanghai',
        count: 3,
      }),
    )

    const items = await screen.findAllByRole('listitem', {}, { container: screen.getByTestId('cron-preview') })
    expect(items).toHaveLength(3)
    
    expect(items[0].textContent).toContain('09:00')
    expect(items[0].textContent).toContain('2026')
  })

  it('预览失败：展示可读错误（服务端 E_INVALID_CRON 等透传）', async () => {
    mockedPost.mockRejectedValue(new Error('invalid cron expression'))
    renderInput({ cron: 'bad', timezone: 'UTC' })

    fireEvent.click(screen.getByRole('button', { name: /预览下次 3 次/ }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('invalid cron expression')
    expect(screen.queryByTestId('cron-preview')).not.toBeInTheDocument()
  })

  it('disabled：表达式输入、时区下拉与预览按钮全部禁用', () => {
    render(
      <CronInput
        value={{ cron: '0 9 * * *', timezone: 'UTC' }}
        onChange={() => {}}
        disabled
      />,
    )
    expect(screen.getByLabelText('Cron 表达式')).toBeDisabled()
    expect(screen.getByLabelText('时区')).toBeDisabled()
    expect(screen.getByRole('button', { name: /预览/ })).toBeDisabled()
  })
})

describe('B5：describeCron 周几中文与越界回退', () => {
  it('每周档位输出中文周几（0/7 均为周日）', () => {
    expect(describeCron('30 8 * * 1')).toBe('每周一 08:30')
    expect(describeCron('0 9 * * 5')).toBe('每周五 09:00')
    expect(describeCron('0 9 * * 0')).toBe('每周日 09:00')
    expect(describeCron('0 9 * * 7')).toBe('每周日 09:00')
  })

  it('数值域越界/非整数回退原表达式，不再伪翻译"每天 99:99"', () => {
    expect(describeCron('99 99 * * *')).toBe('99 99 * * *') 
    expect(describeCron('0 25 * * *')).toBe('0 25 * * *') 
    expect(describeCron('61 * * * *')).toBe('61 * * * *') 
    expect(describeCron('0 9 * * 8')).toBe('0 9 * * 8') 
    expect(describeCron('abc 9 * * *')).toBe('abc 9 * * *') 
  })

  it('合法档位翻译不受影响（每分钟/每小时/每天）', () => {
    expect(describeCron('* * * * *')).toBe('每分钟')
    expect(describeCron('15 * * * *')).toBe('每小时（第 15 分）')
    expect(describeCron('0 9 * * *')).toBe('每天 09:00')
  })
})

describe('P3-8：过期响应守卫与输入变化失效', () => {
  it('在途响应晚归被丢弃：预览中改时区后，旧请求结果不再上屏', async () => {
    let resolveFirst!: (v: { items: string[] }) => void
    mockedPost.mockImplementationOnce(() =>
      new Promise((res) => {
        resolveFirst = res as typeof resolveFirst
      }),
    )
    renderInput({ cron: '0 9 * * *', timezone: 'UTC' })
    fireEvent.click(screen.getByRole('button', { name: /预览下次/ }))

    
    
    fireEvent.change(screen.getByLabelText('时区'), { target: { value: 'Asia/Shanghai' } })
    resolveFirst({ items: ['2026-10-09T09:00:00Z'] })
    await Promise.resolve()
    expect(screen.queryByTestId('cron-preview')).not.toBeInTheDocument()
    
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /预览下次/ })).toBeEnabled())
  })

  it('预览在途/完成后修改时区：旧列表立即失效（不被误读为当前时区的语义）', async () => {
    mockedPost.mockResolvedValue({ items: ['2026-10-09T09:00:00Z'] })
    renderInput({ cron: '0 9 * * *', timezone: 'UTC' })
    fireEvent.click(screen.getByRole('button', { name: /预览下次/ }))
    expect(await screen.findByTestId('cron-preview')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('时区'), { target: { value: 'Asia/Shanghai' } })
    expect(screen.queryByTestId('cron-preview')).not.toBeInTheDocument()
  })
})
