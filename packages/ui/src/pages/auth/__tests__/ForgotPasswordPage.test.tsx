
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForgotPasswordPage } from '../ForgotPasswordPage'

const mockedPost = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', () => ({
  api: {
    post: mockedPost,
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

beforeEach(() => {
  mockedPost.mockReset().mockResolvedValue(undefined)
})

describe('ForgotPasswordPage', () => {
  it('提交邮箱 → POST /auth/forgot-password {email}', async () => {
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送重置链接' }))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/forgot-password', {
        email: 'user@example.com',
      }),
    )
  })

  it('防枚举：无论结果，成功提示同一句（不区分邮箱是否存在）', async () => {
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'whoever@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送重置链接' }))

    expect(await screen.findByTestId('sent-hint')).toHaveTextContent(
      '如果该邮箱存在，重置链接已发送，请查收邮箱。',
    )
  })

  it('请求失败 → 展示错误（不伪装成已发送）', async () => {
    mockedPost.mockRejectedValueOnce(new Error('发送过于频繁'))
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送重置链接' }))

    expect(await screen.findByText('发送过于频繁')).toBeInTheDocument()
    expect(screen.queryByTestId('sent-hint')).not.toBeInTheDocument()
  })

  it('空邮箱不可提交（按钮禁用）', () => {
    render(<ForgotPasswordPage />)
    expect(
      screen.getByRole('button', { name: '发送重置链接' }),
    ).toBeDisabled()
  })
})
