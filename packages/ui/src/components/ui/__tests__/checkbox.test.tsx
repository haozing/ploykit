import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Checkbox } from '../checkbox'

describe('checkbox 冒烟', () => {
  it('点击切换 aria-checked 并触发 onCheckedChange', () => {
    const onChange = vi.fn()
    render(<Checkbox defaultChecked onCheckedChange={onChange} aria-label="同意条款" />)

    const cb = screen.getByRole('checkbox', { name: '同意条款' })
    expect(cb).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(cb)
    expect(cb).toHaveAttribute('aria-checked', 'false')
    expect(onChange).toHaveBeenCalledWith(false, expect.anything())
  })
})
