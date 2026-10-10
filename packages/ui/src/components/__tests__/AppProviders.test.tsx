import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppProviders } from '../../AppProviders'
import { ConfirmProvider, useConfirm } from '../ConfirmDialog'

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

describe('ConfirmProvider 内 useConfirm 的确认/取消契约', () => {
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
    expect(await screen.findByText('重置 API Key')).toBeInTheDocument()

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
    expect(await screen.findByText('危险操作')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(false))
  })
})

describe('AppProviders（PloykitProvider > ConfirmProvider > Toaster 一步到位）', () => {
  it('组合件内 useConfirm 可用：探针 confirm 后点击确认 resolve(true)', async () => {
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
    expect(await screen.findByText('删除工作区')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认' }))
    await waitFor(() => expect(resolved).toHaveBeenCalledWith(true))

    fetchSpy.mockRestore()
  })
})
