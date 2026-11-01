
import { useState } from 'react'
import { z } from 'zod/mini'
import { PageHeader, PageError, PageEmpty } from '../../components/Page'
import { SettingsCard } from '../../components/SettingsCard'
import { FormField } from '../../components/FormField'
import { PasswordField } from '../../components/PasswordField'
import { Button } from '../../components/ui/button'
import { Spinner } from '../../components/ui/spinner'
import { Badge } from '../../components/ui/badge'
import { DataTable, type Column } from '../../components/DataTable'
import { ImpactConfirmation } from '../../components/SecretModal'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { useApi } from '@ploykit/hooks'
import { useAuth } from '@ploykit/hooks'
import { useZodForm } from '@ploykit/hooks'
import { useSessions, useRevokeSession, useRevokeAllSessions, type SessionInfo } from '@ploykit/hooks'
import { passwordSchema } from '../../lib/password-schema'
import { apiErrorMessage } from '../../lib/api-error'
import { formatDateTime, shortID, STATUS_TONE_CLASS } from '../../lib/utils'
import { useT, t as tt } from '../../i18n'

// 校验文案经 error map 惰性取字典（i18n B 方案）：解析时才调 t；纯函数测试
// （无 Provider）拿 en 默认。new_password 的强度文案来自 lib/password-schema
// （共享 lib，不在 g7 分片，保持原样）。
export const changePwSchema = z
  .object({
    old_password: z.string().check(z.minLength(1, { error: () => tt('account.security.currentPwRequired') })),
    new_password: passwordSchema,
  })
  // B4（ui-audit-10pages §4.2，S3）：new==old 客户端拦截——相同值提交后端会
  // 判定通过并"成功"改密，顺带静默吊销全部会话（服务端无 new==old 校验，
  // 半边 ➡️U1 identity 归属）。跨字段校验须挂对象级 check（字段级拿不到 old）；
  // 与 classic 的 superRefine 同语义：对象形状先过，check 才跑，old 为空时
  // 不会叠加误导性报错。
  .check(
    z.refine((v) => v.old_password === '' || v.new_password !== v.old_password, {
      error: () => tt('account.security.newPwSame'),
      path: ['new_password'],
    }),
  )
type ChangePwForm = z.infer<typeof changePwSchema>

function truncate(s: string, max = 32): string {
  return s.length > max ? s.slice(0, max) + '…' : s
}

export function SecuritySettingsPage() {
  const api = useApi()
  const { refresh, logout } = useAuth()
  const confirm = useConfirm()
  const t = useT() // i18n（B 方案）：页面文案走字典（g7 分片 account.security.*）
  const { sessions, loading, error, refetch } = useSessions()
  const { revoke } = useRevokeSession()
  const { revokeAll } = useRevokeAllSessions()

  const [saving, setSaving] = useState(false)
  const [revokingAll, setRevokingAll] = useState(false)
  const [confirmAllOpen, setConfirmAllOpen] = useState(false)

  const form = useZodForm<ChangePwForm>({
    schema: changePwSchema,
    defaultValues: { old_password: '', new_password: '' },
  })

  const handleChangePw = form.handleSubmit(async (values) => {
    setSaving(true)
    try {
      await api.post('/auth/change-password', {
        old_password: values.old_password,
        new_password: values.new_password,
      })
      toast.success(t('account.security.changeOk'))
      form.reset()
      await refresh() 
    } catch (e) {
      
      
      
      toast.error(apiErrorMessage(e, t('account.security.changeFailed')))
    } finally {
      setSaving(false)
    }
  })

  const handleRevoke = async (s: SessionInfo) => {
    const ok = await confirm({
      title: t('account.security.revokeTitle'),
      description: s.current ? t('account.security.revokeCurrentDesc') : truncate(s.user_agent),
      confirmText: t('account.security.revoke'),
      danger: true,
    })
    if (!ok) return
    try {
      await revoke(s.id)
      if (s.current) {
        
        
        
        toast.success(t('account.security.revokeCurrentOk'))
        await logout()
        window.location.href = '/login'
        return
      }
      toast.success(t('account.security.revokeOk'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('account.security.revokeFailed')))
    }
  }

  const handleRevokeAll = async () => {
    setRevokingAll(true)
    try {
      await revokeAll()
      toast.success(t('account.security.revokeAllOk'))
      window.location.href = '/login'
    } catch (e) {
      toast.error(apiErrorMessage(e, t('account.security.revokeFailed')))
      setRevokingAll(false)
    }
  }

  const columns: Column<SessionInfo>[] = [
    {
      key: 'user_agent', header: t('account.security.colDevice'),
      
      
      
      render: (s) => (
        <span title={s.user_agent} className="text-muted-foreground inline-block max-w-64 truncate">{truncate(s.user_agent)}</span>
      ),
    },
    {
      key: 'ip_hash', header: t('account.security.colIp'),
      render: (s) => <span title={s.ip_hash} className="font-mono text-xs">{shortID(s.ip_hash, 10)}</span>,
    },
    { key: 'last_seen_at', header: t('account.security.colLastSeen'), render: (s) => formatDateTime(s.last_seen_at) },
    { key: 'expires_at', header: t('account.security.colExpires'), render: (s) => formatDateTime(s.expires_at) },
    {
      key: 'current', header: t('account.security.colCurrent'),
      
      render: (s) =>
        s.current === undefined ? (
          <span className="text-muted-foreground">—</span>
        ) : s.current ? (
          <Badge variant="secondary" className={STATUS_TONE_CLASS.positive}>{t('account.security.currentDevice')}</Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      key: 'actions', header: '', className: 'text-right',
      render: (s) => (
        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleRevoke(s)}>
          {t('account.security.revoke')}
        </Button>
      ),
    },
  ]

  return (
    <div>
      <PageHeader title={t('account.security.title')} />

      <SettingsCard
        title={t('account.security.changePw')}
        cta={
          <Button type="submit" form="security-pw-form" disabled={saving}>
            {saving ? (
              <>
                <Spinner aria-hidden="true" />
                {t('account.security.submitting')}
              </>
            ) : (
              t('account.security.changePw')
            )}
          </Button>
        }
      >
        <form id="security-pw-form" onSubmit={handleChangePw} className="max-w-xl space-y-4">
          <FormField label={t('account.security.currentPw')} error={form.formState.errors.old_password?.message} htmlFor="sec-old">
            <PasswordField id="sec-old" autoComplete="current-password" {...form.register('old_password')} />
          </FormField>
          <FormField
            label={t('account.security.newPw')}
            error={form.formState.errors.new_password?.message}
            htmlFor="sec-new"
            description={t('account.security.newPwHint')}
          >
            <PasswordField id="sec-new" autoComplete="new-password" {...form.register('new_password')} />
          </FormField>
        </form>
      </SettingsCard>

      <SettingsCard
        title={t('account.security.sessions')}
        cta={
          <Button variant="destructive" size="sm" disabled={revokingAll} onClick={() => setConfirmAllOpen(true)}>
            {t('account.security.revokeAll')}
          </Button>
        }
      >
        {error ? (
          <PageError message={apiErrorMessage(error, t('account.security.loadFailed'))} onRetry={() => refetch()} />
        ) : (
          <DataTable
            columns={columns}
            rows={sessions}
            rowKey={(s) => s.id}
            loading={loading}
            empty={<PageEmpty label={t('account.security.empty')} />}
          />
        )}
      </SettingsCard>

      <ImpactConfirmation
        open={confirmAllOpen}
        onOpenChange={setConfirmAllOpen}
        onConfirm={handleRevokeAll}
        title={t('account.security.revokeAllTitle')}
        confirmText={t('account.security.revokeAll')}
        danger
        impacts={[
          t('account.security.impactSignOut'),
          t('account.security.impactCookie'),
          t('account.security.impactPat'),
        ]}
      />
    </div>
  )
}
