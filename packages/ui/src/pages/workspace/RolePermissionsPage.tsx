import { useEffect, useMemo, useState } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import {
  PageHeader, PageLoading, PageError,
} from '../../components/Page'
import { SettingsCard } from '../../components/SettingsCard'
import { ReauthDialog } from '../../components/ReauthDialog'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui/button'
import { Badge } from '../../components/ui/badge'
import { Checkbox } from '../../components/ui/checkbox'
import { useRoleConfig, type PKRoleConfig } from '@ploykit/hooks'
import { isApiError } from '@ploykit/client'
import { apiErrorMessage } from '../../lib/api-error'

const ROLE_LABEL: Record<string, string> = { owner: '所有者', admin: '管理员', member: '成员' }

const DOMAIN_LABEL: Record<string, string> = {
  workspace: '工作区',
  members: '成员',
  invites: '邀请',
  roles: '角色权限',
  billing: '计费',
  webhooks: 'Webhooks',
  notifications: '通知',
  audit: '审计',
  usage: '用量',
}

function domainOf(perm: string): string {
  const i = perm.indexOf(':')
  return i > 0 ? perm.slice(0, i) : perm
}

/** catalog 权限按域分组，保持目录的字典序。 */
function groupByDomain(catalog: string[]): Array<{ domain: string; perms: string[] }> {
  const groups = new Map<string, string[]>()
  for (const p of catalog) {
    const d = domainOf(p)
    const arr = groups.get(d) ?? []
    arr.push(p)
    groups.set(d, arr)
  }
  return [...groups.entries()].map(([domain, perms]) => ({ domain, perms }))
}

interface RoleDraft {
  perms: string[]
  dirty: boolean
}

function isReauth(err: unknown): boolean {
  return isApiError(err, 'E_REAUTH_REQUIRED')
}

export interface RolePermissionsPageProps {
  /** 无需 props：工作区上下文来自 PloykitProvider。保留 prop 通道便于产品扩展。 */
}

export function RolePermissionsPage(_props: RolePermissionsPageProps = {}) {
  const { roles, catalog, loading, error, setPerms, resetPerms } = useRoleConfig()
  const confirm = useConfirm()

  const [drafts, setDrafts] = useState<Record<string, RoleDraft>>({})
  const [reauthOpen, setReauthOpen] = useState(false)
  const [pendingRetry, setPendingRetry] = useState<(() => Promise<unknown>) | null>(null)

  // 数据到达（或写后失效重取）时以服务端有效集重建草稿
  useEffect(() => {
    const next: Record<string, RoleDraft> = {}
    for (const r of roles) next[r.role] = { perms: [...r.perms], dirty: false }
    setDrafts(next)
  }, [roles])

  const groups = useMemo(() => groupByDomain(catalog), [catalog])

  const toggle = (role: string, perm: string, on: boolean) => {
    setDrafts((d) => {
      const cur = d[role]
      if (!cur) return d
      const perms = on ? [...cur.perms, perm].sort() : cur.perms.filter((p) => p !== perm)
      const server = roles.find((r) => r.role === role)?.perms ?? []
      const dirty = perms.join('\u0000') !== server.join('\u0000')
      return { ...d, [role]: { perms, dirty } }
    })
  }

  const save = async (role: string) => {
    const draft = drafts[role]
    if (!draft) return
    try {
      await setPerms.mutateAsync({ role, perms: draft.perms })
      toast.success(`已更新${ROLE_LABEL[role] ?? role}权限`)
    } catch (err) {
      if (isReauth(err)) {
        setPendingRetry(() => () => setPerms.mutateAsync({ role, perms: draft.perms }))
        setReauthOpen(true)
        return
      }
      toast.error(apiErrorMessage(err))
    }
  }

  const reset = async (role: string) => {
    const ok = await confirm({
      title: `恢复${ROLE_LABEL[role] ?? role}默认权限？`,
      description: '自定义权限集将被清除，该角色回到内置默认权限。',
      confirmText: '恢复默认',
    })
    if (!ok) return
    try {
      await resetPerms.mutateAsync(role)
      toast.success(`已恢复${ROLE_LABEL[role] ?? role}默认权限`)
    } catch (err) {
      if (isReauth(err)) {
        setPendingRetry(() => () => resetPerms.mutateAsync(role))
        setReauthOpen(true)
        return
      }
      toast.error(apiErrorMessage(err))
    }
  }

  if (loading) return <PageLoading label="加载角色权限…" />
  if (error) return <PageError message={apiErrorMessage(error)} />

  return (
    <div className="mx-auto w-full max-w-4xl p-6">
      <PageHeader
        title="角色权限"
        description="自定义各角色能做什么。所有者始终拥有全部权限；自定义集为整体替换（非累加），未知权限会被服务端拒绝。"
      />

      {roles.map((r: PKRoleConfig) => {
        const draft = drafts[r.role]
        return (
          <SettingsCard
            key={r.role}
            title={
              <>
                {ROLE_LABEL[r.role] ?? r.role}
                {r.overridden && <Badge variant="secondary">已自定义</Badge>}
              </>
            }
            description={r.overridden
              ? '当前为自定义权限集（覆盖默认）'
              : '当前为内置默认权限集'}
            cta={
              <div className="flex gap-2">
                {r.overridden && (
                  <Button variant="outline" size="sm" onClick={() => void reset(r.role)}>
                    <RotateCcw className="size-4" />
                    恢复默认
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!draft?.dirty}
                  onClick={() => void save(r.role)}
                >
                  <Save className="size-4" />
                  保存修改
                </Button>
              </div>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map(({ domain, perms }) => (
                <div key={domain} className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {DOMAIN_LABEL[domain] ?? domain}
                  </p>
                  <div className="space-y-1.5">
                    {perms.map((perm) => (
                      <label
                        key={perm}
                        className="flex items-center gap-2 text-sm"
                      >
                        <Checkbox
                          checked={draft?.perms.includes(perm) ?? false}
                          onCheckedChange={(v) => toggle(r.role, perm, v === true)}
                        />
                        <span className="font-mono text-xs">{perm}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </SettingsCard>
        )
      })}

      <ReauthDialog
        open={reauthOpen}
        retry={pendingRetry}
        onClose={() => { setReauthOpen(false); setPendingRetry(null) }}
      />
    </div>
  )
}
