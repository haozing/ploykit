import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * RegisterPage 的 Turnstile 接线端到端行为（审计 §2.1 修正后的三处表单之一）：
 * site key 下发 → widget 挂载 → token 未就绪禁用提交 → token 就绪后请求带
 * X-Turnstile-Token 头 → 失败（400 E_TURNSTILE）出人话文案并 reset 重取。
 *
 * apiFetch 打在 '@ploykit/client' 包上（lib/turnstile 走的就是它），ApiError
 * 保留真实实现——E_TURNSTILE 文案断言依赖 instanceof 链路真实。
 */
const apiFetchMock = vi.hoisted(() => vi.fn())
vi.mock('@ploykit/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ploykit/client')>()
  return { ...actual, apiFetch: apiFetchMock }
})

const siteCfgState = vi.hoisted(() => ({
  data: undefined as { turnstile_site_key?: string } | undefined,
}))
vi.mock('@ploykit/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ploykit/hooks')>()
  return {
    ...actual,
    useApi: () => ({ post: vi.fn(), get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }),
    useAuth: () => ({ refresh: vi.fn() }),
    useSiteConfig: () => ({ data: siteCfgState.data }),
  }
})

import { ApiError } from '@ploykit/client'
import { RegisterPage } from '../RegisterPage'
import { __resetTurnstileForTests } from '../../../auth/TurnstileWidget'



function fillValidForm() {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'Abcdef12345!' } })
}

/** 安装 window.turnstile mock 并让已注入的 api.js「加载完成」。 */
function bootTurnstile() {
  let seq = 0
  const api = {
    render: vi.fn(() => `w${++seq}`),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  window.turnstile = api
  const script = document.getElementById('ploykit-turnstile-api') as HTMLScriptElement
  act(() => {
    script.dispatchEvent(new Event('load'))
  })
  return api
}

/** 等挑战通过，把 token 灌进表单。 */
async function solveChallenge(api: { render: ReturnType<typeof vi.fn> }, token: string) {
  await waitFor(() => expect(api.render).toHaveBeenCalled())
  act(() => api.render.mock.calls[0][1].callback(token))
}

beforeEach(() => {
  __resetTurnstileForTests()
  delete window.turnstile
  siteCfgState.data = undefined
  document.querySelectorAll('script').forEach((s) => s.remove())
  apiFetchMock.mockReset()
})

describe('RegisterPage × Turnstile：site key 缺失（未配置产品零感知）', () => {
  it('无 site key → 无 widget、无脚本，合法表单可直接提交且请求不带 token 头', async () => {
    siteCfgState.data = {}
    apiFetchMock.mockResolvedValue({ user: { id: 'u1' }, expires_at: '' })
    const onSuccess = vi.fn()
    render(<RegisterPage onSuccess={onSuccess} />)

    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/auth/register', {
        method: 'POST',
        body: { email: 'user@example.com', password: 'Abcdef12345!' },
      }),
    )
    expect(document.getElementById('ploykit-turnstile-api')).toBeNull()
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })
})

describe('RegisterPage × Turnstile：site key 存在', () => {
  it('token 未就绪 → 合法表单也禁用提交；拿到 token → 请求带 X-Turnstile-Token 头', async () => {
    siteCfgState.data = { turnstile_site_key: '1x00000000000000000000AA' }
    apiFetchMock.mockResolvedValue({ user: { id: 'u1' }, expires_at: '' })
    const onSuccess = vi.fn()
    render(<RegisterPage onSuccess={onSuccess} />)

    // widget 挂载 + api.js 注入，但用户尚未完成挑战
    expect(screen.getByTestId('turnstile-widget')).toBeInTheDocument()
    expect(document.getElementById('ploykit-turnstile-api')).not.toBeNull()
    fillValidForm()
    const submit = screen.getByRole('button', { name: '创建账号' })
    expect(submit).toBeDisabled()
    expect(apiFetchMock).not.toHaveBeenCalled()

    // 挑战通过 → 按钮解禁 → 提交带一次性 token 头
    const turnstile = bootTurnstile()
    await solveChallenge(turnstile, 'tok-once')
    expect(submit).toBeEnabled()
    fireEvent.click(submit)
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/auth/register', {
        method: 'POST',
        body: { email: 'user@example.com', password: 'Abcdef12345!' },
        headers: { 'X-Turnstile-Token': 'tok-once' },
      }),
    )
    await waitFor(() => expect(onSuccess).toHaveBeenCalled())
  })

  it('400 E_TURNSTILE → 人话文案 + widget reset（一次性 token 不可复用）', async () => {
    siteCfgState.data = { turnstile_site_key: '1x00000000000000000000AA' }
    apiFetchMock.mockRejectedValueOnce(
      new ApiError(400, 'E_TURNSTILE', 'turnstile verification failed'),
    )
    render(<RegisterPage onSuccess={vi.fn()} />)

    const turnstile = bootTurnstile()
    await solveChallenge(turnstile, 'tok-rejected')
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))

    // 错误码 → KNOWN_CODES 文案（lib/api-error 的映射表惯例）
    expect(await screen.findByText('人机验证未通过，请重新完成验证后再试')).toBeInTheDocument()
    // token 已被消费：widget reset 重新出题，提交回到禁用态
    await waitFor(() => expect(turnstile.reset).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: '创建账号' })).toBeDisabled()

    // 重取新 token 后可再次提交（新 token，不是旧值）
    apiFetchMock.mockResolvedValue({ user: { id: 'u1' }, expires_at: '' })
    await solveChallenge(turnstile, 'tok-fresh')
    expect(screen.getByRole('button', { name: '创建账号' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }))
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenLastCalledWith('/auth/register', {
        method: 'POST',
        body: { email: 'user@example.com', password: 'Abcdef12345!' },
        headers: { 'X-Turnstile-Token': 'tok-fresh' },
      }),
    )
  })
})
