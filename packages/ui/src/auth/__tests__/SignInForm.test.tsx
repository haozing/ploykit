import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import type { ReactNode } from 'react'
import { SignInForm } from '../SignInForm'
import { KitLabelsProvider } from '../../labels/kit-labels'



// 与 LoginPage.test 同款相对深度 mock（src/<dir>/__tests__ → packages/hooks/src）：
// 打在 hooks 源文件上，@ploykit/hooks 的 re-export 随之生效。
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

const locState = vi.hoisted(() => ({ state: null as unknown }))
vi.mock('../../router', () => ({
  useLocation: () => ({ state: locState.state }),
}))

// 被测组件的动态 import（tabs / 确认弹窗）在全量并行下可能被调度挤到 10s 之外，
// 而失败信息是"找不到元素"——看起来像功能坏了。这里先预热同一个模块缓存，
// 组件的 import() 随后立即命中；测试因此只验证行为，不验证打包器的调度速度。
beforeAll(async () => {
  await import('../SignInFormTabs')
})

beforeEach(() => {
  loginMock.submit.mockReset().mockResolvedValue({ ok: true })
  mockedPost.mockReset().mockResolvedValue({ user: { id: 'u1' }, expires_at: '2026-01-01T00:00:00Z' })
  mockedRefresh.mockReset().mockResolvedValue(undefined)
  locState.state = null
})

function renderForm(props: Parameters<typeof SignInForm>[0], wrapper?: (n: ReactNode) => ReactNode) {
  return render(wrapper ? wrapper(<SignInForm {...props} />) : <SignInForm {...props} />)
}

describe('SignInForm flow="tabs"（老形态，显式启用）', () => {
  it('展示验证码登录 Tab，可切到密码登录并提交 /auth/login', async () => {
    renderForm({ flow: 'tabs' })
    // tabs 子模块是动态 import（不为不用它的形态付 Base UI 的字节）
    expect(await screen.findByRole('tab', { name: '验证码登录' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: '密码登录' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: '密码登录' }))
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret-password' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/login', {
        email: 'user@example.com',
        password: 'secret-password',
      }),
    )
    await waitFor(() => expect(mockedRefresh).toHaveBeenCalledTimes(1))
  })

  it('验证码模式：发送成功 → 重发倒计时，提交走 useLogin().submit', async () => {
    const onSuccess = vi.fn()
    renderForm({ onSuccess })

    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/send-code', { email: 'user@example.com' }),
    )
    expect(await screen.findByRole('button', { name: /重发（60s）/ })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('验证码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() => expect(loginMock.submit).toHaveBeenCalledWith('user@example.com', '123456'))
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('不带壳：不渲染 AuthShell 布局（消费方自行包壳）', () => {
    const { container } = renderForm({})
    // AuthShell 特征：min-h-svh 全屏容器
    expect(container.querySelector('.min-h-svh')).toBeNull()
  })
})

describe('SignInForm passwordOnly', () => {
  it('无验证码 Tab/发送按钮，密码表单直出', () => {
    renderForm({ passwordOnly: true })
    expect(screen.queryByRole('tab', { name: '验证码登录' })).toBeNull()
    expect(screen.queryByRole('button', { name: '发送' })).toBeNull()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
  })
})

describe('SignInForm email-first（渐进披露）', () => {
  it('发送成功前只有邮箱 + 发送按钮，验证码输入框不出现', () => {
    renderForm({ flow: 'email-first' })
    expect(screen.queryByRole('tab', { name: '验证码登录' })).toBeNull()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.queryByLabelText('验证码')).toBeNull()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('发送成功后验证码输入框才出现，可输入并提交登录', async () => {
    renderForm({ flow: 'email-first', onSuccess: vi.fn() })
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))

    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/send-code', { email: 'user@example.com' }),
    )
    const codeInput = await screen.findByLabelText('验证码')
    fireEvent.change(codeInput, { target: { value: '654321' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))

    await waitFor(() => expect(loginMock.submit).toHaveBeenCalledWith('user@example.com', '654321'))
  })
})

describe('SignInForm 默认形态 = email-first（前台推荐）', () => {
  it('不传 flow 时首屏无 Tab、只有邮箱 + 主按钮', () => {
    renderForm({})
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('「使用密码登录」切到密码表单，可切回验证码（不占首屏权重）', async () => {
    renderForm({})
    expect(screen.queryByLabelText('密码')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '使用密码登录' }))
    expect(await screen.findByLabelText('密码')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '改用验证码登录' }))
    expect(await screen.findByRole('button', { name: '发送' })).toBeInTheDocument()
  })

  it('密码登录经切换后仍走 POST /auth/login', async () => {
    mockedPost.mockClear()
    renderForm({})
    fireEvent.click(screen.getByRole('button', { name: '使用密码登录' }))
    fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'pw-123456' } })
    fireEvent.click(screen.getByRole('button', { name: '登录' }))
    await waitFor(() =>
      expect(mockedPost).toHaveBeenCalledWith('/auth/login', { email: 'a@b.co', password: 'pw-123456' }),
    )
  })
})

describe('SignInForm OAuth 置于表单之上（业界惯例）', () => {
  it('providers 存在时，OAuth 块在表单之前，并有"或使用邮箱"分隔', () => {
    renderForm({ oauthProviders: [{ id: 'google', label: 'Google' }] })
    const oauth = screen.getByTestId('oauth-providers')
    const emailInput = screen.getByLabelText('邮箱')
    // compareDocumentPosition: 4 = oauth 在 emailInput 之后?
    // 用 DOCUMENT_POSITION_FOLLOWING (4) 判断 emailInput 是否在 oauth 之后
    const rel = oauth.compareDocumentPosition(emailInput)
    expect(rel & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('或使用邮箱')).toBeInTheDocument()
  })

  // email-first 没有 Tab 概念，"或使用邮箱"是给邮箱表单做分隔；切到密码表单后
  // 分隔行必须让位（否则同一句话在两个表单上方重复出现）。
  it('切到密码表单后不再显示"或使用邮箱"分隔', async () => {
    renderForm({ oauthProviders: [{ id: 'google', label: 'Google' }] })
    expect(screen.getByText('或使用邮箱')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '使用密码登录' }))
    await screen.findByLabelText('密码')
    expect(screen.queryByText('或使用邮箱')).toBeNull()
  })

  // passwordOnly 是整页唯一形态，没有"邮箱表单是备选"这层语义，
  // 因此不应出现"或使用邮箱"分隔；但第三方按钮本身仍要在。
  it('passwordOnly 下不渲染"或使用邮箱"分隔，OAuth 按钮仍在', () => {
    renderForm({ passwordOnly: true, oauthProviders: [{ id: 'github', label: 'GitHub' }] })
    expect(screen.queryByText('或使用邮箱')).toBeNull()
    expect(screen.getByRole('link', { name: /GitHub/ })).toBeInTheDocument()
  })
})

describe('SignInForm 法律声明槽位', () => {
  it('termsUrl+privacyUrl 齐备 → 自动渲染「登录即同意 服务条款 与 隐私政策」', () => {
    renderForm({ termsUrl: 'https://e.com/terms', privacyUrl: 'https://e.com/privacy' })
    const terms = screen.getByRole('link', { name: '服务条款' })
    expect(terms).toHaveAttribute('href', 'https://e.com/terms')
    const privacy = screen.getByRole('link', { name: '隐私政策' })
    expect(privacy).toHaveAttribute('href', 'https://e.com/privacy')
    expect(screen.getByText(/登录即同意/)).toBeInTheDocument()
  })

  it('仅设置单个 URL → 不渲染法律行', () => {
    renderForm({ termsUrl: 'https://e.com/terms' })
    expect(screen.queryByRole('link', { name: '服务条款' })).toBeNull()
  })

  it('legalNote 传入即胜出（整行替换自动法律行）', () => {
    renderForm({
      legalNote: <span>自定义法律文案</span>,
      termsUrl: 'https://e.com/terms',
      privacyUrl: 'https://e.com/privacy',
    })
    expect(screen.getByText('自定义法律文案')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '服务条款' })).toBeNull()
    expect(screen.queryByRole('link', { name: '隐私政策' })).toBeNull()
  })
})

describe('SignInForm OAuth 槽位', () => {
  it('传入 providers 渲染第三方登录按钮（href 指向 /auth/oauth/{id}/start）', () => {
    renderForm({ oauthProviders: [{ id: 'github', label: 'GitHub' }] })
    expect(screen.getByRole('link', { name: /GitHub/ })).toHaveAttribute(
      'href',
      '/auth/oauth/github/start',
    )
  })

  it('不传 providers 不渲染第三方登录区块', () => {
    const { container } = renderForm({})
    expect(container.querySelector('a[href^="/auth/oauth/"]')).toBeNull()
  })
})

describe('SignInForm 文案覆盖（KitLabelsProvider）', () => {
  it('Provider 覆盖 Tab 文案与链接文案', async () => {
    renderForm(
      { flow: 'tabs' },
      (node) => (
        <KitLabelsProvider
          labels={{
            signInPasswordTab: '密码方式',
            signInCreateAccount: '注册新号',
            sendCode: '发验证码',
          }}
        >
          {node}
        </KitLabelsProvider>
      ),
    )
    expect(await screen.findByRole('tab', { name: '密码方式' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '注册新号' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '发验证码' })).toBeInTheDocument()
    // 未覆盖键落回默认值
    expect(screen.getByRole('tab', { name: '验证码登录' })).toBeInTheDocument()
  })

  it('resendWithCooldown 函数值键生效', async () => {
    renderForm(
      {},
      (node) => (
        <KitLabelsProvider labels={{ resendWithCooldown: (s) => `请等待 ${s} 秒` }}>
          {node}
        </KitLabelsProvider>
      ),
    )
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: '发送' }))
    expect(await screen.findByRole('button', { name: '请等待 60 秒' })).toBeInTheDocument()
  })
})
