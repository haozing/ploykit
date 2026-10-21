import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DatePicker } from '../DatePicker'

describe('DatePicker', () => {
  it('空值显示占位文案，有值时回显 Y-M-D', () => {
    const { rerender } = render(<DatePicker value={null} onChange={() => {}} />)
    expect(screen.getByText('选择日期')).toBeInTheDocument()
    rerender(<DatePicker value={new Date(2026, 7, 1)} onChange={() => {}} />)
    expect(screen.getByDisplayValue('2026-08-01')).toBeInTheDocument()
    expect(screen.queryByText('选择日期')).not.toBeInTheDocument()
  })

  it('本地时区取日期，不做 UTC 偏移（8 月 1 日不退成 7 月 31 日）', () => {
    // 本地 2026-08-01T00:00；若实现误用 toISOString()，UTC+8 下会输出 2026-07-31
    render(<DatePicker value={new Date(2026, 7, 1, 0, 0, 0)} onChange={() => {}} />)
    expect(screen.getByDisplayValue('2026-08-01')).toBeInTheDocument()
  })

  it('选择日期回调本地 00:00 Date', () => {
    const onChange = vi.fn()
    render(<DatePicker value={null} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue(''), { target: { value: '2026-12-31' } })
    expect(onChange).toHaveBeenCalledTimes(1)
    const d = onChange.mock.calls[0][0] as Date
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(11)
    expect(d.getDate()).toBe(31)
    expect(d.getHours()).toBe(0)
  })

  it('清空输入回调 null', () => {
    const onChange = vi.fn()
    render(<DatePicker value={new Date(2026, 0, 15)} onChange={onChange} />)
    fireEvent.change(screen.getByDisplayValue('2026-01-15'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('clearable：有值时点清除按钮回调 null，无值时不渲染', () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <DatePicker value={new Date(2026, 0, 15)} onChange={onChange} clearable />,
    )
    fireEvent.click(screen.getByRole('button', { name: '清除日期' }))
    expect(onChange).toHaveBeenCalledWith(null)

    rerender(<DatePicker value={null} onChange={onChange} clearable />)
    expect(screen.queryByRole('button', { name: '清除日期' })).not.toBeInTheDocument()
  })

  it('min/max 以本地日历日下发到原生 input', () => {
    render(
      <DatePicker
        value={null}
        onChange={() => {}}
        min={new Date(2026, 0, 1)}
        max={new Date(2026, 11, 31)}
      />,
    )
    const input = document.querySelector('input[type="date"]') as HTMLInputElement
    expect(input).toHaveAttribute('min', '2026-01-01')
    expect(input).toHaveAttribute('max', '2026-12-31')
  })

  it('disabled 时 input 禁用', () => {
    render(<DatePicker value={null} onChange={() => {}} disabled />)
    expect(document.querySelector('input[type="date"]')).toBeDisabled()
  })

  it('id / aria-label 透传到原生 input（表单可关联）', () => {
    render(<DatePicker id="expire-at" value={null} onChange={() => {}} aria-label="到期日期" />)
    const input = screen.getByLabelText('到期日期')
    expect(input).toHaveAttribute('id', 'expire-at')
    expect(input).toHaveAttribute('type', 'date')
  })
})
