
import { useLocation, useNavigate } from 'react-router'
import { useEffect, type ReactNode } from 'react'
import { FolderKanban } from 'lucide-react'
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarTrigger,
} from '../components/ui/sidebar'
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage, BreadcrumbSeparator,
} from '../components/ui/breadcrumb'
import { UserMenu } from '../components/UserMenu'
import { ImpersonationBanner } from '../components/ImpersonationBanner'

// stock SidebarProvider 只写不读 sidebar_state cookie（写入供 SSR 框架回传 defaultOpen）。
// CSR 产品在组合层回读，保持跨会话折叠状态（P2-17，自 stock 镜像化后上提至此）。
function readSidebarCookieOpen(): boolean {
  if (typeof document === 'undefined') return true // SSR 安全
  return !document.cookie.split('; ').includes('sidebar_state=false')
}

export interface NavItem {
  path: string
  label: string
  
  icon?: ReactNode
}

export function AppShell({ children, nav, brand, logo, logoDark, sidebarFooter, headerRight, breadcrumbTail = null, settingsContent }: {
  children: ReactNode
  nav?: NavItem[]
  brand?: string
  
  /** 品牌图形（sidebar 顶栏，方形 mark 最佳，h-7 宽自适应）；与 brand 文字横排。 */
  logo?: string
  /** 暗色变体，经 prefers-color-scheme 切换——仅当应用主题跟随系统时才传；
   *  固定亮色主题的应用不要传（否则深色系统的用户会在亮底上拿到暗色变体）。 */
  logoDark?: string
  
  sidebarFooter?: ReactNode
  
  headerRight?: ReactNode
  
  breadcrumbTail?: string | null
  
  settingsContent?: ReactNode
}) {
  const location = useLocation()
  const navigate = useNavigate()

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
  const selected = items.find((item) => location.pathname.startsWith(item.path))
  const isSettingsMode =
    settingsContent !== undefined &&
    (location.pathname.startsWith('/settings') || location.pathname.startsWith('/account'))

  return (
    <SidebarProvider defaultOpen={readSidebarCookieOpen()}>
      <Sidebar collapsible="icon">
        <SidebarHeader>
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
        </SidebarHeader>
        <SidebarContent>
          {isSettingsMode ? (
            settingsContent
          ) : (
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {items.map((item) => {
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
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter className="group-data-[collapsible=icon]:hidden">
          {sidebarFooter}
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        {/* 模拟会话警示条（ADR 0008）：impersonated_by 非空时持久显示在内容区
            最顶部；无退出按钮——退出由发起管理员控制。 */}
        <ImpersonationBanner />
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background px-4">
          <SidebarTrigger />
          {/* 面包屑（sidebar-07 蓝本）：nav 命中项为一级；SettingsShell 等二级布局通过
              props.breadcrumbTail 追加层级。 */}
          {breadcrumbTail !== null ? (
            <Breadcrumb>
              <BreadcrumbList>
                {selected && (
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
          ) : null}
          <div className="flex-1" />
          {headerRight}
          <UserMenu />
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
