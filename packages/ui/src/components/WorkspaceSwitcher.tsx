
import { useState } from 'react'
import { Link } from 'react-router'
import { Check, ChevronsUpDown, Plus } from 'lucide-react'
import { isApiError } from '@ploykit/client'
import { cn } from '../lib/utils'
import { apiErrorMessage } from '../lib/api-error'
import { useWorkspaceSwitch } from '@ploykit/hooks'
import { toast } from './toast'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import {
  SidebarMenu, SidebarMenuButton, SidebarMenuItem,
} from './ui/sidebar'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from './ui/menu'


const slugSuffix = (n = 4): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = ''
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}


const slugify = (s: string): string => {
  let slug = s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length > 40) slug = slug.slice(0, 40).replace(/-+$/g, '')
  if (slug.length < 4) slug = `${slug || 'ws'}-${slugSuffix()}`
  return slug
}

export function WorkspaceSwitcher() {
  const { current, list, switchTo, create, creating, error } = useWorkspaceSwitch()
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  
  
  
  const createError = error === null ? null : apiErrorMessage(error, '创建工作区失败，请稍后重试')
  const quotaExceeded = isApiError(error, 'E_QUOTA_EXCEEDED') || (isApiError(error) && error.status === 402)

  const handleCreate = async () => {
    if (!name.trim()) return
    const ws = await create(name.trim(), slugify(name.trim()))
    if (ws) {
      toast.success(`工作区「${ws.name}」已创建`)
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
              aria-label="切换工作区"
            >
              <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
                {current?.name?.[0]?.toUpperCase() ?? '?'}
              </span>
              <span className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{current?.name ?? '选择工作区'}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {current?.plan_code ?? '—'}
                </span>
              </span>
              <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-(--anchor-width) min-w-56" align="start" side="bottom" sideOffset={4}>
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-xs text-muted-foreground">工作区</DropdownMenuLabel>
                {list.map((ws) => (
                  <DropdownMenuItem
                    key={ws.id}
                    className="gap-2 p-2"
                    onClick={() => switchTo(ws.id)}
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
                <span className="whitespace-nowrap font-medium text-muted-foreground">新建工作区</span>
              </DropdownMenuItem>
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
            placeholder="工作区名称"
            aria-label="新工作区名称"
            maxLength={64} 
          />
          <div className="mt-2 flex gap-1">
            <Button size="sm" className="flex-1" onClick={handleCreate} disabled={!name.trim() || creating}>
              {creating ? '创建中…' : '创建'}
            </Button>
            <Button size="sm" variant="outline" className="flex-1" onClick={() => setShowCreate(false)}>
              取消
            </Button>
          </div>
          {createError && (
            <div className="mt-2 space-y-1">
              <p role="alert" className="text-xs text-destructive">{createError}</p>
              {quotaExceeded && (
                
                <p className="text-xs text-muted-foreground">
                  已达当前工作区数上限，可在
                  <Link to="/settings/workspace/billing" className="mx-1 text-primary underline-offset-2 hover:underline">
                    设置→计费
                  </Link>
                  查看套餐与配额
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
