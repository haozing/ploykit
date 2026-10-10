import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OnboardingChecklist } from '../OnboardingChecklist'

vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: { email: 'alice@example.com', display_name: 'Alice' },
    workspaces: [{ id: 'ws-1', name: 'Acme' }],
    loading: false,
    refresh: vi.fn(),
    logout: vi.fn(),
  }),
}))

describe('OnboardingChecklist', () => {
  beforeEach(() => localStorage.clear())

  it('按 items 渲染步骤与进度值', () => {
    render(
      <OnboardingChecklist
        items={[
          { key: 'ws', label: '创建工作区', done: true },
          { key: 'invite', label: '邀请成员', done: false, onClick: () => {} },
        ]}
      />,
    )
    expect(screen.getByText('创建工作区')).toBeInTheDocument()
    expect(screen.getByText('邀请成员')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('已完成 1/2 项')).toBeInTheDocument()
  })

  it('点击未完成且带 onClick 的步骤触发回调；已完成项不触发', () => {
    const onClick = vi.fn()
    render(
      <OnboardingChecklist
        items={[
          { key: 'ws', label: '创建工作区', done: true },
          { key: 'invite', label: '邀请成员', done: false, onClick },
        ]}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /邀请成员/ }))
    expect(onClick).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: /创建工作区/ }))
    expect(screen.getByRole('button', { name: /创建工作区/ })).toBeDisabled()
  })

  it('关闭后写入 localStorage 并不再渲染', () => {
    const { rerender } = render(<OnboardingChecklist items={[{ key: 'a', label: 'A', done: false }]} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭引导清单' }))
    expect(localStorage.getItem('pk_onboarding_dismissed')).toBe('1')
    rerender(<OnboardingChecklist items={[{ key: 'a', label: 'A', done: false }]} />)
    expect(screen.queryByText('A')).not.toBeInTheDocument()
  })

  it('不传 items 时用上下文默认项（已有工作区 → 完成）', () => {
    render(<OnboardingChecklist />)
    expect(screen.getByText('创建第一个工作区')).toBeInTheDocument()
    expect(screen.getByText('100%')).toBeInTheDocument()
  })

  

  it('localStorage 已有关闭标记：渲染期输出与标记无关（双端一致），mount 后同步为关闭', () => {
    localStorage.setItem('pk_onboarding_dismissed', '1')
    
    const html = renderToString(
      <OnboardingChecklist items={[{ key: 'a', label: '引导项A', done: false }]} />,
    )
    expect(html).toContain('引导项A')
    
    render(<OnboardingChecklist items={[{ key: 'a', label: '引导项A', done: false }]} />)
    expect(screen.queryByText('引导项A')).not.toBeInTheDocument()
  })

  it('localStorage 不可用：渲染与关闭都不炸（effect/事件期兜底），按未关闭处理', () => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      render(<OnboardingChecklist items={[{ key: 'a', label: 'A', done: false }]} />)
      expect(screen.getByText('A')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: '关闭引导清单' }))
      expect(screen.queryByText('A')).not.toBeInTheDocument()
    } finally {
      Object.defineProperty(globalThis, 'localStorage', desc!)
    }
  })
})
