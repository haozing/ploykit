
import { useLocation, useNavigate } from '../router'
import { useEffect, type ReactNode } from 'react'
import { FolderKanban } from 'lucide-react'
import { roleSatisfies, useAuth, useWorkspace, type Perm } from '@ploykit/hooks'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarGroupLabel, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from '../components/ui/sidebar'
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator,
} from '../components/ui/breadcrumb'
import { Separator } from '../components/ui/separator'
import { UserMenu, type UserMenuExtraItem } from '../components/UserMenu'
import { SidebarUserMenu } from '../components/SidebarUserMenu'
import { ImpersonationBanner } from '../components/ImpersonationBanner'

// stock SidebarProvider 只写不读 sidebar_state cookie（写入供 SSR 框架回传 defaultOpen）。
// CSR 产品在组合层回读，保持跨会话折叠状态（P2-17，自 stock 镜像化后上提至此）。
function readSidebarCookieOpen(): boolean {
  if (typeof document === 'undefined') return true // SSR 安全
  return !document.cookie.split('; ').includes('sidebar_state=false')
}

// 防御式读取工作区角色与生效权限集：AppShell 不强制宿主包 PloykitProvider（存量测试/
// 渐进接入场景直接渲染）；无 Provider 时两者视为 undefined——perm 专属项隐藏、普通项
// 可见；rolePerms 未知（旧载荷无 role_perms / 无 Provider）时 permKey 项默认显示。
function useWorkspaceRoleSafe(): { role: string | undefined; rolePerms: string[] | undefined } {
  try {
    const current = useWorkspace().current
    return { role: current?.role, rolePerms: current?.role_perms ?? undefined }
  } catch {
    return { role: undefined, rolePerms: undefined }
  }
}

// 平台管理员视为全部角色级入口可见（服务端是真正的边界：角色权限接口已对
// 平台管理员放行，其余工作区权限键仍按其生效权限集鉴权）。无 Provider 回退同前。
function useIsPlatformAdminSafe(): boolean {
  try {
    return useAuth().user?.is_platform_admin === true
  } catch {
    return false
  }
}

export interface NavItem {
  path: string
  label: string

  icon?: ReactNode

  /** 最低角色要求（owner/admin），经 useWorkspace().current.role 过滤；缺省全员可见。 */
  perm?: Perm

  /** 细粒度权限键（如 'billing:read'），经 useWorkspace().current.role_perms 集合过滤：
   *  role_perms 已知且不含该键 → 隐藏；未知（旧载荷/无 Provider）→ 默认显示（向后兼容）。
   *  owner 不特判——后端给 owner 的 role_perms 即全量目录，集合包含自然可见。
   *  与 perm 同时声明时两者都需满足。 */
  permKey?: string
}

/** 带分组标签的侧栏导航组（渲染在 nav 平铺项之后，如「工作区」组）。 */
export interface AppShellNavGroup {
  group: string
  items: NavItem[]
}

export function AppShell({ children, nav, brand, logo, logoDark, sidebarHeader, navGroups, sidebarFooter, headerRight, userMenu = 'header', userMenuItems, breadcrumbTail = null, settingsContent }: {
  children: ReactNode
  nav?: NavItem[]
  brand?: string

  /** 品牌图形（sidebar 顶栏，方形 mark 最佳，h-7 宽自适应）；与 brand 文字横排。 */
  logo?: string
  /** 暗色变体，经 prefers-color-scheme 切换——仅当应用主题跟随系统时才传；
   *  固定亮色主题的应用不要传（否则深色系统的用户会在亮底上拿到暗色变体）。 */
  logoDark?: string

  /** 侧栏头部插槽：提供后整体替换默认 logo+brand 块（典型：WorkspaceSwitcher，
   *  sidebar-07 的「工作区切换器作侧栏头」形态）。 */
  sidebarHeader?: ReactNode

  /** 分组导航（带 SidebarGroupLabel，在 nav 平铺项之后渲染；perm/permKey 过滤按当前
   *  工作区角色与 role_perms，与平铺 nav 共用同一可见性规则）。 */
  navGroups?: AppShellNavGroup[]

  sidebarFooter?: ReactNode

  headerRight?: ReactNode

  /** 用户菜单位置：'header'（默认，顶栏头像）| 'sidebar-footer'（侧栏底部用户卡 +
   *  右侧弹出面板，头部不再渲染 UserMenu——sidebar-07 NavUser 形态）。 */
  userMenu?: 'header' | 'sidebar-footer'

  /** userMenu 面板的自定义条目（两种位置都生效；'header' 时追加在「账户设置」之后）。 */
  userMenuItems?: UserMenuExtraItem[]

  breadcrumbTail?: string | null

  settingsContent?: ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()
  const { role, rolePerms } = useWorkspaceRoleSafe()
  const isPlatformAdmin = useIsPlatformAdminSafe()

  // 输入焦点时不劫持 Ctrl/Cmd+B（P3-1，自 stock 镜像化后上提至此）：
  // 捕获阶段拦截可编辑目标上的快捷键，阻断 stock SidebarProvider 的全局监听。
  useEffect(() => {
    const guard = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        e.stopImmediatePropagation()
      }
    }
    window.addEventListener('keydown', guard, true)
    return () => window.removeEventListener('keydown', guard, true)
  }, [])

  const items = nav ?? [
    { path: '/app', label: '概览', icon: <FolderKanban size={17} aria-hidden="true" /> },
  ]
  const flatItems: NavItem[] = [
    ...items,
    ...(navGroups?.flatMap((g) => g.items) ?? []),
  ]
  const selected = flatItems.find((item) => location.pathname.startsWith(item.path))
  const isSettingsMode =
    settingsContent !== undefined &&
    (location.pathname.startsWith('/settings') || location.pathname.startsWith('/account'))

  // 平铺 nav 与 navGroups 共用的可见性规则：perm 九宫格角色门控（不变）+ permKey
  // 集合门控——rolePerms 已知（非 undefined）且不含该键 → 隐藏；未知（旧载荷/无
  // Provider）→ 默认显示，向后兼容。owner 不特判（owner 的 role_perms 即全量目录）。
  const isNavVisible = (item: NavItem): boolean => {
    // 平台管理员绕过角色级过滤（permKey 细粒度仍按其生效权限集执行）
    if (item.perm !== undefined && !isPlatformAdmin && !roleSatisfies(role, item.perm)) return false
    if (item.permKey !== undefined && rolePerms !== undefined && !rolePerms.includes(item.permKey)) {
      return false
    }
    return true
  }

  const renderNavItem = (item: NavItem) => {
    const active = selected?.path === item.path
    return (
      <SidebarMenuItem key={item.path}>
        <SidebarMenuButton
          isActive={active}
          aria-current={active ? 'page' : undefined}
          tooltip={item.label}
          onClick={() => navigate(item.path)}
        >
          {item.icon}
          <span className="truncate">{item.label}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    )
  }

  return (
    <SidebarProvider defaultOpen={readSidebarCookieOpen()}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          {sidebarHeader ?? (
            <div className="flex items-center gap-2 px-2 pb-1 pt-1 group-data-[collapsible=icon]:justify-center">
              {logo && (
                <picture>
                  <source media="(prefers-color-scheme: dark)" srcSet={logoDark ?? logo} />
                  <img
                    src={logo}
                    alt={`${brand ?? 'App'} logo`}
                    className="h-7 w-auto group-data-[collapsible=icon]:w-7 group-data-[collapsible=icon]:object-contain"
                  />
                </picture>
              )}
              <div className="text-lg font-bold text-foreground group-data-[collapsible=icon]:hidden">
                {brand ?? 'App'}
              </div>
            </div>
          )}
        </SidebarHeader>
        <SidebarContent>
          {isSettingsMode ? (
            settingsContent
          ) : (
            <>
              <SidebarGroup>
                <SidebarGroupContent>
                  <SidebarMenu>{items.filter(isNavVisible).map(renderNavItem)}</SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
              {navGroups?.map((group) => {
                // 可见性统一走 isNavVisible（perm 角色门控 + permKey 集合门控，与平铺 nav 同规则）
                const visible = group.items.filter(isNavVisible)
                if (visible.length === 0) return null
                return (
                  <SidebarGroup key={group.group}>
                    <SidebarGroupLabel>{group.group}</SidebarGroupLabel>
                    <SidebarGroupContent>
                      <SidebarMenu>{visible.map(renderNavItem)}</SidebarMenu>
                    </SidebarGroupContent>
                  </SidebarGroup>
                )
              })}
            </>
          )}
        </SidebarContent>
        <SidebarFooter
          className={
            // sidebar-footer 模式下用户卡折叠时收成头像（SidebarUserMenu 自理），
            // 仅产品自定义 footer 内容保持折叠隐藏——由上方包裹层承担。
            userMenu === 'sidebar-footer'
              ? undefined
              : 'group-data-[collapsible=icon]:hidden'
          }
        >
          {sidebarFooter}
          {userMenu === 'sidebar-footer' && (
            <SidebarUserMenu items={userMenuItems} />
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        {/* 模拟会话警示条（ADR 0008）：impersonated_by 非空时持久显示在内容区
            最顶部；无退出按钮——退出由发起管理员控制。 */}
        <ImpersonationBanner />
        {/* 顶栏（官方 sidebar 蓝本）：h-16、侧栏折叠时降为 h-12，无边框；
            触发器与面包屑同组，sidebar-07 式竖分隔线隔开。 */}
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            {/* 面包屑：nav/navGroups 命中项为一级；SettingsShell 等二级布局通过
                props.breadcrumbTail 追加层级。 */}
            {breadcrumbTail !== null ? (
              <>
                <Separator
                  orientation="vertical"
                  className="data-[orientation=vertical]:h-4"
                />
                <Breadcrumb>
                  <BreadcrumbList>
                    {/* selected 与 tail 同名（分组导航命中项即叶子页）时只渲染一个，避免"调度 > 调度" */}
                    {selected && selected.label !== breadcrumbTail && (
                      <>
                        <BreadcrumbItem>
                          <BreadcrumbPage>{selected.label}</BreadcrumbPage>
                        </BreadcrumbItem>
                        <BreadcrumbSeparator />
                      </>
                    )}
                    <BreadcrumbItem>
                      <BreadcrumbPage>{breadcrumbTail}</BreadcrumbPage>
                    </BreadcrumbItem>
                  </BreadcrumbList>
                </Breadcrumb>
              </>
            ) : null}
          </div>
          <div className="flex-1" />
          <div className="flex items-center gap-2 px-4">
            {headerRight}
            {userMenu !== 'sidebar-footer' && <UserMenu items={userMenuItems} />}
          </div>
        </header>
        {/* P3-23：不再嵌套 <main>——SidebarInset 已是 <main> 地标，文档树内
            main 必须唯一（嵌套双 main 违反 landmark 唯一性）。滚动责任不变：
            本元素仍是 overflow-auto 滚动容器（SettingsShell sticky 的参照，
            见其 aside 注释），语义地标归 SidebarInset 承担。 */}
        <div className="flex-1 overflow-auto p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
