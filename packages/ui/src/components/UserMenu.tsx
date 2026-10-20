import { useNavigate } from '../router'
import type { ReactNode } from 'react'
import { LogOut, Settings, ShieldCheck } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'
import { useAuthSafe } from '../lib/useAuthSafe'
import { applyKitLabelOverrides, useKitLabels } from '../labels/kit-labels'
import {
  permissionVisible, useIsPlatformAdminSafe, useWorkspaceRoleSafe, type Perm,
} from '../lib/useWorkspaceRoleSafe'
import { toast } from './toast'

export interface UserMenuExtraItem {
  label: string
  onClick?: () => void
  to?: string
  icon?: ReactNode
  destructive?: boolean
  /** Minimum workspace role (owner/admin); hidden when the current role does not satisfy it. */
  perm?: Perm
  /** Fine-grained permission key (e.g. 'billing:read') resolved against the workspace's
   *  effective role_perms. Unknown permission set (legacy payload / no Provider) → visible
   *  (backward compatible, same rule as AppShell's NavItem). */
  permKey?: string
}

/** Optional copy overrides — defaults are the built-in Chinese labels. No i18n
 *  system is imposed; consumers wire their own translation function. */
export interface UserMenuLabels {
  accountSettings?: string
  logout?: string
  userMenuAria?: string
  logoutFailedToast?: string
}

export const DEFAULT_USER_MENU_LABELS = {
  accountSettings: '账户设置',
  logout: '退出登录',
  userMenuAria: '用户菜单',
  logoutFailedToast: '退出登录失败，请稍后在登录页重试',
} satisfies Required<UserMenuLabels>

export interface UserMenuProps {

  items?: UserMenuExtraItem[]

  logoutRedirect?: string

  /** 文案覆盖（可选）：最高优先级（prop → KitLabelsProvider → 内置中文）。
   *  缺省时从 KitLabelsProvider 取值（未挂 Provider 则内置中文），
   *  行为对存量消费方零变化。 */
  labels?: UserMenuLabels
}

export function initialsOf(name: string, email: string): string {
  const src = name.trim() || email.trim()
  if (!src) return '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || src.slice(0, 2).toUpperCase()
}

export function UserMenu({ items = [], logoutRedirect = '/login', labels }: UserMenuProps) {
  // Provider-safe:无 AuthContext 时渲染空（AppShell 不强制宿主包 PloykitProvider）。
  // useNavigate / 权限读取在条件返回前调用，保证 Provider 后挂载时 hooks 顺序不变。
  const auth = useAuthSafe()
  const navigate = useNavigate()
  const { role, rolePerms } = useWorkspaceRoleSafe()
  const isPlatformAdmin = useIsPlatformAdminSafe()
  // 文案解析顺序：prop > KitLabelsProvider > 内置默认。useKitLabels 未挂
  // Provider 时返回默认值，故逐键覆盖（跳过 undefined，与 Provider 合并语义
  // 一致）即三层回退；向后兼容：既有 labels prop 消费方行为不变。
  const kit = useKitLabels()
  const L = applyKitLabelOverrides(kit, labels)
  if (!auth) return null
  const { user, logout } = auth

  // 与 AppShell 侧栏同一可见性规则（lib/useWorkspaceRoleSafe.permissionVisible）：
  // 无 perm/permKey 恒可见；perm 角色门控；permKey 在已知 role_perms 中做集合包含；
  // role_perms 未知（旧载荷/无 Provider）时 permKey 项默认显示。
  const visibleItems = items.filter((item) =>
    permissionVisible(item, role, rolePerms, isPlatformAdmin))

  const name = user?.display_name || user?.email || ''
  const email = user?.email ?? ''

  const handleLogout = async () => {
    try {
      await logout()
    } catch {
      
      
      toast.error(L.logoutFailedToast)
    }
    navigate(logoutRedirect)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground
                   transition-colors hover:bg-accent hover:text-accent-foreground
                   aria-expanded:bg-accent"
        aria-label={L.userMenuAria}
      >
        <Avatar size="sm">
          {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt={name} /> : null}
          <AvatarFallback>{initialsOf(user?.display_name ?? '', email)}</AvatarFallback>
        </Avatar>
        <span className="hidden max-w-40 truncate md:inline">{name || '未登录'}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="p-0 font-normal">
            <div className="flex flex-col px-2 py-1.5">
              <span className="truncate text-sm font-medium text-foreground">{name || '未登录'}</span>
              <span className="truncate text-xs text-muted-foreground">{email}</span>
            </div>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/account/profile')}>
          <Settings /> {L.accountSettings}
        </DropdownMenuItem>
        {user?.is_platform_admin && (
          <DropdownMenuItem onClick={() => navigate('/admin')}>
            <ShieldCheck /> 管理控制台
          </DropdownMenuItem>
        )}
        {visibleItems.length > 0 && <DropdownMenuSeparator />}
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
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleLogout}>
          <LogOut /> {L.logout}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
