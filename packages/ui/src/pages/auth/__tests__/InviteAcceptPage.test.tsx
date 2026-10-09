import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InviteAcceptPage } from '../InviteAcceptPage'

const invMocks = vi.hoisted(() => ({
  accept: { mutateAsync: vi.fn(), isPending: false },
  decline: { mutateAsync: vi.fn(), isPending: false },
}))
vi.mock('../../../hooks/useMembers', () => ({
  useMyInvitations: () => ({
    invitations: [
      {
        id: 'inv-1', workspace_id: 'ws-9', workspace_name: 'Beta Team',
        workspace_slug: 'beta', email: 'me@example.com', role: 'admin',
        status: 'pending', expires_at: '2026-12-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
      },
      {
        id: 'inv-2', workspace_id: 'ws-8', workspace_name: 'Old Team',
        workspace_slug: 'old', email: 'me@example.com', role: 'member',
        status: 'accepted', expires_at: '2026-12-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z',
      },
    ],
    loading: false,
    error: null,
    refetch: vi.fn(),
    accept: invMocks.accept,
    decline: invMocks.decline,
  }),
}))

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(), error: vi.fn(), info: vi.fn(),
}))
vi.mock('../../../components/toast', () => ({ toast: toastMocks }))

function renderPage(props: Parameters<typeof InviteAcceptPage>[0] = {}) {
  return render(
    <MemoryRouter initialEntries={['/invitations']}>
      <Routes>
        <Route path="/invitations" element={<InviteAcceptPage {...props} />} />
        <Route path="/app" element={<div>app-page</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  invMocks.accept.mutateAsync.mockResolvedValue({ id: 'ws-9', name: 'Beta Team' })
  invMocks.decline.mutateAsync.mockResolvedValue({})
})

describe('InviteAcceptPage', () => {
  it('只列 pending 邀请（工作区名 / 角色徽标 / 过期时间）', () => {
    renderPage()
    expect(screen.getByText('Beta Team')).toBeInTheDocument()
    expect(screen.getByText('管理员')).toBeInTheDocument()
    expect(screen.queryByText('Old Team')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /接受/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /拒绝/ })).toBeInTheDocument()
  })

  it('接受 → POST accept（hook 内部失效 workspaceList）+ onAccepted 回调', async () => {
    const onAccepted = vi.fn()
    renderPage({ onAccepted })
    fireEvent.click(screen.getByRole('button', { name: /接受/ }))
    await waitFor(() => expect(invMocks.accept.mutateAsync).toHaveBeenCalledWith('inv-1'))
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('ws-9'))
    expect(screen.queryByText('app-page')).not.toBeInTheDocument() 
  })

  it('无 onAccepted 时默认跳 /app', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /接受/ }))
    await waitFor(() => expect(screen.getByText('app-page')).toBeInTheDocument())
  })

  it('拒绝 → decline.mutateAsync(id)，不跳转', async () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: /拒绝/ }))
    await waitFor(() => expect(invMocks.decline.mutateAsync).toHaveBeenCalledWith('inv-1'))
    expect(toastMocks.success).toHaveBeenCalledWith('已拒绝「Beta Team」的邀请')
  })
})
