import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SecretModal } from '../SecretModal'




describe('SecretModal', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  function setup(secretValue: string, open: boolean, onOpenChange: (o: boolean) => void) {
    return render(
      <SecretModal
        open={open}
        onOpenChange={onOpenChange}
        secretName="个人访问令牌"
        secretValue={secretValue}
      />,
    )
  }

  it('轮换双密钥：确认第一个后展示第二个，复选框与关闭钮必须回到初始禁用态', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = setup('tk_first', true, onOpenChange)

    
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: '我已保存' })).toBeEnabled()

    
    rerender(
      <SecretModal
        open
        onOpenChange={onOpenChange}
        secretName="个人访问令牌"
        secretValue="tk_second"
      />,
    )

    
    expect(await screen.findByText('tk_second')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: '请先确认已保存' })).toBeDisabled()
    expect(screen.queryByText('tk_first')).not.toBeInTheDocument()
  })

  it('关闭再打开同一组件：confirmed 同样重置', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = setup('tk_first', true, onOpenChange)

    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: '我已保存' })).toBeEnabled()

    rerender(
      <SecretModal
        open={false}
        onOpenChange={onOpenChange}
        secretName="个人访问令牌"
        secretValue="tk_first"
      />,
    )
    rerender(
      <SecretModal
        open
        onOpenChange={onOpenChange}
        secretName="个人访问令牌"
        secretValue="tk_first"
      />,
    )

    expect(await screen.findByText('tk_first')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: '请先确认已保存' })).toBeDisabled()
  })

  it('复制后 copied 状态随 secretValue 变化重置', async () => {
    const onOpenChange = vi.fn()
    const { rerender } = setup('tk_first', true, onOpenChange)

    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeInTheDocument())

    rerender(
      <SecretModal
        open
        onOpenChange={onOpenChange}
        secretName="个人访问令牌"
        secretValue="tk_second"
      />,
    )
    expect(await screen.findByRole('button', { name: '复制' })).toBeInTheDocument()
  })

  
  it('复制失败如实提示手动复制，不显示"已复制"', async () => {
    vi.stubGlobal('navigator', {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    setup('tk_first', true, vi.fn())

    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '复制失败，请手动复制' })).toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument()
  })
})
