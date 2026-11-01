
import { useId } from 'react'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Switch } from '../../components/ui/switch'
import { toast } from '../../components/toast'
import { useSEO } from '@ploykit/hooks'
import {
  useNotificationPrefs, useSetNotificationPref, type NotificationPreference,
} from '@ploykit/hooks'
import { useT } from '../../i18n'

export interface NotificationTypeMeta {
  type: string
  label: string
  description?: string
}

export interface NotificationPreferencesPageProps {
  
  types?: NotificationTypeMeta[]
  title?: string
  description?: string
  
  siteName?: string
  
  emailChannelNote?: string
}

export function NotificationPreferencesPage({
  types,
  title,
  description,
  siteName,
  emailChannelNote,
}: NotificationPreferencesPageProps) {
  const { prefs, loading, error, refetch } = useNotificationPrefs()
  const { setPref } = useSetNotificationPref()
  const t = useT() // i18n（B 方案）：默认标题/说明走字典，title/description prop 优先
  const pageTitle = title ?? t('account.notifications.title')
  const pageDesc = description ?? t('account.notifications.desc')


  const uid = useId()



  useSEO({ title: siteName ? `${pageTitle} · ${siteName}` : pageTitle })

  if (loading) return <div><PageHeader title={pageTitle} description={pageDesc} /><PageLoading /></div>
  if (error) {
    return (
      <div>
        <PageHeader title={pageTitle} description={pageDesc} />
        <PageError message={error instanceof Error ? error.message : t('account.notifications.loadFailed')} onRetry={() => refetch()} />
      </div>
    )
  }


  const byType = new Map(prefs.map((p: NotificationPreference) => [p.notification_type, p]))
  const list: NotificationTypeMeta[] =
    types ?? prefs.map((p: NotificationPreference) => ({ type: p.notification_type, label: p.notification_type }))

  if (list.length === 0) {
    return (
      <div>
        <PageHeader title={pageTitle} description={pageDesc} />
        <PageEmpty
          label={t('account.notifications.empty')}
          hint={t('account.notifications.emptyHint')}
        />
      </div>
    )
  }

  const toggle = async (type: string, channel: 'email_enabled' | 'in_app_enabled', next: boolean) => {
    try {
      await setPref(type, { [channel]: next })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('account.notifications.saveFailed'))
    }
  }

  return (
    <div>
      <PageHeader title={pageTitle} description={pageDesc} />

      <div className="w-full space-y-4">
        {/* B2 诚实化：邮件未接线时产品传入的能力说明（单行渲染一次，不随行重复——
            390 窄屏行内追加会挤压开关组造成溢出） */}
        {emailChannelNote && (
          <Alert>
            <AlertDescription>{t('account.notifications.emailChannel', { note: emailChannelNote })}</AlertDescription>
          </Alert>
        )}
        {list.map(({ type, label, description: desc }) => {
          const row = byType.get(type)
          const inApp = row?.in_app_enabled ?? true
          const email = row?.email_enabled ?? true




          const inAppInputId = `${uid}-${type}-in-app`
          const emailInputId = `${uid}-${type}-email`
          const inAppLabelId = `${inAppInputId}-label`
          const emailLabelId = `${emailInputId}-label`
          return (
            <div key={type} className="flex flex-row items-center justify-between gap-4 rounded-lg border p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{label}</p>
                {desc && <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-5">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <label id={inAppLabelId} htmlFor={inAppInputId} className="cursor-pointer select-none">
                    {t('account.notifications.inApp')}<span className="sr-only">{t('account.notifications.channelSrOnly', { label })}</span>
                  </label>
                  <Switch
                    id={inAppInputId}
                    aria-labelledby={inAppLabelId}
                    checked={inApp}
                    onCheckedChange={(v) => toggle(type, 'in_app_enabled', v)}
                  />
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <label id={emailLabelId} htmlFor={emailInputId} className="cursor-pointer select-none">
                    {t('account.notifications.email')}<span className="sr-only">{t('account.notifications.channelSrOnly', { label })}</span>
                  </label>
                  <Switch
                    id={emailInputId}
                    aria-labelledby={emailLabelId}
                    checked={email}
                    onCheckedChange={(v) => toggle(type, 'email_enabled', v)}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
