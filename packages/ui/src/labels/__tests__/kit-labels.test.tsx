import '@testing-library/jest-dom/vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError } from '@ploykit/client'
import { RouterTestHarness } from '../../router'
import { DataTable, type Column } from '../../components/DataTable'
import { SecretModal } from '../../components/SecretModal'
import { UserMenu } from '../../components/UserMenu'
import { SidebarUserMenu } from '../../components/SidebarUserMenu'
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher'
import { SidebarProvider } from '../../components/ui/sidebar'
import { Toaster } from '../../components/toast'
import { KitLabelsProvider, DEFAULT_KIT_LABELS, useKitLabels } from '../kit-labels'

// ---- hooks mock（与 UserMenu.test / WorkspaceSwitcher.test 同款路径 mock：
//      经 @ploykit/hooks index re-export 生效；__tests__ 与 components/__tests__
//      同为 src 下两级，相对深度一致）----
const logout = vi.fn(async () => {})
const switchTo = vi.fn()
const create = vi.fn(async (name: string) => ({ id: 'ws-new', name, slug: 'ws-new' }))
let switcherError: unknown = null
const mocks = vi.hoisted(() => ({
  isPlatformAdmin: false,
  wsCurrent: null as
    | { id: string; name: string; slug: string; role?: string; role_perms?: string[] }
    | null,
}))
vi.mock('../../../../hooks/src/hooks/useAuth', () => ({
  useAuth: () => ({
    user: {
      email: 'alice@example.com',
      display_name: 'Alice',
      avatar_url: undefined,
      is_platform_admin: mocks.isPlatformAdmin,
    },
    workspaces: [],
    loading: false,
    refresh: vi.fn(),
    logout,
  }),
}))
vi.mock('../../../../hooks/src/hooks/useWorkspace', () => ({
  useWorkspace: () => {
    if (mocks.wsCurrent === null) {
      throw new Error('must be used within PloykitProvider')
    }
    return { current: mocks.wsCurrent, switchTo: vi.fn(), clear: vi.fn() }
  },
  useWorkspaceSwitch: () => ({
    current: { id: 'ws-1', name: 'Acme', plan_code: 'free', role: 'owner' },
    list: [{ id: 'ws-1', name: 'Acme', plan_code: 'free', role: 'owner' }],
    switchTo,
    create,
    creating: false,
    error: switcherError,
  }),
}))

// TanStack Router 首挂异步：render 后一次 act flush。
async function renderUi(ui: React.ReactNode) {
  const result = render(<RouterTestHarness initialEntries={['/app']}>{ui}</RouterTestHarness>)
  await act(async () => {})
  return result
}

interface Row { id: string }
const columns: Column<Row>[] = [{ key: 'id', header: 'ID' }]

describe('KitLabelsProvider', () => {
  beforeEach(() => {
    logout.mockClear()
    switchTo.mockClear()
    create.mockClear()
    switcherError = null
    mocks.isPlatformAdmin = false
    mocks.wsCurrent = null
  })

  it('默认值与历史硬编码逐字一致（DEFAULT_KIT_LABELS 抽查）', () => {
    expect(DEFAULT_KIT_LABELS.workspaceSwitcherAria).toBe('切换工作区')
    expect(DEFAULT_KIT_LABELS.create).toBe('创建')
    expect(DEFAULT_KIT_LABELS.quotaBillingHref).toBe('/settings/workspace/billing')
    expect(DEFAULT_KIT_LABELS.workspaceCreatedToast('Acme')).toBe('工作区「Acme」已创建')
    expect(DEFAULT_KIT_LABELS.paginationTotal(42, 2, 3)).toBe('共 42 条 · 第 2/3 页')
    expect(DEFAULT_KIT_LABELS.emptyState).toBe('本页没有数据，可返回上一页')
    expect(DEFAULT_KIT_LABELS.confirmSaved).toBe('我已保存')
    expect(DEFAULT_KIT_LABELS.confirmPending).toBe('请先确认已保存')
    expect(DEFAULT_KIT_LABELS.logout).toBe('退出登录')
    expect(DEFAULT_KIT_LABELS.pageLoading).toBe('加载中…')
    expect(DEFAULT_KIT_LABELS.pageEmpty).toBe('暂无数据')
    expect(DEFAULT_KIT_LABELS.pageRetry).toBe('重试')
  })

  it('useKitLabels 未挂 Provider 时返回内置默认（Provider-safe）', () => {
    let seen: ReturnType<typeof useKitLabels> | null = null
    function Probe() {
      seen = useKitLabels()
      return null
    }
    render(<Probe />)
    expect(seen).toEqual(DEFAULT_KIT_LABELS)
  })

  it('WorkspaceSwitcher：Provider 文案渲染到触发器 / 菜单项 / 创建面板', async () => {
    await renderUi(
      <KitLabelsProvider
        labels={{
          workspaceSwitcherAria: 'Switch workspace',
          workspacePickerPlaceholder: 'Pick a workspace',
          createWorkspace: 'New workspace',
          workspaceNamePlaceholder: 'Workspace name',
          newWorkspaceNameAria: 'New workspace name',
          creating: 'Creating…',
          create: 'Create',
          cancel: 'Cancel',
        }}
      >
        <SidebarProvider>
          <WorkspaceSwitcher />
        </SidebarProvider>
      </KitLabelsProvider>,
    )
    const trigger = screen.getByRole('button', { name: 'Switch workspace' })
    expect(trigger).toHaveTextContent('Acme')
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('menuitem', { name: /New workspace/ }))
    const input = await screen.findByLabelText('New workspace name')
    expect(input).toHaveAttribute('placeholder', 'Workspace name')
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('workspaceCreatedToast 函数键收到工作区名（toast 上屏）', async () => {
    await renderUi(
      <KitLabelsProvider labels={{ workspaceCreatedToast: (name) => `Workspace ${name} is ready` }}>
        <SidebarProvider>
          <WorkspaceSwitcher />
        </SidebarProvider>
        <Toaster />
      </KitLabelsProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    fireEvent.change(await screen.findByLabelText('新工作区名称'), { target: { value: 'Gamma' } })
    fireEvent.click(screen.getByRole('button', { name: '创建' }))
    expect(await screen.findByText('Workspace Gamma is ready')).toBeInTheDocument()
  })

  it('quotaBillingHref：Provider 覆盖配额指引链接；billingHref prop 再覆盖 Provider', async () => {
    // 402 → quotaExceeded 分支渲染指引；链接目标按 prop > provider > 默认解析。
    switcherError = new ApiError(402, 'E_QUOTA_EXCEEDED', 'quota exceeded for workspaces')
    await renderUi(
      <KitLabelsProvider labels={{ quotaBillingHref: '/product/pricing' }}>
        <SidebarProvider>
          <WorkspaceSwitcher />
        </SidebarProvider>
      </KitLabelsProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    // Provider 层生效：默认 /settings/workspace/billing 被替换
    expect(await screen.findByRole('link', { name: '设置→计费' })).toHaveAttribute(
      'href', '/product/pricing',
    )
  })

  it('billingHref prop 优先于 Provider 的 quotaBillingHref', async () => {
    switcherError = new ApiError(402, 'E_QUOTA_EXCEEDED', 'quota exceeded for workspaces')
    await renderUi(
      <KitLabelsProvider labels={{ quotaBillingHref: '/product/pricing' }}>
        <SidebarProvider>
          <WorkspaceSwitcher billingHref="/acme/billing" />
        </SidebarProvider>
      </KitLabelsProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '切换工作区' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /新建工作区/ }))
    expect(await screen.findByRole('link', { name: '设置→计费' })).toHaveAttribute(
      'href', '/acme/billing',
    )
  })

  it('DataTable：Provider 覆盖分页行 / 翻页按钮 / 空页文案', () => {
    render(
      <KitLabelsProvider
        labels={{
          paginationTotal: (total, page, pages) => `Rows ${total}, page ${page} of ${pages}`,
          previousPage: 'Prev',
          nextPage: 'Next',
          emptyState: 'Nothing on this page',
        }}
      >
        <DataTable
          columns={columns}
          rows={[]}
          rowKey={(r) => r.id}
          pagination={{ page: 5, pageSize: 20, total: 42, onPageChange: () => {} }}
        />
      </KitLabelsProvider>,
    )
    expect(screen.getByText('Rows 42, page 5 of 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prev' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByText('Nothing on this page')).toBeInTheDocument()
    expect(screen.queryByText(/共 .* 条/)).not.toBeInTheDocument()
  })

  it('SecretModal：Provider 覆盖确认按钮双态文案', () => {
    render(
      <KitLabelsProvider labels={{ confirmSaved: 'Saved', confirmPending: 'Confirm saved first' }}>
        <SecretModal open onOpenChange={() => {}} secretName="Token" secretValue="tk_1" />
      </KitLabelsProvider>,
    )
    expect(screen.getByRole('button', { name: 'Confirm saved first' })).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Saved' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: '我已保存' })).not.toBeInTheDocument()
  })

  it('UserMenu：Provider 覆盖菜单项 / aria（logout 代表断言）', async () => {
    await renderUi(
      <KitLabelsProvider
        labels={{ userMenuAria: 'User menu', accountSettings: 'Account', logout: 'Sign out' }}
      >
        <UserMenu />
      </KitLabelsProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'User menu' }))
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Account' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: '退出登录' })).not.toBeInTheDocument()
  })

  it('SidebarUserMenu：Provider 覆盖 logout / aria', async () => {
    await renderUi(
      <KitLabelsProvider labels={{ userMenuAria: 'Sidebar user', logout: 'Sign out' }}>
        <SidebarProvider>
          <SidebarUserMenu />
        </SidebarProvider>
      </KitLabelsProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Sidebar user' }))
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeVisible()
  })

  it('无 Provider：四个组件默认中文渲染不变（零行为变化抽查）', async () => {
    const table = render(
      <DataTable
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        pagination={{ page: 2, pageSize: 20, total: 42, onPageChange: () => {} }}
      />,
    )
    expect(screen.getByText('共 42 条 · 第 2/3 页')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '上一页' })).toBeInTheDocument()
    table.unmount()

    render(<SecretModal open onOpenChange={() => {}} secretName="Token" secretValue="tk_1" />)
    expect(screen.getByRole('button', { name: '请先确认已保存' })).toBeDisabled()

    await renderUi(<UserMenu />)
    expect(screen.getByRole('button', { name: '用户菜单' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    expect(await screen.findByRole('menuitem', { name: '退出登录' })).toBeVisible()
  })

  it('prop > provider：UserMenu 传 labels prop 时覆盖 Provider 值（存量消费方不受影响）', async () => {
    await renderUi(
      <KitLabelsProvider
        labels={{ userMenuAria: 'Provider menu', accountSettings: 'Provider settings', logout: 'Provider logout' }}
      >
        <UserMenu
          labels={{ userMenuAria: 'Prop menu', accountSettings: 'Prop settings', logout: 'Prop logout' }}
        />
      </KitLabelsProvider>,
    )
    expect(screen.getByRole('button', { name: 'Prop menu' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Provider menu' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Prop menu' }))
    expect(await screen.findByRole('menuitem', { name: 'Prop settings' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Prop logout' })).toBeVisible()
    expect(screen.queryByRole('menuitem', { name: 'Provider logout' })).not.toBeInTheDocument()
  })

  it('嵌套 Provider：内层覆盖外层，未覆盖键继承外层（而非重置回默认）', () => {
    render(
      <KitLabelsProvider labels={{ nextPage: 'Outer next', previousPage: 'Outer prev' }}>
        <KitLabelsProvider labels={{ nextPage: 'Inner next' }}>
          <DataTable
            columns={columns}
            rows={[]}
            rowKey={(r) => r.id}
            pagination={{ page: 2, pageSize: 20, total: 42, onPageChange: () => {} }}
          />
        </KitLabelsProvider>
      </KitLabelsProvider>,
    )
    expect(screen.getByRole('button', { name: 'Inner next' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Outer prev' })).toBeInTheDocument()
  })

  it('部分覆盖：未涉及的键落回默认值', async () => {
    await renderUi(
      <KitLabelsProvider labels={{ logout: 'Sign out' }}>
        <UserMenu />
      </KitLabelsProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: '用户菜单' }))
    expect(await screen.findByRole('menuitem', { name: 'Sign out' })).toBeVisible()
    expect(screen.getByRole('menuitem', { name: '账户设置' })).toBeVisible()
  })
})
