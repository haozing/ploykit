
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ResetPasswordPage } from '../ResetPasswordPage'

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

const STRONG_PW = 'Abcdef1234!'

function renderWithQuery(query: string) {
  const original = window.location.href
  window.history.replaceState(null, '', `/reset-password${query}`)
  const view = render(<ResetPasswordPage />)
  return {
    ...view,
    restore: () => window.history.replaceState(null, '', original),
  }
}

beforeEach(() => {
  mockedPost.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('ResetPasswordPage', () => {
  it('缺 email/token → 链接无效提示，不发请求', async () => {
    const v = renderWithQuery('')
    expect(await screen.findByTestId('reset-invalid')).toBeInTheDocument()
    expect(mockedPost).not.toHaveBeenCalled()
    v.restore()
  })

  it('有效提交 → POST /auth/reset-password {email, token, new_password}', async () => {
    const v = renderWithQuery('?email=user@example.com&token=tok-1')
    await screen.findByText('正在为 user@example.com 设置新密码')
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: STRONG_PW } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: STRONG_PW } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/reset-password', {
        email: 'user@example.com',
        token: 'tok-1',
        new_password: STRONG_PW,
      }),
    )
    v.restore()
  })

  it('P3-28：成功后 URL 中的 token 被清除 + 倒计时文案出现', async () => {
    const v = renderWithQuery('?email=user@example.com&token=tok-2')
    await screen.findByText('正在为 user@example.com 设置新密码')
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: STRONG_PW } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: STRONG_PW } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    expect(await screen.findByTestId('reset-done')).toBeInTheDocument()
    expect(screen.getByText(/秒后跳转登录页/)).toBeInTheDocument()
    await waitFor(() =>
      expect(window.location.search).not.toContain('token'),
    )
    v.restore()
  })

  it('P3-30：两次不一致 → 错误归因到确认字段，不发请求', async () => {
    const v = renderWithQuery('?email=user@example.com&token=tok-3')
    await screen.findByText('正在为 user@example.com 设置新密码')
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: STRONG_PW } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'Different123!' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    expect(await screen.findByText('两次输入的密码不一致')).toBeInTheDocument()
    expect(mockedPost).not.toHaveBeenCalled()
    v.restore()
  })

  it('P3-30：弱密码（少于三类）被前端拦截', async () => {
    const v = renderWithQuery('?email=user@example.com&token=tok-4')
    await screen.findByText('正在为 user@example.com 设置新密码')
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'abcdefghijk' } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: 'abcdefghijk' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      '需包含大写/小写/数字/符号中的至少三类',
    )
    expect(mockedPost).not.toHaveBeenCalled()
    v.restore()
  })

  it('服务端失败（令牌失效）→ 表单级 alert 展示', async () => {
    mockedPost.mockRejectedValueOnce(new Error('reset token expired'))
    const v = renderWithQuery('?email=user@example.com&token=stale')
    await screen.findByText('正在为 user@example.com 设置新密码')
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: STRONG_PW } })
    fireEvent.change(screen.getByLabelText('确认新密码'), { target: { value: STRONG_PW } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('reset token expired')
    v.restore()
  })
})
