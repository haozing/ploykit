
import { useState } from 'react'
import * as z from 'zod/mini'
import { PageHeader, PageLoading, PageError } from '../../components/Page'
import { SettingsCard } from '../../components/SettingsCard'
import { FormField } from '../../components/FormField'
import { Alert, AlertDescription, AlertAction } from '../../components/ui/alert'
import { Item, ItemContent, ItemTitle, ItemDescription, ItemActions } from '../../components/ui/item'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { Spinner } from '../../components/ui/spinner'
import { ImpactConfirmation } from '../../components/SecretModal'
import { toast } from '../../components/toast'
import { apiErrorMessage } from '../../lib/api-error'
import { useT, t as tt } from '../../i18n'
import { useApi } from '@ploykit/hooks'
import { useAuth } from '@ploykit/hooks'
import { useZodForm } from '@ploykit/hooks'
import type { PKUser } from '@ploykit/hooks'



// 校验文案经 error map 惰性取字典（i18n B 方案）：解析时才调 t，语言随
// Provider 切换即时生效；纯函数测试（无 Provider）拿 en 默认。
export const profileSchema = z.object({
  display_name: z.string().check(
    z.trim(),
    z.minLength(1, { error: () => tt('account.profile.nameRequired') }),
    z.maxLength(100, { error: () => tt('account.profile.nameTooLong') }),
  ),

  avatar_url: z.string().check(
    z.refine((v) => v === '' || /^https?:\/\//.test(v), { error: () => tt('account.profile.avatarScheme') }),
    z.refine((v) => v === '' || v.length <= 2048, { error: () => tt('account.profile.avatarTooLong') }),
  ),
})
type ProfileForm = z.infer<typeof profileSchema>

export interface ProfileSettingsPageProps {
  
  onDeleted?: () => void
}

export function ProfileSettingsPage({ onDeleted }: ProfileSettingsPageProps) {
  const { user, loading, refresh, logout } = useAuth()
  const api = useApi()
  const t = useT() // i18n（B 方案）：页面文案走字典（g7 分片 account.profile.*）
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const form = useZodForm<ProfileForm>({
    schema: profileSchema,
    defaultValues: { display_name: user?.display_name ?? '', avatar_url: user?.avatar_url ?? '' },
    values: user
      ? { display_name: user.display_name, avatar_url: user.avatar_url ?? '' }
      : undefined, // 用户数据到达后同步进表单（保留已输入内容的 RHF 回退语义）
  })

  if (loading) return <PageLoading label={t('account.profile.loading')} />
  if (!user) {
    return <PageError message={t('account.profile.loadFailed')} onRetry={() => refresh()} />
  }

  const handleSave = form.handleSubmit(async (values) => {
    setSaving(true)
    try {
      await api.patch<PKUser>('/auth/me', {
        display_name: values.display_name,
        avatar_url: values.avatar_url,
      })
      await refresh()
      toast.success(t('account.profile.savedToast'))
    } catch (e) {

      toast.error(apiErrorMessage(e, t('account.profile.saveFailed')))
    } finally {
      setSaving(false)
    }
  })

  const handleResend = async () => {
    setSending(true)
    try {
      await api.post('/auth/send-verification')
      toast.success(t('account.profile.resendOk'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('account.profile.resendFailed')))
    } finally {
      setSending(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await api.delete('/auth/me')
      if (onDeleted) onDeleted()
      else {
        await logout()
        window.location.href = '/login'
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, t('account.profile.deleteFailed')))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div>
      <PageHeader title={t('account.profile.title')} />

      <SettingsCard
        title={t('account.profile.basic')}
        cta={<Button type="submit" form="profile-form" disabled={saving}>{saving ? (<><Spinner aria-hidden="true" />{t('account.profile.saving')}</>) : t('account.profile.save')}</Button>}
      >
        <form id="profile-form" onSubmit={handleSave} className="max-w-xl space-y-4">
          <FormField
            label={t('account.profile.nameLabel')} required
            error={form.formState.errors.display_name?.message} htmlFor="profile-name"
          >
            <Input id="profile-name" maxLength={100} placeholder={t('account.profile.namePlaceholder')} {...form.register('display_name')} />
          </FormField>
          <FormField
            label={t('account.profile.avatarLabel')}
            error={form.formState.errors.avatar_url?.message} htmlFor="profile-avatar"
            description={t('account.profile.avatarHint')}
          >
            <Input id="profile-avatar" maxLength={2048} placeholder="https://…" {...form.register('avatar_url')} />
          </FormField>
        </form>

        <Item variant="outline" className="mt-6">
          <ItemContent className="min-w-0">
            <ItemTitle>{t('account.profile.emailTitle')}</ItemTitle>
            <ItemDescription className="truncate" data-testid="profile-email">
              {user.email}
            </ItemDescription>
            {/* B3：只读现实如实说明——此前页头承诺"管理登录邮箱"却无修改入口 */}
            <ItemDescription className="text-xs">{t('account.profile.emailNote')}</ItemDescription>
          </ItemContent>
          {user.email_verified && (
            <ItemActions>
              <Badge variant="secondary" className="bg-(--success)/10 text-(--success) border-(--success)/30">
                {t('account.profile.verified')}
              </Badge>
            </ItemActions>
          )}
        </Item>

        {!user.email_verified && (
          <Alert className="mt-2 border-(--warning)/40 bg-(--warning)/15">
            <AlertDescription className="text-(--warning)/90">{t('account.profile.unverified')}</AlertDescription>
            <AlertAction>
              <Button variant="outline" size="sm" onClick={handleResend} disabled={sending}>
                {sending ? (<><Spinner aria-hidden="true" />{t('account.profile.resending')}</>) : t('account.profile.resend')}
              </Button>
            </AlertAction>
          </Alert>
        )}
      </SettingsCard>

      <SettingsCard
        danger title={t('account.profile.deleteTitle')} description={t('account.profile.deleteDesc')}
        cta={
          <Button
            variant="destructive" disabled={deleting}
            onClick={() => setConfirmOpen(true)}
          >
            {t('account.profile.deleteTitle')}
          </Button>
        }
      >
        {null}
      </SettingsCard>

      <ImpactConfirmation
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleDelete}
        title={t('account.profile.deleteConfirmTitle')}
        confirmText={t('account.profile.deleteConfirm')}
        danger
        impacts={[
          t('account.profile.impactData'),
          t('account.profile.impactSessions'),
          t('account.profile.impactProfile'),
        ]}
      />
    </div>
  )
}
