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
    expect(await screen.findByLabelText('Email')).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
    // 表单自带 h1 被关闭（showHeading=false），标题由 DialogTitle 承担
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull()
    // Dialog 走 portal，内容挂在 document.body
    const titleEl = document.body.querySelector('[data-slot="dialog-title"]')
    expect(titleEl).not.toBeNull()
    expect(titleEl).toHaveTextContent('Sign in')
    // 防翻译扩展注入（审计 §3.5②）：弹层内容根带 translate="no"，
    // 标题/表单/错误文案整棵子树豁免机器翻译
    const contentEl = document.body.querySelector('[data-slot="dialog-content"]')
    expect(contentEl).not.toBeNull()
    expect(contentEl).toHaveAttribute('translate', 'no')
  })

  it('renderOAuth：非空时整块替换默认 OAuth 区（默认块与分隔行都不渲染）', async () => {
    setup(true, {
      oauthProviders: [{ id: 'google', label: 'Google' }],
      renderOAuth: <a data-testid="brand-google" href="/auth/oauth/google/start">Continue with Google</a>,
    })
    expect(await screen.findByTestId('brand-google')).toHaveAttribute(
      'href',
      '/auth/oauth/google/start',
    )
    // 默认块（oauth-providers 容器 + 默认文案按钮）被替换掉
    expect(screen.queryByTestId('oauth-providers')).toBeNull()
    expect(screen.queryByText('Sign in with Google')).toBeNull()
    expect(screen.queryByText('Or continue with email')).toBeNull()
    // 邮箱表单照常渲染（renderOAuth 只替换 OAuth 区）
    expect(screen.getByLabelText('Email')).toBeInTheDocument()
  })

  it('renderOAuth：未传 = 默认 OAuth 区照常（oauthProviders 渲染 + 分隔行）', async () => {
    setup(true, { oauthProviders: [{ id: 'google', label: 'Google' }] })
    expect(await screen.findByTestId('oauth-providers')).toBeInTheDocument()
    expect(screen.getByText('Sign in with Google')).toHaveAttribute(
      'href',
      '/auth/oauth/google/start',
    )
    expect(screen.getByText('Or continue with email')).toBeInTheDocument()
  })

  it('closed 时不渲染任何内容', () => {
    setup(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('Email')).toBeNull()
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

    fireEvent.click(await screen.findByRole('button', { name: 'Use password' }))
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(mockedRefresh).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(hardNavigateMock).toHaveBeenCalledWith('/admin/settings'))
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('未传 onSuccess 且无深链：硬跳转默认目标 /app', async () => {
    setup(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Use password' }))
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(hardNavigateMock).toHaveBeenCalledWith('/app'))
  })

  it('传入 onSuccess：不做任何导航，仅回调 onSuccess', async () => {
    const onSuccess = vi.fn()
    setup(true, { onSuccess })
    fireEvent.click(await screen.findByRole('button', { name: 'Use password' }))
    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(hardNavigateMock).not.toHaveBeenCalled()
  })
})

/* ==================== onRegister 弹层形态（2026-11-13） ====================
 * 弹层场景点 "Create account" 不应整页跳走（登录弹层关闭、消费方状态丢失）。
 * 不传 onRegister = <a href> 整页跳转现行为（独立登录/注册页零变化）。 */
describe('SignInModal onRegister（弹层形态）', () => {
  it('传入 onRegister：footer 变点按钮，点击触发回调且不导航', async () => {
    const onRegister = vi.fn()
    setup(true, { registerPath: '/register', onRegister })
    const link = await screen.findByTestId('register-link')
    // 按钮形态（非 <a href>）：点击不会离开当前文档
    expect(link.tagName).toBe('BUTTON')
    fireEvent.click(link)
    expect(onRegister).toHaveBeenCalledTimes(1)
    expect(hardNavigateMock).not.toHaveBeenCalled()
  })

  it('不传 onRegister：保持 <a href={registerPath}> 整页跳转现行为', async () => {
    setup(true, { registerPath: '/register' })
    const link = await screen.findByTestId('register-link')
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', '/register')
  })
})
