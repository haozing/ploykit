import { useNavigate } from '../router'
import { ChevronsUpDown, LogOut, ShieldCheck } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar,
} from './ui/sidebar'
import { useAuthSafe } from '../lib/useAuthSafe'
import {
  permissionVisible, useIsPlatformAdminSafe, useWorkspaceRoleSafe,
} from '../lib/useWorkspaceRoleSafe'
import { toast } from './toast'
import {
  DEFAULT_USER_MENU_LABELS, initialsOf,
  type UserMenuExtraItem, type UserMenuLabels,
} from './UserMenu'

export interface SidebarUserMenuProps {
  items?: UserMenuExtraItem[]
  logoutRedirect?: string
  /** 文案覆盖（可选）：缺省沿用内置中文，行为对存量消费方零变化。 */
  labels?: UserMenuLabels
}

// 侧栏底部用户卡（sidebar-07 NavUser 模式）：折叠态收成头像，点开右侧面板。
// 与头部 UserMenu 共用 items 协议（UserMenuExtraItem），产品传入各自的账户菜单项。
export function SidebarUserMenu({ items = [], logoutRedirect = '/login', labels }: SidebarUserMenuProps) {
  // Provider-safe：无 AuthContext 时渲染空（AppShell 不强制宿主包 PloykitProvider）。
  // useSidebar/useNavigate/权限读取在条件返回前调用，保证 Provider 后挂载时 hooks 顺序不变。
  const { isMobile } = useSidebar()
  const auth = useAuthSafe()
  const navigate = useNavigate()
  const { role, rolePerms } = useWorkspaceRoleSafe()
  const isPlatformAdmin = useIsPlatformAdminSafe()
  if (!auth) return null
  const { user, logout } = auth

  // 与 AppShell 侧栏、头部 UserMenu 同一可见性规则（permissionVisible）：
  // 无 perm/permKey 恒可见；role_perms 未知（旧载荷/无 Provider）时 permKey 项默认显示。
  const visibleItems = items.filter((item) =>
    permissionVisible(item, role, rolePerms, isPlatformAdmin))

  const name = user?.display_name || user?.email || ''
  const email = user?.email ?? ''

  const handleLogout = async () => {
    try {
      await logout()
    } catch {
      toast.error(labels?.logoutFailedToast ?? DEFAULT_USER_MENU_LABELS.logoutFailedToast)
    }
    navigate(logoutRedirect)
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              />
            }
            aria-label={labels?.userMenuAria ?? DEFAULT_USER_MENU_LABELS.userMenuAria}
          >
            <Avatar className="h-8 w-8 rounded-lg">
              {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt={name} /> : null}
              <AvatarFallback className="rounded-lg">{initialsOf(user?.display_name ?? '', email)}</AvatarFallback>
            </Avatar>
            <span className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name || '未登录'}</span>
              <span className="truncate text-xs">{email}</span>
            </span>
            <ChevronsUpDown className="ml-auto size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--anchor-width) min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <Avatar className="h-8 w-8 rounded-lg">
                    {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt={name} /> : null}
                    <AvatarFallback className="rounded-lg">{initialsOf(user?.display_name ?? '', email)}</AvatarFallback>
                  </Avatar>
                  <span className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-medium">{name || '未登录'}</span>
                    <span className="truncate text-xs">{email}</span>
                  </span>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            {visibleItems.length > 0 && (
              <DropdownMenuGroup>
                {visibleItems.map((item) => (
                  <DropdownMenuItem
                    key={item.label}
                    variant={item.destructive ? 'destructive' : 'default'}
                    onClick={() => (item.to ? navigate(item.to) : item.onClick?.())}
                  >
                    {item.icon}
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
            )}
            {/* 平台管理员入口：与头部 UserMenu 同条件同目标（/admin 由各产品路由承接） */}
            {user?.is_platform_admin && (
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => navigate('/admin')}>
                  <ShieldCheck /> 管理控制台
                </DropdownMenuItem>
              </DropdownMenuGroup>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem variant="destructive" onClick={handleLogout}>
                <LogOut /> {labels?.logout ?? DEFAULT_USER_MENU_LABELS.logout}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
