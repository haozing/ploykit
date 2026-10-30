
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForgotPasswordPage } from '../ForgotPasswordPage'

// Turnstile 接线后本页改走 lib/turnstile → apiFetch（usePasswordReset 的
// requestReset 不支持自定义头）；无 site key 时行为与 api.post 等价。
const mockedApiFetch = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ploykit/client')>()
  return {
    ...actual,
    apiFetch: mockedApiFetch,
  }
})
// 页面读 /config 判断是否挂 Turnstile widget（默认未配置 → 零感知）。
// 注：pages/auth/__tests__ 比 auth/__tests__ 深一层，源文件相对路径易错，
// 这里直接 mock '@ploykit/hooks' 包（importActual 保真 + 覆写 useSiteConfig）。
vi.mock('@ploykit/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ploykit/hooks')>()
  return { ...actual, useSiteConfig: () => ({ data: undefined }) }
})

beforeEach(() => {
  mockedApiFetch.mockReset().mockResolvedValue(undefined)
})

describe('ForgotPasswordPage', () => {
  it('提交邮箱 → POST /auth/forgot-password {email}', async () => {
    render(<ForgotPasswordPage />)
    fireEvent.change(screen.getByLabelText('邮箱'), {
      target: { value: 'user@example.com' },
    })
    fireEvent.click(screen.getByRole('button', { name: '发送重置链接' }))

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/auth/forgot-password', {
        method: 'POST',
        body: { email: 'user@example.com' },
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
    mockedApiFetch.mockRejectedValueOnce(new Error('发送过于频繁'))
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

  it('未配置 Turnstile → 不渲染 widget、脚本零注入（产品零感知）', () => {
    render(<ForgotPasswordPage />)
    expect(screen.queryByTestId('turnstile-widget')).toBeNull()
    expect(document.getElementById('ploykit-turnstile-api')).toBeNull()
  })
})
