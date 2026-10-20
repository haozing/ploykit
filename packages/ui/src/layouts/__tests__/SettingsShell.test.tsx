import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RouterTestHarness, useLocation } from '../../router'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SettingsShell, type SettingsNavGroup } from '../SettingsShell'


const mocks = vi.hoisted(() => ({ role: undefined as string | undefined, rolePerms: undefined as string[] | undefined }))
vi.mock('../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => ({
    current: mocks.role ? { id: 'ws-1', name: 'Acme', slug: 'acme', role: mocks.role, role_perms: mocks.rolePerms } : null,
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

// 旧 <Route path> 分发的等价探针：RouterTestHarness 是 catch-all，不做路由分发；
// 用 useLocation 按路径渲染对应设置页（点击导航后内容切换的断言依据）。
function RouteContentProbe({ path }: { path: string }) {
  const { pathname } = useLocation()
  if (pathname === '/settings/profile') return <Page title="profile-content" />
  if (pathname === '/settings/notifications') return <Page title="notifications-content" />
  if (pathname === '/settings/workspace/members') return <Page title="members-content" />
  return <Page title={`untitled:${path}`} />
}

// RouterTestHarness 底下的 tanstack RouterProvider 首帧为 pending（初始 load 异步
// 完成）——渲染后等壳标题上屏再返回，断言/交互可同步写。
async function renderAt(path: string) {
  const result = render(
    <RouterTestHarness initialEntries={[path]}>
      <RouteContentProbe path={path} />
    </RouterTestHarness>,
  )
  await waitFor(() => expect(screen.queryAllByText('设置').length).toBeGreaterThan(0))
  return result
}

describe('SettingsShell', () => {
  beforeEach(() => { mocks.role = undefined })

  it('渲染标题/描述/全部分组与条目（URL 驱动激活态）', async () => {
    await renderAt('/settings/profile')
    
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

  it('点击导航项切换激活与内容（无内部 tab state）', async () => {
    await renderAt('/settings/profile')
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

  // 首帧 flush 同 renderAt：等 page-body 上屏（gatedNav 壳无标题差异，盯内容槽）。
  async function renderGated() {
    const result = render(
      <RouterTestHarness initialEntries={['/settings/workspace/general']}>
        <SettingsShell nav={gatedNav}>
          <div>page-body</div>
        </SettingsShell>
      </RouterTestHarness>,
    )
    await waitFor(() => expect(screen.queryAllByText('page-body').length).toBeGreaterThan(0))
    return result
  }

  beforeEach(() => { mocks.role = 'member' })

  it('member：无 perm 项可见，perm=admin（审计）隐藏', async () => {
    await renderGated()
    expect(screen.getByRole('link', { name: '概况' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '成员' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '审计' })).not.toBeInTheDocument()
  })

  it('admin：可见 admin 项（审计），仍隐藏 owner 项（计费）', async () => {
    mocks.role = 'admin'
    await renderGated()
    expect(screen.getByRole('link', { name: '审计' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '计费' })).not.toBeInTheDocument()
  })

  it('owner：全部可见', async () => {
    mocks.role = 'owner'
    await renderGated()
    expect(screen.getByRole('link', { name: '审计' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '计费' })).toBeInTheDocument()
  })

  it('角色未加载（无工作区）：管理项按最小权限隐藏', async () => {
    mocks.role = undefined
    await renderGated()
    expect(screen.getByRole('link', { name: '概况' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '审计' })).not.toBeInTheDocument()
  })

  it('整组过滤后为空则不渲染分组标题', async () => {
    render(
      <RouterTestHarness initialEntries={['/account/profile']}>
        <SettingsShell
          nav={[{ group: '仅管理', items: [{ path: '/settings/workspace/audit', label: '审计', perm: 'admin' }] }]}
        >
          <div>page-body</div>
        </SettingsShell>
      </RouterTestHarness>,
    )
    await waitFor(() => expect(screen.queryAllByText('page-body').length).toBeGreaterThan(0))
    expect(screen.queryByText('仅管理')).not.toBeInTheDocument()
  })
})

// SettingsShell 原先只按 perm（角色）过滤，permKey（细粒度权限集）被静默忽略——
// 与 AppShell 侧栏/用户面板的门控语义不一致。本组测试钉住三者共用同一判据。
describe('SettingsShell permKey 门控（与 AppShell/UserMenu 同判据）', () => {
  const gatedNav: SettingsNavGroup[] = [
    {
      group: '工作区',
      items: [
        { path: '/settings/workspace/general', label: '概况' },
        { path: '/settings/workspace/billing', label: '计费', permKey: 'billing:read' },
        { path: '/settings/workspace/roles', label: '角色权限', perm: 'owner' },
      ],
    },
  ]

  async function renderGated() {
    render(
      <RouterTestHarness initialEntries={['/settings/workspace/general']}>
        <SettingsShell nav={gatedNav} title="设置">
          <div>content</div>
        </SettingsShell>
      </RouterTestHarness>,
    )
    await waitFor(() => expect(screen.queryAllByText('设置').length).toBeGreaterThan(0))
  }

  it('role_perms 已知且不含 billing:read → 计费项隐藏，其余显示', async () => {
    mocks.role = 'member'
    mocks.rolePerms = ['usage:read']
    await renderGated()
    expect(screen.queryByText('计费')).toBeNull()
    expect(screen.queryAllByText('概况').length).toBeGreaterThan(0)
  })

  it('role_perms 已知且含 billing:read → 计费项显示', async () => {
    mocks.role = 'member'
    mocks.rolePerms = ['billing:read']
    await renderGated()
    expect(screen.queryByText('计费')).not.toBeNull()
  })

  it('role_perms 缺失（旧载荷）→ permKey 项默认显示（向后兼容）', async () => {
    mocks.role = 'member'
    mocks.rolePerms = undefined
    await renderGated()
    expect(screen.queryByText('计费')).not.toBeNull()
  })

  it('perm: owner 对 member 隐藏（角色级门控仍然生效）', async () => {
    mocks.role = 'member'
    mocks.rolePerms = ['billing:read']
    await renderGated()
    expect(screen.queryByText('角色权限')).toBeNull()
  })
})
