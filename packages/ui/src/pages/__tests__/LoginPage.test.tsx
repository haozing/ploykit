import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { LoginPage, loginRedirectTarget } from '../LoginPage'



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
// Turnstile 接线后发码走 lib/turnstile → apiFetch（密码登录仍走 api.post）
const mockedApiFetch = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ploykit/client')>()
  return { ...actual, apiFetch: mockedApiFetch }
})

const locState = vi.hoisted(() => ({ state: null as unknown }))
vi.mock('../../router', () => ({
  useLocation: () => ({ state: locState.state }),
}))

// 被测组件的动态 import（tabs / 确认弹窗）在全量并行下可能被调度挤到 10s 之外，
// 而失败信息是"找不到元素"——看起来像功能坏了。这里先预热同一个模块缓存，
// 组件的 import() 随后立即命中；测试因此只验证行为，不验证打包器的调度速度。
beforeAll(async () => {
  await import('../../auth/SignInFormTabs')
})

beforeEach(() => {
  mockedPost.mockReset().mockResolvedValue({ user: { id: 'u1' }, expires_at: '2026-01-01T00:00:00Z' })
  mockedApiFetch.mockReset().mockResolvedValue(undefined)
  mockedRefresh.mockReset().mockResolvedValue(undefined)
  locState.state = null
})

function renderLogin(props: Parameters<typeof LoginPage>[0]) {
  return render(<LoginPage {...props} />)
}

describe('LoginPage oauthProviders', () => {
  it('传入 providers 渲染第三方登录按钮（href 指向 /auth/oauth/{id}/start）', () => {
    renderLogin({
      oauthProviders: [
        { id: 'github', label: 'GitHub' },
        { id: 'google', label: 'Google' },
      ],
    })
    const gh = screen.getByRole('link', { name: /GitHub/ })
    expect(gh).toHaveAttribute('href', '/auth/oauth/github/start')
    const gg = screen.getByRole('link', { name: /Google/ })
    expect(gg).toHaveAttribute('href', '/auth/oauth/google/start')
  })

  it('不传 providers 时不渲染第三方登录区块', () => {
    const { container } = renderLogin({})
    expect(container.querySelector('a[href^="/auth/oauth/"]')).toBeNull()
  })
})

describe('LoginPage enableFedLogin', () => {
  it('enableFedLogin 渲染折叠的企业登录表单（原生 GET /auth/fed/start）', () => {
    const { container } = renderLogin({ enableFedLogin: true })
    const form = container.querySelector('form[action="/auth/fed/start"]')
    expect(form).not.toBeNull()
    expect(form).toHaveAttribute('method', 'get')
    const input = form!.querySelector('input[name="workspace"]')
    expect(input).not.toBeNull()
    expect(input).toHaveAttribute('required', '')
  })

  it('默认不渲染企业登录区块', () => {
    const { container } = renderLogin({})
    expect(container.querySelector('form[action="/auth/fed/start"]')).toBeNull()
  })

  it('enableFedLogin=false 显式传入也不渲染', () => {
    const { container } = renderLogin({ enableFedLogin: false })
    expect(container.querySelector('form[action="/auth/fed/start"]')).toBeNull()
  })
})

describe('LoginPage flow="tabs"（老形态，显式启用）', () => {
  it('展示验证码登录 Tab，可切到密码登录', async () => {
    renderLogin({ flow: 'tabs' })
    // tabs 子模块动态 import（不用 tabs 的形态不付 Base UI 的字节）
    expect(await screen.findByRole('tab', { name: '验证码登录' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '密码登录' })).toBeInTheDocument()
  })

  it('密码模式提交 → POST /auth/login 携带 email/password 并触发 onSuccess', async () => {
    const onSuccess = vi.fn()
    renderLogin({ flow: 'tabs', onSuccess })
    fireEvent.click(await screen.findByRole('tab', { name: '密码登录' }))

    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1))
    expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
      email: 'user@example.com',
      password: 'secret-password',
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('密码模式登录失败展示后端错误文案', async () => {
    mockedPost.mockRejectedValueOnce(new Error('邮箱或密码错误'))
    renderLogin({ flow: 'tabs' })
    fireEvent.click(await screen.findByRole('tab', { name: '密码登录' }))

    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'wrong' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    expect(await screen.findByText('邮箱或密码错误')).toBeInTheDocument()
  })
})

describe('LoginPage 验证码发送（P3-26）', () => {
  it('发送成功 → POST /auth/send-code，按钮进入重发倒计时（节流）', async () => {
    renderLogin({})
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/auth/send-code', {
        method: 'POST',
        body: { email: 'user@example.com' },
      }),
    )
    expect(await screen.findByRole('button', { name: /重发（60s）/ })).toBeDisabled()
  })

  it('发送失败 → 展示错误（role=alert），不误置"已发送"形态', async () => {
    mockedApiFetch.mockRejectedValueOnce(new Error('发送过于频繁'))
    renderLogin({})
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('发送过于频繁')
    
    expect(screen.getByRole('button', { name: '发送' })).toBeEnabled()
  })
})

describe('LoginPage 认证辅助链接（aiblog-15：未挂载路由须可隐藏）', () => {
  it('默认渲染 忘记密码/创建账号，指向 resetPath/registerPath 默认路由', () => {
    renderLogin({})
    expect(screen.getByRole('link', { name: '忘记密码？' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.getByRole('link', { name: '创建账号' })).toHaveAttribute('href', '/register')
  })

  it('resetPath/registerPath 传空串时对应链接隐藏（产品未挂载该路由）', () => {
    renderLogin({ resetPath: '', registerPath: '' })
    expect(screen.queryByRole('link', { name: '忘记密码？' })).toBeNull()
    expect(screen.queryByRole('link', { name: '创建账号' })).toBeNull()
  })

  it('仅隐藏 reset 链接时 register 链接仍渲染', () => {
    renderLogin({ resetPath: '' })
    expect(screen.queryByRole('link', { name: '忘记密码？' })).toBeNull()
    expect(screen.getByRole('link', { name: '创建账号' })).toBeInTheDocument()
  })

  it('自定义路径覆盖默认路由', () => {
    renderLogin({ resetPath: '/my-reset', registerPath: '/my-register' })
    expect(screen.getByRole('link', { name: '忘记密码？' })).toHaveAttribute('href', '/my-reset')
    expect(screen.getByRole('link', { name: '创建账号' })).toHaveAttribute('href', '/my-register')
  })
})

describe('LoginPage 深链回跳（B-settings-8）', () => {
  it('location.state.from 为站内路径时，登录成功回跳该路径', async () => {
    locState.state = { from: '/admin/settings' }
    const onSuccess = vi.fn()
    renderLogin({ flow: 'tabs', onSuccess })
    fireEvent.click(await screen.findByRole('tab', { name: '密码登录' }))

    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(mockedRefresh).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('loginRedirectTarget：仅站内相对路径可作回跳，站外/协议相对/缺失一律回退 /app', () => {
    expect(loginRedirectTarget('/admin/settings')).toBe('/admin/settings')
    expect(loginRedirectTarget('/app?x=1')).toBe('/app?x=1')
    expect(loginRedirectTarget('//evil.example.com')).toBe('/app')
    expect(loginRedirectTarget('https://evil.example.com')).toBe('/app')
    expect(loginRedirectTarget(undefined)).toBe('/app')
    expect(loginRedirectTarget(null)).toBe('/app')
    expect(loginRedirectTarget('')).toBe('/app')
    expect(loginRedirectTarget(123)).toBe('/app')
  })
})

describe('LoginPage passwordOnly（aifengkong #4：企业内部纯密码形态）', () => {
  it('passwordOnly 时无验证码 Tab/表单，密码表单直出', () => {
    const { container } = renderLogin({ passwordOnly: true })
    expect(screen.queryByRole('tab', { name: '验证码登录' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '密码登录' })).toBeNull()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    expect(container.querySelector('form')).not.toBeNull()
  })

  it('passwordOnly 提交走 /auth/login', async () => {
    const onSuccess = vi.fn()
    renderLogin({ passwordOnly: true, onSuccess })
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
        email: 'user@example.com',
        password: 'secret-password',
      }),
    )
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('passwordOnly 不影响其他形态：不传 passwordOnly 时走默认 email-first', () => {
    renderLogin({})
    // 默认形态已改为 email-first：首屏无 Tab，只有邮箱 + 主按钮
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })
})

