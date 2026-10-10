import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'


const mocks = vi.hoisted(() => ({ role: undefined as string | undefined }))
vi.mock('../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    current: mocks.role ? { id: 'ws-1', name: 'Acme', slug: 'acme', role: mocks.role } : null,
    switchTo: vi.fn(),
    clear: vi.fn(),
  }),
}))

const nav: SettingsNavGroup[] = [
  {
    group: '账户',
    items: [
      { path: '/settings/profile', label: '个人资料' },
      { path: '/settings/notifications', label: '通知偏好' },
    ],
  },
  {
    group: '工作区',
    items: [
      { path: '/settings/workspace/general', label: '概况' },
      { path: '/settings/workspace/members', label: '成员' },
    ],
  },
]

function Page({ title }: { title: string }) {
  return (
    <SettingsShell nav={nav} title="设置" description="desc">
      <div>{title}</div>
    </SettingsShell>
  )
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/profile" element={<Page title="profile-content" />} />
        <Route path="/settings/notifications" element={<Page title="notifications-content" />} />
        <Route path="/settings/workspace/members" element={<Page title="members-content" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('SettingsShell', () => {
  beforeEach(() => { mocks.role = undefined })

  it('渲染标题/描述/全部分组与条目（URL 驱动激活态）', () => {
    renderAt('/settings/profile')
    
    expect(screen.getByText('设置')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '设置' })).not.toBeInTheDocument()
    expect(screen.getByText('desc')).toBeInTheDocument()
    expect(screen.getByText('账户')).toBeInTheDocument()
    expect(screen.getByText('工作区')).toBeInTheDocument()

    const active = screen.getByRole('link', { name: '个人资料' })
    expect(active).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '通知偏好' })).not.toHaveAttribute('aria-current')
    expect(screen.getByText('profile-content')).toBeInTheDocument()
  })

  it('点击导航项切换激活与内容（无内部 tab state）', () => {
    renderAt('/settings/profile')
    fireEvent.click(screen.getByRole('link', { name: '成员' }))
    expect(screen.getByText('members-content')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '成员' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '个人资料' })).not.toHaveAttribute('aria-current')
  })
})

describe('SettingsShell 角色门控（IA v2 hidden 语义）', () => {
  const gatedNav: SettingsNavGroup[] = [
    {
      group: '工作区',
      items: [
        { path: '/settings/workspace/general', label: '概况' },
        { path: '/settings/workspace/members', label: '成员' },
        { path: '/settings/workspace/audit', label: '审计', perm: 'admin' },
        { path: '/settings/workspace/billing', label: '计费', perm: 'owner' },
      ],
    },
  ]

  function renderGated() {
    return render(
      <MemoryRouter initialEntries={['/settings/workspace/general']}>
        <SettingsShell nav={gatedNav}>
          <div>page-body</div>
        </SettingsShell>
      </MemoryRouter>,
    )
  }

  beforeEach(() => { mocks.role = 'member' })

  it('member：无 perm 项可见，perm=admin（审计）隐藏', () => {
    renderGated()
    expect(screen.getByRole('link', { name: '概况' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '成员' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '审计' })).not.toBeInTheDocument()
  })

  it('admin：可见 admin 项（审计），仍隐藏 owner 项（计费）', () => {
    mocks.role = 'admin'
    renderGated()
    expect(screen.getByRole('link', { name: '审计' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '计费' })).not.toBeInTheDocument()
  })

  it('owner：全部可见', () => {
    mocks.role = 'owner'
    renderGated()
    expect(screen.getByRole('link', { name: '审计' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '计费' })).toBeInTheDocument()
  })

  it('角色未加载（无工作区）：管理项按最小权限隐藏', () => {
    mocks.role = undefined
    renderGated()
    expect(screen.getByRole('link', { name: '概况' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '审计' })).not.toBeInTheDocument()
  })

  it('整组过滤后为空则不渲染分组标题', () => {
    render(
      <MemoryRouter initialEntries={['/account/profile']}>
        <SettingsShell
          nav={[{ group: '仅管理', items: [{ path: '/settings/workspace/audit', label: '审计', perm: 'admin' }] }]}
        >
          <div>page-body</div>
        </SettingsShell>
      </MemoryRouter>,
    )
    expect(screen.queryByText('仅管理')).not.toBeInTheDocument()
  })
})
