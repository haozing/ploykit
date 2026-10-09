import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../ErrorBoundary'


let shouldThrow = false
function Bomb() {
  if (shouldThrow) throw new Error('炸弹爆炸')
  return <div>正常内容</div>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    shouldThrow = false
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('子组件 throw 时渲染 fallback 文案', () => {
    shouldThrow = true
    render(
      <ErrorBoundary fallback={<div>自定义兜底</div>}>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText('自定义兜底')).toBeInTheDocument()
    expect(screen.queryByText('正常内容')).not.toBeInTheDocument()
  })

  it('函数式 fallback 的 reset() 后恢复渲染 children', () => {
    shouldThrow = true
    render(
      <ErrorBoundary fallback={(_error, reset) => <button onClick={reset}>重试</button>}>
        <Bomb />
      </ErrorBoundary>,
    )
    shouldThrow = false 
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })

  it('无 fallback 时显示默认错误态（含"出错了"与重试按钮）', () => {
    shouldThrow = true
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText('出错了')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('componentDidCatch 将错误记入 console.error', () => {
    shouldThrow = true
    render(
      <ErrorBoundary fallback={<div>ok</div>}>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(console.error).toHaveBeenCalled()
  })
})
