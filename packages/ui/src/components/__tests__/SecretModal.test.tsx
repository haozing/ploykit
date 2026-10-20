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

  function setup(secretValue: string | string[], open: boolean, onOpenChange: (o: boolean) => void) {
    return render(
      <SecretModal
        open={open}
        onOpenChange={onOpenChange}
        secretName="个人访问令牌"
        secretValue={secretValue}
      />,
    )
  }

  it('数组值：逐项渲染 N 个只读输入框，且不出现单值复制按钮', () => {
    const values = ['tk_alpha', 'tk_beta', 'tk_gamma']
    setup(values, true, vi.fn())

    values.forEach((value, index) => {
      expect(screen.getByDisplayValue(value)).toBeInTheDocument()
      expect(screen.getByLabelText(`密钥 ${index + 1}（共 3 项，只显示一次）`)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: '复制' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '复制全部' })).toBeInTheDocument()
  })

  it('数组值：复制全部把各项以 \\n 连接写入剪贴板', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    setup(['tk_alpha', 'tk_beta'], true, vi.fn())

    fireEvent.click(screen.getByRole('button', { name: '复制全部' }))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '已复制全部' })).toBeInTheDocument(),
    )
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('tk_alpha\ntk_beta')
  })

  it('数组值：「我已保存」门控语义不变——确认前关闭钮禁用且 onOpenChange 不收到 false', () => {
    const onOpenChange = vi.fn()
    setup(['tk_alpha', 'tk_beta'], true, onOpenChange)

    expect(screen.getByRole('button', { name: '请先确认已保存' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: '请先确认已保存' }))
    expect(onOpenChange).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '我已保存' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('数组值切换为另一个数组：confirmed 与复制状态重置', async () => {
    const onOpenChange = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const { rerender } = setup(['tk_first_a', 'tk_first_b'], true, onOpenChange)

    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: '我已保存' })).toBeEnabled()

    rerender(
      <SecretModal
        open
        onOpenChange={onOpenChange}
        secretName="个人访问令牌"
        secretValue={['tk_second_a', 'tk_second_b']}
      />,
    )

    expect(await screen.findByDisplayValue('tk_second_a')).toBeInTheDocument()
    expect(screen.getByDisplayValue('tk_second_b')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('tk_first_a')).not.toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: '请先确认已保存' })).toBeDisabled()
  })

  it('单值传入 [单值] 数组：视觉与行为等价于字符串（join 后原串不变）', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    setup(['tk_solo'], true, vi.fn())

    expect(screen.getByLabelText('密钥（只显示一次）')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '复制全部' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '复制' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('tk_solo'))
  })

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

    
    expect(await screen.findByDisplayValue('tk_second')).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByRole('button', { name: '请先确认已保存' })).toBeDisabled()
    expect(screen.queryByDisplayValue('tk_first')).not.toBeInTheDocument()
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

    expect(await screen.findByDisplayValue('tk_first')).toBeInTheDocument()
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
