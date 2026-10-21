import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmProvider, useConfirm } from '../ConfirmDialog'

/**
 * 弹窗 chunk 加载失败时的结算契约。
 *
 * 弹窗本体是动态 import（Base UI AlertDialog 约 23KB gzip，只在 confirm()
 * 时下载）。这条路径最容易漏的失败模式不是"弹窗不出现"，而是**Promise 永不
 * 结算**：调用方 `const ok = await confirm(); setBusy(false)` 会永远停在
 * loading，按钮再也点不动。所以加载失败必须按「取消」结算。
 *
 * 这里把模块工厂做成永久拒绝，模拟部署缺 chunk / 断网。
 */
vi.mock('../ConfirmDialogBody', () => {
  throw new Error('chunk load failed (simulated)')
})

describe('ConfirmProvider：弹窗模块加载失败', () => {
  it('按「取消」结算 Promise，不把调用方挂死', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const resolved = vi.fn()

    function Probe() {
      const confirm = useConfirm()
      return (
        <button onClick={() => void confirm({ title: '删除工作区' }).then(resolved)}>
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

    await waitFor(() => expect(resolved).toHaveBeenCalledWith(false))
    // 失败后不残留弹窗层
    expect(screen.queryByText('删除工作区')).toBeNull()
    expect(errSpy).toHaveBeenCalled()
    errSpy.mockRestore()
  })
})
