import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, it, expect } from 'vitest'
import { Textarea } from '../textarea'

describe('textarea 冒烟', () => {
  it('渲染为 textarea 且 data-slot 正确', () => {
    render(<Textarea data-testid="ta" placeholder="备注" />)
    const ta = screen.getByTestId('ta')
    expect(ta.tagName).toBe('TEXTAREA')
    expect(ta).toHaveAttribute('data-slot', 'textarea')
    expect(ta).toHaveAttribute('placeholder', '备注')
  })

  it('className 合并：自定义类与基础类共存，同族类后者覆盖', () => {
    render(<Textarea data-testid="ta" className="min-h-32 custom-x" />)
    const cls = screen.getByTestId('ta').className
    expect(cls).toContain('custom-x')
    expect(cls).toContain('border-input')
    // tailwind-merge：同族冲突时用户类覆盖基础类
    expect(cls).not.toMatch(/(^|\s)min-h-16(\s|$)/)
    expect(cls).toMatch(/(^|\s)min-h-32(\s|$)/)
  })

  it('ref 正确转发到 DOM 节点', () => {
    const ref = createRef<HTMLTextAreaElement>()
    render(<Textarea ref={ref} defaultValue="hello" />)
    expect(ref.current).not.toBeNull()
    expect(ref.current?.tagName).toBe('TEXTAREA')
    expect(ref.current?.value).toBe('hello')
  })

  it('aria-invalid 语义类在基础类中（token 合同同族）', () => {
    render(<Textarea data-testid="ta" aria-invalid />)
    const cls = screen.getByTestId('ta').className
    expect(cls).toContain('aria-invalid:border-destructive')
    expect(cls).toContain('dark:bg-input/30')
    expect(cls).toContain('min-h-16')
  })
})
