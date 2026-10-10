import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { SecuritySettingsPage } from '../SecuritySettingsPage'

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  confirm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  sessions: [] as Array<Record<string, unknown>>,
  loading: false,
  revoke: vi.fn(),
  revokeAll: vi.fn(),
}))
vi.mock('../../../../../hooks/src/hooks/useApi', () => ({
  useApi: () => ({ post: mocks.post, get: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }),
}))
vi.mock('../../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({ user: null, loading: false, refresh: mocks.refresh, logout: mocks.logout, workspaces: [] }),
}))
vi.mock('../../../components/toast', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError, info: vi.fn() },
}))
vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => mocks.confirm,
}))
vi.mock('../../../../../hooks/src/hooks/useSessions', () => ({
  useSessions: () => ({ sessions: mocks.sessions, loading: mocks.loading, error: null, refetch: vi.fn() }),
  useRevokeSession: () => ({ revoke: mocks.revoke, loading: false, error: null }),
  useRevokeAllSessions: () => ({ revokeAll: mocks.revokeAll, loading: false, error: null }),
}))

const NOW = '2026-10-05T10:00:00Z'
function session(over: Record<string, unknown> = {}) {
  return {
    id: 's-1', ip_hash: 'a1b2c3d4e5f6', user_agent: 'Mozilla/5.0 Chrome/130',
    last_seen_at: NOW, expires_at: '2026-11-05T10:00:00Z', created_at: NOW,
    ...over,
  }
}

beforeEach(() => {
  mocks.post.mockReset().mockResolvedValue({ expires_at: NOW })
  mocks.refresh.mockReset().mockResolvedValue(undefined)
  mocks.logout.mockReset().mockResolvedValue(undefined)
  mocks.confirm.mockReset().mockResolvedValue(true)
  mocks.revoke.mockReset().mockResolvedValue(undefined)
  mocks.revokeAll.mockReset().mockResolvedValue(undefined)
  mocks.toastError.mockReset()
  mocks.toastSuccess.mockReset()
  mocks.loading = false
  mocks.sessions = []
})

describe('SecuritySettingsPage', () => {
  it('会话加载中渲染 Skeleton 行', () => {
    mocks.loading = true
    render(<SecuritySettingsPage />)
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('渲染会话行：current=true 显示当前设备徽标，current 缺失显示 —', () => {
    mocks.sessions = [
      session({ id: 's-cur', user_agent: 'MacBook Chrome/130', current: true }),
      session({ id: 's-old', user_agent: 'iPhone Safari' }), // 后端 current 并行落地前的形态
    ]
    render(<SecuritySettingsPage />)
    expect(screen.getByText('当前设备')).toBeInTheDocument()
    expect(screen.getByText('MacBook Chrome/130')).toBeInTheDocument()
    expect(screen.getByText('iPhone Safari')).toBeInTheDocument()
  })

  it('修改密码 → POST /auth/change-password 携带 old/new', async () => {
    render(<SecuritySettingsPage />)
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Abcdef1234!' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    expect(mocks.post).toHaveBeenCalledWith('/auth/change-password', {
      old_password: 'old-password', new_password: 'Abcdef1234!',
    })
  })

  it('弱新密码被 zod 拦截，不发请求', async () => {
    render(<SecuritySettingsPage />)
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'old-password' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'abcdefgh' } }) 
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    expect(await screen.findByText('密码至少 10 位')).toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  
  
  it('B4：新密码与当前密码相同 → 内联报错且不发请求', async () => {
    render(<SecuritySettingsPage />)
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'Abcdef1234!' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Abcdef1234!' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    expect(await screen.findByText('新密码不能与当前密码相同')).toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('B4 边界：当前密码为空时不触发 new==old 跨字段报错（仍报必填）', async () => {
    render(<SecuritySettingsPage />)
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Abcdef1234!' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    expect(await screen.findByText('请输入当前密码')).toBeInTheDocument()
    expect(screen.queryByText('新密码不能与当前密码相同')).not.toBeInTheDocument()
    expect(mocks.post).not.toHaveBeenCalled()
  })

  it('单行吊销：确认后调用 revoke(sessionId)', async () => {
    mocks.confirm.mockResolvedValueOnce(true)
    mocks.sessions = [session({ id: 's-9', user_agent: 'iPad Safari', current: false })]
    render(<SecuritySettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '吊销' }))
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('s-9'))
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: '吊销此会话？', danger: true }),
    )
  })

  it('单行吊销：取消确认则不调用 revoke', async () => {
    mocks.confirm.mockResolvedValueOnce(false)
    mocks.sessions = [session({ id: 's-9' })]
    render(<SecuritySettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '吊销' }))
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled())
    expect(mocks.revoke).not.toHaveBeenCalled()
  })

  it('P1-3：吊销当前会话（current=true）→ 调 logout() 并跳 /login，不困在失效会话页', async () => {
    mocks.sessions = [session({ id: 's-cur', current: true })]
    render(<SecuritySettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '吊销' }))
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('s-cur'))
    await waitFor(() => expect(mocks.logout).toHaveBeenCalledTimes(1))
  })

  it('P1-3：吊销非当前会话 → 不调 logout，留在本页', async () => {
    mocks.sessions = [session({ id: 's-other', current: false })]
    render(<SecuritySettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '吊销' }))
    await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith('s-other'))
    expect(mocks.logout).not.toHaveBeenCalled()
  })

  it('P2-24（最危险操作）：全部吊销 → ImpactConfirmation 勾选后 revokeAll', async () => {
    mocks.sessions = [session({ id: 's-1' }), session({ id: 's-2', current: true })]
    render(<SecuritySettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '全部吊销' }))
    
    expect(await screen.findByText('吊销全部会话？')).toBeInTheDocument()
    expect(screen.getByText(/个人访问令牌（PAT）不受影响/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText(/我理解并接受以上影响/))
    fireEvent.click(screen.getByRole('button', { name: '全部吊销', hidden: false }))
    await waitFor(() => expect(mocks.revokeAll).toHaveBeenCalledTimes(1))
  })

  it('P2-24：全部吊销失败 → 错误 toast（服务端语义透出）', async () => {
    mocks.revokeAll.mockRejectedValueOnce(new Error('网络连接失败'))
    render(<SecuritySettingsPage />)

    fireEvent.click(screen.getByRole('button', { name: '全部吊销' }))
    fireEvent.click(await screen.findByLabelText(/我理解并接受以上影响/))
    fireEvent.click(screen.getByRole('button', { name: '全部吊销', hidden: false }))

    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('网络连接失败'))
  })

  it('P2-24：修改密码失败 → 错误 toast（服务端语义透出）', async () => {
    mocks.post.mockRejectedValueOnce(new Error('当前密码不正确'))
    render(<SecuritySettingsPage />)
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'wrong-old' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Abcdef1234!' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('当前密码不正确'))
  })

  
  
  
  it('B3：旧密码错 401 信封（英文 message）→ toast 中文域文案，不直出英文行话', async () => {
    mocks.post.mockRejectedValueOnce(
      new ApiError(401, 'E_UNAUTHENTICATED', 'current password incorrect'),
    )
    render(<SecuritySettingsPage />)
    fireEvent.change(screen.getByLabelText('当前密码'), { target: { value: 'wrong-old' } })
    fireEvent.change(screen.getByLabelText('新密码'), { target: { value: 'Abcdef1234!' } })
    fireEvent.click(screen.getByRole('button', { name: '修改密码' }))

    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('当前密码不正确，请确认后重新输入'))
  })
})
