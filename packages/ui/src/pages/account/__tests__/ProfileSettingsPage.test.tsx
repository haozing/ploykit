import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { ProfileSettingsPage } from '../ProfileSettingsPage'
import type { PKUser } from '../../../provider/PloykitProvider'


const mocks = vi.hoisted(() => ({
  patch: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  user: null as PKUser | null,
  loading: false,
}))
vi.mock('../../../../../hooks/src/hooks/useApi', () => ({
  useApi: () => ({ patch: mocks.patch, post: mocks.post, delete: mocks.del, get: vi.fn(), put: vi.fn() }),
}))
vi.mock('../../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({ user: mocks.user, loading: mocks.loading, refresh: mocks.refresh, logout: mocks.logout, workspaces: [] }),
}))
vi.mock('../../../components/toast', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn() },
}))

function fakeUser(over: Partial<PKUser> = {}): PKUser {
  return {
    id: 'u1', email: 'user@example.com', display_name: '小明', avatar_url: '',
    status: 'active', is_platform_admin: false, email_verified: false, created_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

beforeEach(() => {
  mocks.patch.mockReset().mockResolvedValue(fakeUser())
  mocks.post.mockReset().mockResolvedValue(undefined)
  mocks.del.mockReset().mockResolvedValue(undefined)
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.logout.mockReset().mockResolvedValue(undefined)
  mocks.toastSuccess.mockReset()
  mocks.toastError.mockReset()
  mocks.loading = false
  mocks.user = fakeUser()
})

describe('ProfileSettingsPage', () => {
  it('loading 时渲染加载骨架', () => {
    mocks.loading = true
    render(<ProfileSettingsPage />)
    expect(screen.getByText('Loading account information…')).toBeInTheDocument()
  })

  it('渲染资料表单与邮箱行；未验证邮箱展示 Alert 提示 + 重发按钮', () => {
    render(<ProfileSettingsPage />)
    expect((screen.getByLabelText(/Display name/) as HTMLInputElement).value).toBe('小明')
    expect(screen.getByTestId('profile-email')).toHaveTextContent('user@example.com')
    expect(screen.getByText('Sign-in email not verified yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resend verification email' })).toBeInTheDocument()
  })

  it('已验证邮箱不渲染重发按钮', () => {
    mocks.user = fakeUser({ email_verified: true })
    render(<ProfileSettingsPage />)
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Resend verification email' })).toBeNull()
  })

  it('保存资料 → PATCH /auth/me 携带 display_name/avatar_url', async () => {
    render(<ProfileSettingsPage />)
    fireEvent.change(screen.getByLabelText(/Display name/), { target: { value: '大明' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.patch).toHaveBeenCalledTimes(1))
    expect(mocks.patch).toHaveBeenCalledWith('/auth/me', {
      display_name: '大明', avatar_url: '',
    })
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledTimes(1))
  })

  it('点击重发验证邮件 → POST /auth/send-verification', async () => {
    render(<ProfileSettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    expect(mocks.post).toHaveBeenCalledWith('/auth/send-verification')
  })

  it('删除账号：无邮箱输入层，Impact 勾选确认后 DELETE /auth/me', async () => {
    render(<ProfileSettingsPage />)
    // 确认强度由 ImpactConfirmation（勾选 + 确认弹窗）单层承担，不再有邮箱匹配门控
    expect(screen.queryByLabelText('输入登录邮箱以确认')).toBeNull()
    const deleteBtn = screen.getByRole('button', { name: 'Delete account' })
    expect(deleteBtn).toBeEnabled()
    fireEvent.click(deleteBtn)


    const confirm = await screen.findByRole('button', { name: 'Delete permanently' })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand and accept the impacts above' }))
    fireEvent.click(confirm)

    await waitFor(() => expect(mocks.del).toHaveBeenCalledWith('/auth/me'))
  })


  it('B5：昵称为必填字段（aria-required + 视觉星号）', () => {
    render(<ProfileSettingsPage />)
    const input = screen.getByLabelText(/Display name/)
    expect(input).toHaveAttribute('aria-required', 'true')
    expect(screen.getByText('*')).toHaveAttribute('aria-hidden', 'true')

    expect(screen.getByLabelText(/Avatar URL/)).not.toHaveAttribute('aria-required')
  })


  it('G7.3：昵称校验失败 → aria-invalid=true 且 aria-describedby 指向错误节点', async () => {
    render(<ProfileSettingsPage />)
    const input = screen.getByLabelText(/Display name/)
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Enter a display name')).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input.getAttribute('aria-describedby')).toContain('profile-name-error')
    expect(document.getElementById('profile-name-error')).toHaveAttribute('role', 'alert')
  })


  it('B2：头像链接 javascript: 与超长均被前端校验拦截（不发请求）', async () => {
    render(<ProfileSettingsPage />)
    const avatar = screen.getByLabelText(/Avatar URL/)
    fireEvent.change(avatar, { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Avatar URL must start with http(s)://')).toBeInTheDocument()
    expect(mocks.patch).not.toHaveBeenCalled()

    fireEvent.change(avatar, { target: { value: 'https://' + 'a'.repeat(2049) } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Avatar URL can be at most 2048 characters')).toBeInTheDocument()
    expect(mocks.patch).not.toHaveBeenCalled()
  })


  it('B2：头像字段呈现"部分网站限制外链"的如实说明', () => {
    render(<ProfileSettingsPage />)
    expect(screen.getByText(/block hotlinking/)).toBeInTheDocument()
    expect(screen.getByText(/default avatar/)).toBeInTheDocument()
  })


  it('B3：邮箱行说明"暂无法在此修改"，页头不含登录邮箱承诺', () => {
    render(<ProfileSettingsPage />)
    expect(screen.getByText(/cannot be changed here/)).toBeInTheDocument()
    expect(screen.getByText('Profile').textContent).toBe('Profile')
  })


  it('B8：保存失败（E_VALIDATION 英文 message）→ toast 中文文案', async () => {
    mocks.patch.mockRejectedValueOnce(
      new ApiError(400, 'E_VALIDATION', 'display_name must be 1-100 characters after trim'),
    )
    render(<ProfileSettingsPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledTimes(1))
    expect(mocks.toastError).toHaveBeenCalledWith('Invalid request parameters. Check your input and try again')
  })
})
