import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

/**
 * 注册页的 zod 拦截端到端断言（zod/mini 迁移后）。
 *
 * schema 单测能证明规则本身是对的，但不能证明**表单真的接上了 resolver**。
 * 迁移期间如果 useZodForm 的类型放宽过度（例如 resolver 悄悄没装上），表单
 * 会直接把非法值发出去——用户看到的是服务端 400，而不是字段旁的提示。
 * 这里从真实表单提交，断言两件事：出现预期文案、且没有任何网络请求。
 */

const post = vi.fn()

vi.mock('@ploykit/client', () => ({
  api: { post: (...args: unknown[]) => post(...args), get: vi.fn(async () => ({})) },
  apiFetch: vi.fn(),
  isApiError: () => false,
}))
vi.mock('@ploykit/hooks', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ploykit/hooks')
  return {
    ...actual,
    useApi: () => ({ post }),
    useAuth: () => ({ refresh: vi.fn() }),
    useSiteConfig: () => ({ data: undefined }),
  }
})
vi.mock('@ploykit/ui', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@ploykit/ui')
  return actual
})

import { RegisterPage } from '../RegisterPage'

describe('RegisterPage：非法输入由 zod 拦截，不发请求', () => {
  beforeEach(() => {
    post.mockReset()
    post.mockResolvedValue({ user: { id: 'u1' }, expires_at: '' })
  })

  it('全空提交 → 邮箱与密码的文案都出现，且未调用 API', async () => {
    render(<RegisterPage />)
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    expect(await screen.findByText('请输入邮箱')).toBeInTheDocument()
    expect(await screen.findByText('密码至少 10 位')).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('合法邮箱 + 弱密码（仅小写）→ 触发复杂度文案，且未调用 API', async () => {
    render(<RegisterPage />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'abcdefghij' } })
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    expect(
      await screen.findByText('需包含大写/小写/数字/符号中的至少三类'),
    ).toBeInTheDocument()
    expect(post).not.toHaveBeenCalled()
  })

  it('合法输入 → 走到 API（证明拦截没有过度）', async () => {
    render(<RegisterPage />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Abcdef12345!' } })
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(post).toHaveBeenCalledWith('/auth/register', {
      email: 'user@example.com',
      password: 'Abcdef12345!',
    })
  })
})
