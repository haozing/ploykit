
import { useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { LogOut, Settings, ShieldCheck } from 'lucide-react'
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/menu'
import { useAuth } from '@ploykit/hooks'
import { toast } from './toast'

export interface UserMenuExtraItem {
  label: string
  onClick?: () => void
  to?: string
  icon?: ReactNode
  destructive?: boolean
}

export interface UserMenuProps {
  
  items?: UserMenuExtraItem[]
  
  logoutRedirect?: string
}

function initialsOf(name: string, email: string): string {
  const src = name.trim() || email.trim()
  if (!src) return '?'
  const parts = src.split(/[\s@._-]+/).filter(Boolean)
  return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || src.slice(0, 2).toUpperCase()
}

export function UserMenu({ items = [], logoutRedirect = '/login' }: UserMenuProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const name = user?.display_name || user?.email || ''
  const email = user?.email ?? ''

  const handleLogout = async () => {
    try {
      await logout()
    } catch {
      
      
      toast.error('退出登录失败，请稍后在登录页重试')
    }
    navigate(logoutRedirect)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground
                   transition-colors hover:bg-accent hover:text-accent-foreground
                   aria-expanded:bg-accent"
        aria-label="用户菜单"
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
          <Settings /> 账户设置
        </DropdownMenuItem>
        {user?.is_platform_admin && (
          <DropdownMenuItem onClick={() => navigate('/admin')}>
            <ShieldCheck /> 管理控制台
          </DropdownMenuItem>
        )}
        {items.length > 0 && <DropdownMenuSeparator />}
        {items.map((item) => (
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
          <LogOut /> 退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
