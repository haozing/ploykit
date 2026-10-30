import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SignInModal } from '../SignInModal'



// 与 SignInForm.test 同款 hooks mock（__tests__ 相对深度一致：src/auth/__tests__）。
const loginMock = vi.hoisted(() => ({ submit: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../../../hooks/src/hooks/useLogin', () => ({
  useLogin: () => ({
    sendCode: vi.fn(),
    submit: loginMock.submit,
    loading: false,
    error: null,
  }),
}))
const mockedPost = vi.hoisted(() => vi.fn())
vi.mock('../../../../hooks/src/hooks/useApi', () => ({
  useApi: () => ({ post: mockedPost, get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }),
}))
const mockedRefresh = vi.hoisted(() => vi.fn())
vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({ refresh: mockedRefresh, user: null, workspaces: [], loading: false, logout: vi.fn() }),
}))
// useSignInFlow 读 /config 判断是否要求 Turnstile token（默认未配置 → 零感知）
vi.mock('../../../../hooks/src/hooks/useSiteConfig', () => ({
  useSiteConfig: () => ({ data: undefined }),
}))

const locState = vi.hoisted(() => ({ state: null as unknown }))
vi.mock('../../router', () => ({
  useLocation: () => ({ state: locState.state }),
}))

// jsdom 的 window.location 是 [LegacyUnforgeable]（assign 不可配置/不可替换），
// 硬导航收口到 hard-navigate 模块——这里 mock 该模块观察跳转目标。
const hardNavigateMock = vi.hoisted(() => vi.fn())
vi.mock('../hard-navigate', () => ({ hardNavigate: hardNavigateMock }))

beforeEach(() => {
  mockedPost.mockReset().mockResolvedValue({ user: { id: 'u1' }, expires_at: '2026-01-01T00:00:00Z' })
  mockedRefresh.mockReset().mockResolvedValue(undefined)
  locState.state = null
  hardNavigateMock.mockReset()
})

function setup(open: boolean, props: Partial<Parameters<typeof SignInModal>[0]> = {}) {
  const onOpenChange = vi.fn()
  render(<SignInModal open={open} onOpenChange={onOpenChange} {...props} />)
  return { onOpenChange }
}

describe('SignInModal 开合', () => {
  it('open 时渲染表单（Dialog + 默认邮箱先行形态）', async () => {
    const { container } = setup(true)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // 默认 flow='email-first'：首屏只有邮箱 + 主按钮，无 Tab
    expect(await screen.findByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    // 表单自带 h1 被关闭（showHeading=false），标题由 DialogTitle 承担
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    // Dialog 走 portal，内容挂在 document.body
    const titleEl = document.body.querySelector('[data-slot="dialog-title"]')
    expect(titleEl).not.toBeNull()
    expect(titleEl).toHaveTextContent('登录')
  })

  it('closed 时不渲染任何内容', () => {
    setup(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('邮箱')).toBeNull()
  })

  it('X 关闭按钮回调 onOpenChange(false)', () => {
    const { onOpenChange } = setup(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})

describe('SignInModal 成功语义（#24：默认整页硬跳转）', () => {
  it('未传 onSuccess：密码登录成功 → hardNavigate(回跳目标)，不回调 onOpenChange', async () => {
    locState.state = { from: '/admin/settings' }
    const { onOpenChange } = setup(true)

    fireEvent.click(await screen.findByRole('button', { name: '使用密码登录' }))
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(mockedRefresh).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(hardNavigateMock).toHaveBeenCalledWith('/admin/settings'))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('未传 onSuccess 且无深链：硬跳转默认目标 /app', async () => {
    setup(true)
    fireEvent.click(await screen.findByRole('button', { name: '使用密码登录' }))
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(hardNavigateMock).toHaveBeenCalledWith('/app'))
  })

  it('传入 onSuccess：不做任何导航，仅回调 onSuccess', async () => {
    const onSuccess = vi.fn()
    setup(true, { onSuccess })
    fireEvent.click(await screen.findByRole('button', { name: '使用密码登录' }))
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(hardNavigateMock).not.toHaveBeenCalled()
  })
})
