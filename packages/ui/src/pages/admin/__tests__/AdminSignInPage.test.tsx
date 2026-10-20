import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AdminSignInPage } from '../AdminSignInPage'

// 与 SignInForm/SignInModal 测试同款 hooks mock（打在 hooks 源文件上，
// @ploykit/hooks 的 re-export 随之生效；注意本目录比 src/auth/__tests__
// 深一层 → 五级相对路径）。
const loginMock = vi.hoisted(() => ({ submit: vi.fn(async () => ({ ok: true })) }))
vi.mock('../../../../../hooks/src/hooks/useLogin', () => ({
  useLogin: () => ({
    sendCode: vi.fn(),
    submit: loginMock.submit,
    loading: false,
    error: null,
  }),
}))
const mockedPost = vi.hoisted(() => vi.fn())
vi.mock('../../../../../hooks/src/hooks/useApi', () => ({
  useApi: () => ({ post: mockedPost, get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }),
}))
const mockedRefresh = vi.hoisted(() => vi.fn())
vi.mock('../../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({ refresh: mockedRefresh, user: null, workspaces: [], loading: false, logout: vi.fn() }),
}))

const locState = vi.hoisted(() => ({ state: null as unknown }))
vi.mock('../../../router', () => ({
  useLocation: () => ({ state: locState.state }),
}))

// 整页硬跳转收口在 hard-navigate 模块（#24，同 SignInModal）——mock 该模块
// 观察成功后的跳转目标，避免 jsdom LegacyUnforgeable location。
const hardNavigateMock = vi.hoisted(() => vi.fn())
vi.mock('../../../auth/hard-navigate', () => ({ hardNavigate: hardNavigateMock }))

beforeEach(() => {
  loginMock.submit.mockReset().mockResolvedValue({ ok: true })
  mockedPost.mockReset().mockResolvedValue({ user: { id: 'u1' }, expires_at: '2026-01-01T00:00:00Z' })
  mockedRefresh.mockReset().mockResolvedValue(undefined)
  locState.state = null
  hardNavigateMock.mockReset()
})

function renderPage(props: Parameters<typeof AdminSignInPage>[0] = {}) {
  return render(<AdminSignInPage {...props} />)
}

async function submitPassword() {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'root@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  await waitFor(() => expect(mockedRefresh).toHaveBeenCalledTimes(1))
}

describe('AdminSignInPage 专用门形态（#31 recipe）', () => {
  it('passwordOnly 直出：无验证码 Tab/发送按钮，无 OAuth/企业登录槽', () => {
    const { container } = renderPage()
    expect(screen.queryByRole('tab', { name: '验证码登录' })).toBeNull()
    expect(screen.queryByRole('tab', { name: '密码登录' })).toBeNull()
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    expect(container.querySelector('a[href^="/auth/oauth/"]')).toBeNull()
    expect(container.querySelector('form[action="/auth/fed/start"]')).toBeNull()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
  })

  it('默认无「创建账号」注册入口、无「忘记密码？」（registerPath 被压掉、resetPath 默认不传）', () => {
    renderPage()
    expect(screen.queryByTestId('register-link')).toBeNull()
    expect(screen.queryByRole('link', { name: '忘记密码？' })).toBeNull()
  })

  it('传入 resetPath 才渲染「忘记密码？」', () => {
    renderPage({ resetPath: '/admin/reset' })
    expect(screen.getByRole('link', { name: '忘记密码？' })).toHaveAttribute('href', '/admin/reset')
    expect(screen.queryByTestId('register-link')).toBeNull()
  })

  it('默认标题/描述为 sober 文案（管理控制台 · 仅限授权人员），可被 prop 覆盖', () => {
    const { rerender } = render(<AdminSignInPage />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('管理控制台')
    expect(screen.getByText('仅限授权人员')).toBeInTheDocument()

    rerender(<AdminSignInPage title="Ops Console" description="Staff only" />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Ops Console')
    expect(screen.getByText('Staff only')).toBeInTheDocument()
  })

  it('无营销壳：整页居中布局但不渲染 AuthShell 的 brand/footer 插槽 DOM', () => {
    // AuthShell 自身按需渲染 brand/footer；这里守的是本页不引入 AuthShell ——
    // 结构特征：单一 max-w-sm 容器 + 全屏 flex 居中。
    const { container } = renderPage()
    expect(container.querySelector('.min-h-svh')).not.toBeNull()
    expect(container.querySelector('.max-w-sm')).not.toBeNull()
  })
})

describe('AdminSignInPage 成功跳转（#24：整页硬跳转）', () => {
  it('深链 state.from 合法 → hardNavigate 回深链（AdminShell 带来的 from 优先）', async () => {
    locState.state = { from: '/admin/users' }
    renderPage()
    await submitPassword()
    await waitFor(() => expect(hardNavigateMock).toHaveBeenCalledWith('/admin/users'))
  })

  it('无深链 → 落 adminPath 默认 /admin（而非 SignInForm 的 /app）', async () => {
    renderPage()
    await submitPassword()
    await waitFor(() => expect(hardNavigateMock).toHaveBeenCalledWith('/admin'))
  })

  it('adminPath prop 覆盖兜底落点；站外深链被守卫拒绝后同样落 adminPath', async () => {
    locState.state = { from: 'https://evil.example.com' }
    renderPage({ adminPath: '/ops' })
    await submitPassword()
    await waitFor(() => expect(hardNavigateMock).toHaveBeenCalledWith('/ops'))
  })

  it('提交走 /auth/login（同一身份体系，只是换了门脸）', async () => {
    renderPage()
    await submitPassword()
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
        email: 'root@example.com',
        password: 'secret-password',
      }),
    )
  })
})
