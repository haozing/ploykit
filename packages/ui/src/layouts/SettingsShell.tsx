
import { Link, useLocation, useNavigate } from 'react-router'
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import { roleSatisfies, type Perm } from '@ploykit/hooks'
import { useWorkspace } from '@ploykit/hooks'
import { buttonVariants } from '../components/ui/button'
import { Separator } from '../components/ui/separator'
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '../components/ui/select'

export interface SettingsNavItem {
  path: string
  label: string
  
  icon?: ReactNode
  
  perm?: Perm
}

export interface SettingsNavGroup {
  
  group: string
  items: SettingsNavItem[]
}

export interface SettingsShellProps {
  
  nav?: SettingsNavGroup[]
  children: ReactNode
  title?: string
  description?: string
}

export function SettingsShell({ nav, children, title = '设置', description }: SettingsShellProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const role = useWorkspace().current?.role

  const isActive = (path: string) =>
    location.pathname === path || location.pathname.startsWith(path + '/')

  
  const visibleNav = (nav ?? [])
    .map((g) => ({ ...g, items: g.items.filter((i) => roleSatisfies(role, i.perm)) }))
    .filter((g) => g.items.length > 0)

  const flatItems = visibleNav.flatMap((g) => g.items)
  const activeItem = flatItems.find((i) => isActive(i.path))
  const hasNav = visibleNav.length > 0

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div>
        {/* G7.1（双 H1，9 页复现）：壳标题降为非 heading 的品牌区——页内 PageHeader
            的 h1 是全页唯一一级标题（审计建议二选一降级，此处让位）。
            视觉保持 text-2xl md:text-3xl 字重不变，仅去掉 heading 语义。 */}
        <div className="text-2xl md:text-3xl font-bold tracking-tight">{title}</div>
        {description && <p className="mt-1 text-base text-muted-foreground">{description}</p>}
      </div>
      <Separator className="my-4 lg:my-6" />

      <div className={cn('flex flex-col gap-6', hasNav && 'lg:flex-row lg:gap-0 lg:space-x-12')}>
        {/* 窄屏：分组导航降级为 Select（仅页内导航模式） */}
        {hasNav && (
        <div className="lg:hidden">
          <Select
            value={activeItem?.path ?? null}
            onValueChange={(v) => typeof v === 'string' && v && navigate(v)}
          >
            <SelectTrigger className="w-full" aria-label="设置导航">
              <SelectValue>{activeItem?.label ?? '跳转设置页'}</SelectValue>
            </SelectTrigger>
            <SelectContent align="start">
              {visibleNav.map((group) => (
                <SelectGroup key={group.group}>
                  <SelectLabel>{group.group}</SelectLabel>
                  {group.items.map((item) => (
                    <SelectItem key={item.path} value={item.path}>{item.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        )}

        {/* 宽屏：左侧分组导航（sticky——长设置页滚动时导航常驻；仅页内导航模式）。
            self-start 是 sticky 生效前提（flex 行内 item 默认 stretch 拉满高度后
            无滚动余量）；top-0 相对 AppShell 内容区滚动容器（P3-23 起该容器为
            div（overflow-auto），地标 main 在 SidebarInset——滚动责任未变）。 */}
        {hasNav && (
        <aside className="hidden lg:block lg:w-1/5 lg:self-start lg:sticky lg:top-0">
          <nav aria-label="设置导航">
            {visibleNav.map((group) => (
              <div key={group.group} className="mb-6">
                <p className="mb-2 px-2 text-xs uppercase tracking-wider text-muted-foreground">
                  {group.group}
                </p>
                <ul className="space-y-1">
                  {group.items.map((item) => (
                    <li key={item.path}>
                      <Link
                        to={item.path}
                        aria-current={isActive(item.path) ? 'page' : undefined}
                        className={cn(
                          buttonVariants({ variant: 'ghost' }),
                          'w-full justify-start',
                          isActive(item.path) && 'bg-muted',
                        )}
                      >
                        {item.icon}
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
        )}

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  )
}
