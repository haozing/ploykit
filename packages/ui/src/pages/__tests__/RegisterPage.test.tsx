import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { RegisterPage } from '../auth/RegisterPage'



const mockedPost = vi.hoisted(() => vi.fn())
const mockedRefresh = vi.hoisted(() => vi.fn())
vi.mock('../../hooks/useApi', () => ({
  useApi: () => ({ post: mockedPost, get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }),
}))
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ refresh: mockedRefresh, user: null, workspaces: [], loading: false, logout: vi.fn() }),
}))


vi.mock('../../hooks/useSiteConfig', () => ({
  useSiteConfig: () => ({ data: { allow_signup: '1' } }),
}))

const STRONG_PW = 'Abcdef1234!'

beforeEach(() => {
  mockedPost.mockReset().mockResolvedValue({ user: { id: 'u1' }, expires_at: '2026-01-01T00:00:00Z' })
  mockedRefresh.mockReset().mockResolvedValue(undefined)
})

function fillValidForm() {
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: STRONG_PW } })
  fireEvent.change(screen.getByLabelText('昵称（可选）'), { target: { value: '小明' } })
}

describe('RegisterPage', () => {
  it('渲染表单字段与"已有账号？登录"入口', () => {
    render(<RegisterPage />)
    expect(screen.getByLabelText('邮箱')).toBeInTheDocument()
    expect(screen.getByLabelText('密码')).toBeInTheDocument()
    expect(screen.getByLabelText('昵称（可选）')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /创建账号/ })).toBeInTheDocument()
  })

  it('弱密码（少于三类字符）被 zod 拦截，不发起请求', async () => {
    render(<RegisterPage />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'abcdefghijk' } }) 
    fireEvent.click(screen.getByRole('button', { name: /创建账号/ }))

    expect(await screen.findByText('需包含大写/小写/数字/符号中的至少三类')).toBeInTheDocument()
    expect(mockedPost).not.toHaveBeenCalled()
  })

  it('有效提交 → POST /auth/register 携带正确 payload 并触发 onSuccess', async () => {
    const onSuccess = vi.fn()
    render(<RegisterPage onSuccess={onSuccess} />)
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: /创建账号/ }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1))
    expect(mockedPost).toHaveBeenCalledWith('/auth/register', {
      email: 'user@example.com',
      password: STRONG_PW,
      display_name: '小明',
    })
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
    expect(mockedRefresh).toHaveBeenCalledTimes(1)
  })

  it('P1-2：昵称留空 → 不发 display_name 字段（空串会被服务端 400）', async () => {
    const onSuccess = vi.fn()
    render(<RegisterPage onSuccess={onSuccess} />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: STRONG_PW } })
    
    fireEvent.click(screen.getByRole('button', { name: /创建账号/ }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1))
    const payload = mockedPost.mock.calls[0][1] as Record<string, unknown>
    expect('display_name' in payload).toBe(false)
    expect(payload.email).toBe('user@example.com')
    expect(payload.password).toBe(STRONG_PW)
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1))
  })

  it('P1-2：昵称纯空格 → 同样不发 display_name 字段', async () => {
    render(<RegisterPage onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: STRONG_PW } })
    fireEvent.change(screen.getByLabelText('昵称（可选）'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /创建账号/ }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1))
    const payload = mockedPost.mock.calls[0][1] as Record<string, unknown>
    expect('display_name' in payload).toBe(false)
  })

  it('昵称首尾空白被裁剪后再提交', async () => {
    render(<RegisterPage onSuccess={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'user@example.com' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: STRONG_PW } })
    fireEvent.change(screen.getByLabelText('昵称（可选）'), { target: { value: '  小明  ' } })
    fireEvent.click(screen.getByRole('button', { name: /创建账号/ }))

    await waitFor(() => expect(mockedPost).toHaveBeenCalledTimes(1))
    expect(mockedPost).toHaveBeenCalledWith('/auth/register', {
      email: 'user@example.com',
      password: STRONG_PW,
      display_name: '小明',
    })
  })

  it('注册失败展示后端错误文案且不跳转', async () => {
    mockedPost.mockRejectedValueOnce(new Error('该邮箱已被注册'))
    const onSuccess = vi.fn()
    render(<RegisterPage onSuccess={onSuccess} />)
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: /创建账号/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('该邮箱已被注册')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('RE2-3：重复邮箱（ApiError "email already registered"）映射为中文提示，不直出英文', async () => {
    mockedPost.mockRejectedValueOnce(new ApiError(409, 'E_CONFLICT', 'email already registered'))
    const onSuccess = vi.fn()
    render(<RegisterPage onSuccess={onSuccess} />)
    fillValidForm()
    fireEvent.click(screen.getByRole('button', { name: /创建账号/ }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('该邮箱已注册，可直接登录或换个邮箱重试')
    expect(alert).not.toHaveTextContent('email already registered')
    expect(onSuccess).not.toHaveBeenCalled()
  })
})
