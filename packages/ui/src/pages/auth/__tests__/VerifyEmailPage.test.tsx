
import '@testing-library/jest-dom/vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { VerifyEmailPage } from '../VerifyEmailPage'

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

function renderWithQuery(query: string) {
  const original = window.location.href
  window.history.replaceState(null, '', `/verify-email${query}`)
  const view = render(<VerifyEmailPage />)
  return { ...view, restore: () => window.history.replaceState(null, '', original) }
}

beforeEach(() => {
  mockedPost.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('VerifyEmailPage', () => {
  it('有效参数 → POST /auth/verify-email → 成功态', async () => {
    const v = renderWithQuery('?email=user@example.com&token=tok-1')
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/verify-email', {
        email: 'user@example.com',
        token: 'tok-1',
      }),
    )
    expect(await screen.findByText('邮箱验证成功')).toBeInTheDocument()
    v.restore()
  })

  it('P3-28：成功后 URL 中的 token 被清除', async () => {
    const v = renderWithQuery('?email=user@example.com&token=tok-2')
    await screen.findByText('邮箱验证成功')
    await waitFor(() => expect(window.location.search).not.toContain('token'))
    v.restore()
  })

  it('缺参（无 token）→ 直接失败态，不发请求', async () => {
    const v = renderWithQuery('?email=user@example.com')
    expect(await screen.findByText('验证失败')).toBeInTheDocument()
    expect(mockedPost).not.toHaveBeenCalled()
    v.restore()
  })

  it('服务端拒绝（令牌失效）→ 失败态展示服务端语义', async () => {
    mockedPost.mockRejectedValueOnce(new Error('verify token expired'))
    const v = renderWithQuery('?email=user@example.com&token=stale')
    expect(await screen.findByText('验证失败')).toBeInTheDocument()
    expect(screen.getByText('verify token expired')).toBeInTheDocument()
    v.restore()
  })

  it('重渲染（StrictMode 双跑）不重复消费令牌：POST 恰一次', async () => {
    const v = renderWithQuery('?email=user@example.com&token=once')
    await screen.findByText('邮箱验证成功')
    expect(mockedPost).toHaveBeenCalledTimes(1)
    v.restore()
  })
})
