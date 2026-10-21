import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { AppProviders } from '../../AppProviders'
import { ConfirmProvider, useConfirm } from '../ConfirmDialog'

// 被测组件的动态 import（tabs / 确认弹窗）在全量并行下可能被调度挤到 10s 之外，
// 而失败信息是"找不到元素"——看起来像功能坏了。这里先预热同一个模块缓存，
// 组件的 import() 随后立即命中；测试因此只验证行为，不验证打包器的调度速度。
beforeAll(async () => {
  await import('../ConfirmDialogBody')
})

describe('useConfirm fail-fast（无 Provider 时必须抛错，不许静默返回 false）', () => {
  it('组件树里没有 ConfirmProvider 时，useConfirm 抛出对齐 hooks 包风格的错误', () => {
    function Probe() {
      useConfirm()
      return null
    }
    // 屏蔽 React 未捕获错误的噪音输出，只关心抛错本身
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => render(<Probe />)).toThrow('useConfirm must be used within ConfirmProvider')
    errSpy.mockRestore()
  })
})

// 弹窗本体是懒加载的（Base UI AlertDialog 约 23KB gzip，只在 confirm() 时下载），
// 所以这里的断言要等一次动态 import。单文件跑很快，全量并行时要给足超时。
describe('ConfirmProvider 内 useConfirm 的确认/取消契约', { timeout: 15_000 }, () => {
  it('探针组件调用 confirm，点击确认后 resolve(true)', async () => {
    const resolved = vi.fn()
    function Probe() {
      const confirm = useConfirm()
      return (
        <button
          onClick={() => {
            confirm({ title: '重置 API Key', description: '旧 Key 立即失效' }).then(resolved)
          }}
        >
          发起确认
        </button>
      )
    }
    render(
      <ConfirmProvider>
        <Probe />
      </ConfirmProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '发起确认' }))
    expect(await screen.findByText('重置 API Key', undefined, { timeout: 10_000 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(true))
  })

  it('点击取消时 resolve(false)', async () => {
    const resolved = vi.fn()
    function Probe() {
      const confirm = useConfirm()
      return (
        <button
          onClick={() => {
            confirm({ title: '危险操作' }).then(resolved)
          }}
        >
          发起确认
        </button>
      )
    }
    render(
      <ConfirmProvider>
        <Probe />
      </ConfirmProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '发起确认' }))
    expect(await screen.findByText('危险操作', undefined, { timeout: 10_000 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(false))
  })
})

describe('AppProviders（PloykitProvider > ConfirmProvider > Toaster 一步到位）', () => {  it('组合件内 useConfirm 可用：探针 confirm 后点击确认 resolve(true)', async () => {
    const resolved = vi.fn()
    function Probe() {
      const confirm = useConfirm()
      return (
        <button
          onClick={() => {
            confirm({ title: '删除工作区', danger: true }).then(resolved)
          }}
        >
          发起确认
        </button>
      )
    }
    // AppProviders 内部的 PloykitProvider 会在挂载时请求 /auth/me 与 /api/workspaces，
    // jsdom 环境无后端：stub fetch 返回 401，让 auth 层按未登录降级（这正是产品首屏路径）。
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 })))

    render(
      <AppProviders>
        <Probe />
      </AppProviders>,
    )

    fireEvent.click(screen.getByRole('button', { name: '发起确认' }))
    expect(await screen.findByText('删除工作区', undefined, { timeout: 10_000 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(true))

    fetchSpy.mockRestore()
  })
})

// 同一时刻只能显示一个弹窗：第二次 confirm() 会覆盖 state。若前一个 Promise
// 不结算，调用方（例如两个并发的删除按钮）的 await 永久挂起，按钮再也不复位。
describe('ConfirmProvider 并发 confirm()', () => {
  it('第二次调用按「取消」结算第一个 Promise，弹窗显示新请求', async () => {
    const first = vi.fn()
    const second = vi.fn()
    function Probe() {
      const confirm = useConfirm()
      // 同一事件里连调两次，模拟两个组件几乎同时发起确认（弹窗是模态的，
      // 真实场景里第二次请求来自仍挂在树上的另一个组件，而非用户点击）。
      return (
        <button
          onClick={() => {
            void confirm({ title: '第一个' }).then(first)
            void confirm({ title: '第二个' }).then(second)
          }}
        >
          连发两次
        </button>
      )
    }
    render(
      <ConfirmProvider>
        <Probe />
      </ConfirmProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: '连发两次' }))
    await waitFor(() => expect(first).toHaveBeenCalledWith(false))
    expect(await screen.findByText('第二个', undefined, { timeout: 10_000 })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(second).toHaveBeenCalledWith(true))
  })
})
