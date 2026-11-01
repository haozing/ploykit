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
import { Label } from '../../components/ui/label'
import { useRoleConfig, type PKRoleConfig } from '@ploykit/hooks'
import { isApiError } from '@ploykit/client'
import { apiErrorMessage } from '../../lib/api-error'
import { ROLE_LABEL } from '../../lib/utils'
import { useT } from '../../i18n'

// i18n（g6 分片）：权限域标签进字典，域码 → key。
const DOMAIN_LABEL_KEY: Record<string, string> = {
  workspace: 'workspace.rolePermissions.domainWorkspace',
  members: 'workspace.rolePermissions.domainMembers',
  invites: 'workspace.rolePermissions.domainInvites',
  roles: 'workspace.rolePermissions.domainRoles',
  billing: 'workspace.rolePermissions.domainBilling',
  webhooks: 'workspace.rolePermissions.domainWebhooks',
  notifications: 'workspace.rolePermissions.domainNotifications',
  audit: 'workspace.rolePermissions.domainAudit',
  usage: 'workspace.rolePermissions.domainUsage',
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
  const t = useT()
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
      toast.success(t('workspace.rolePermissions.updatedToast', { role: ROLE_LABEL[role] ?? role }))
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
      title: t('workspace.rolePermissions.resetTitle', { role: ROLE_LABEL[role] ?? role }),
      description: t('workspace.rolePermissions.resetDesc'),
      confirmText: t('workspace.rolePermissions.resetDefault'),
    })
    if (!ok) return
    try {
      await resetPerms.mutateAsync(role)
      toast.success(t('workspace.rolePermissions.resetToast', { role: ROLE_LABEL[role] ?? role }))
    } catch (err) {
      if (isReauth(err)) {
        setPendingRetry(() => () => resetPerms.mutateAsync(role))
        setReauthOpen(true)
        return
      }
      toast.error(apiErrorMessage(err))
    }
  }

  if (loading) return <PageLoading label={t('workspace.rolePermissions.loading')} />
  if (error) return <PageError message={apiErrorMessage(error)} />

  return (
    <div className="space-y-4">
      <PageHeader title={t('workspace.rolePermissions.title')} />

      {roles.map((r: PKRoleConfig) => {
        const draft = drafts[r.role]
        return (
          <SettingsCard
            key={r.role}
            title={
              <>
                {ROLE_LABEL[r.role] ?? r.role}
                {r.overridden && <Badge variant="secondary">{t('workspace.rolePermissions.customized')}</Badge>}
              </>
            }
            cta={
              <div className="flex gap-2">
                {r.overridden && (
                  <Button variant="outline" size="sm" onClick={() => void reset(r.role)}>
                    <RotateCcw className="size-4" />
                    {t('workspace.rolePermissions.resetDefault')}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!draft?.dirty || setPerms.isPending}
                  onClick={() => void save(r.role)}
                >
                  <Save className="size-4" />
                  {t('workspace.rolePermissions.saveChanges')}
                </Button>
              </div>
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              {groups.map(({ domain, perms }) => (
                <div key={domain} className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">
                    {DOMAIN_LABEL_KEY[domain] ? t(DOMAIN_LABEL_KEY[domain]) : domain}
                  </p>
                  <div className="space-y-1.5">
                    {perms.map((perm) => (
                      <Label key={perm}>
                        <Checkbox
                          checked={draft?.perms.includes(perm) ?? false}
                          onCheckedChange={(v) => toggle(r.role, perm, v === true)}
                        />
                        <span className="font-mono text-xs">{perm}</span>
                      </Label>
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
