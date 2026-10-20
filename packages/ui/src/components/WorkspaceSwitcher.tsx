
import { useState, type ReactNode } from 'react'
import { Link } from '../router'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { isApiError } from '@ploykit/client'
import { cn } from '../lib/utils'
import { apiErrorMessage } from '../lib/api-error'
import { useWorkspaceSwitch } from '@ploykit/hooks'
import { toast } from './toast'
import { useKitLabels } from '../labels/kit-labels'
import { Button } from './ui/button'
import { Input } from './ui/input'
import {
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from './ui/sidebar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/dropdown-menu'


const slugSuffix = (n = 4): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}


/** 工作区名 → slug：小写、非法字符转 -、≤40 字符、<4 补随机后缀（orkome
 *  采纳报告 #5 导出——注入 create 的消费方调用它即可与 kit 内置流程对齐，
 *  避免各抄一份随版本漂移）。 */
export function slugifyWorkspaceName(s: string): string {
  let slug = s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length > 40) slug = slug.slice(0, 40).replace(/-+$/g, '')
  if (slug.length < 4) slug = `${slug || 'ws'}-${slugSuffix()}`
  return slug
}

/** slugify 内部别名（保持调用点简洁）。 */
const slugify = slugifyWorkspaceName

/** 注入数据的行形状（镜像 useWorkspaceSwitch 返回的 PKWorkspace 的消费子集）。 */
export interface WorkspaceSwitcherData {
  current?: { id: string; name: string; slug?: string; plan_code?: string } | null
  list?: Array<{ id: string; name: string; slug?: string; plan_code?: string }>
  switchTo: (id: string) => void | Promise<void>
  /** 单参 `(name)` 为既有契约（slug 决策归消费方，可用导出的
   *  slugifyWorkspaceName 对齐）；声明为二参可选 `(name, kit)` 时 kit 会在
   *  调用时带上 kit 生成的 slug，消费方可直接采用。 */
  create: (name: string, kit?: { slug: string }) => void | Promise<void>
  creating?: boolean
  /** 创建失败对象（orkome 采纳报告 #2）：推荐直接传原始 ApiError——kit 用
   *  apiErrorMessage 统一翻译，且 E_QUOTA_EXCEEDED / 402 会点亮计费引导分支。
   *  string 兼容保留（历史契约：消费方已本地化的文案，原样显示），但 string
   *  无法参与配额判定，注入配额错误请传 ApiError。 */
  error?: unknown
}

export interface WorkspaceSwitcherProps {
  /** Data injection seam for progressive adoption: consumers that do not mount
   *  WorkspaceContext can feed their own state; shape mirrors useWorkspaceSwitch.
   *  Absent → the hook (context) is used, exactly as before. Field-level merge:
   *  a consumer may inject only `current`/`list` and keep the built-in create
   *  flow when it also mounts WorkspaceContext — consumers injecting data
   *  WITHOUT the provider should therefore supply `switchTo` / `create`
   *  themselves (the hook's functions require the provider and will throw). */
  data?: Partial<WorkspaceSwitcherData>
  /** Optional footer rendered after the built-in "create workspace" block
   *  inside the dropdown menu. */
  menuFooter?: ReactNode
  /** 计费引导链接的目标路径（默认框架设置页 `/settings/workspace/billing`；
   *  产品自定义设置路由时覆盖，避免死链）。 */
  billingHref?: string
}

export function WorkspaceSwitcher({ data, menuFooter, billingHref }: WorkspaceSwitcherProps = {}) {
  const L = useKitLabels()
  // 计费引导链接：组件 prop → Provider（quotaBillingHref）→ 内置默认。
  const resolvedBillingHref = billingHref ?? L.quotaBillingHref
  // Provider-safe 调用（与 lib/useWorkspaceRoleSafe 同款 try/catch）：hooks 不能
  // 条件调用，无 WorkspaceContext 时钩子整体降级为空——注入数据经下方字段级合并
  // 接管渲染。纯注入消费方（不挂 Provider）应自带 switchTo/create（见 props 注释）。
  let hooked: ReturnType<typeof useWorkspaceSwitch> | null = null
  try {
    hooked = useWorkspaceSwitch()
  } catch {
    hooked = null
  }
  const injected = data
  const current = injected?.current ?? hooked?.current ?? null
  const list = injected?.list ?? hooked?.list ?? []
  const switchTo = injected?.switchTo ?? hooked?.switchTo
  const injectedCreate = injected?.create
  const creating = injected?.creating ?? hooked?.creating ?? false
  const error = injected?.error ?? hooked?.error ?? null

  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')



  // 注入的 error 契约为 unknown：string 视为已本地化文案原样显示；其余
  // （推荐 ApiError）走 apiErrorMessage 翻译，isApiError 判定点亮配额引导
  // 分支——与 hook 轨同一条错误管线，两轨互不影响。
  const createError = typeof error === 'string'
    ? error
    : error === null ? null : apiErrorMessage(error, L.createErrorFallback)
  const quotaExceeded = isApiError(error, 'E_QUOTA_EXCEEDED') || (isApiError(error) && error.status === 402)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    if (injectedCreate !== undefined) {
      // 注入流程：name + kit 生成的 slug（slugifyWorkspaceName 同源，消费方可
      // 采用亦可忽略）。resolve 即收起面板；reject 时面板保持打开——错误提示
      // 由消费方在 menuFooter 等处自行展示。
      try {
        await injectedCreate(trimmed, { slug: slugify(trimmed) })
        setName('')
        setShowCreate(false)
      } catch {
        /* 面板保持打开 */
      }
      return
    }
    const hookCreate = hooked?.create
    if (hookCreate === undefined) return
    const ws = await hookCreate(trimmed, slugify(trimmed))
    if (ws) {
      toast.success(L.workspaceCreatedToast(ws.name))
      setName('')
      setShowCreate(false)
    }
  }

  return (
    <div className="relative">
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
              aria-label={L.workspaceSwitcherAria}
            >
              <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
                {current?.name?.[0]?.toUpperCase() ?? '?'}
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{current?.name ?? L.workspacePickerPlaceholder}</span>
                <span className="truncate text-xs">
                  {current?.plan_code ?? '—'}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-(--anchor-width) min-w-56 rounded-lg" align="start" side="bottom" sideOffset={4}>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">{L.workspaceGroupLabel}</DropdownMenuLabel>
                {list.map((ws) => (
                  <DropdownMenuItem
                    key={ws.id}
                    className="gap-2 p-2"
                    onClick={() => switchTo?.(ws.id)}
                  >
                    <span className="flex size-6 items-center justify-center rounded-md border bg-transparent text-[10px] font-bold">
                      {ws.name[0]?.toUpperCase()}
                    </span>
                    <span className="flex-1 truncate">{ws.name}</span>
                    {current?.id === ws.id && <Check className="size-4" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 p-2" onClick={() => setShowCreate(true)}>
                <span className="flex size-6 items-center justify-center rounded-md border bg-transparent">
                  <Plus className="size-4" />
                </span>
                <span className="whitespace-nowrap font-medium text-muted-foreground">{L.createWorkspace}</span>
              </DropdownMenuItem>
              {menuFooter}
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>

      {showCreate && (
        <div
          className={cn(
            'absolute left-0 top-full z-50 mt-2 w-64 rounded-lg border bg-popover p-2 shadow-lg',
          )}
        >
          <Input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !creating) handleCreate()
            }}
            placeholder={L.workspaceNamePlaceholder}
            aria-label={L.newWorkspaceNameAria}
            maxLength={64} 
          />
          <div className="mt-2 flex gap-1">
            <Button size="sm" className="flex-1" onClick={handleCreate} disabled={!name.trim() || creating}>
              {creating ? L.creating : L.create}
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>
              {L.cancel}
            </Button>
          </div>
          {createError && (
            <div className="mt-2 space-y-1">
              <p role="alert" className="text-xs text-destructive">{createError}</p>
              {quotaExceeded && (
                
                <p className="text-xs text-muted-foreground">
                  {L.quotaGuidancePrefix}
                  <Link to={resolvedBillingHref} className="mx-1 text-primary underline-offset-2 hover:underline">
                    {L.quotaGuidanceLinkText}
                  </Link>
                  {L.quotaGuidanceSuffix}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
