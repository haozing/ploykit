
import { useId } from 'react'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { Switch } from '../../components/ui/switch'
import { toast } from '../../components/toast'
import { useSEO } from '../../hooks/useSEO'
import {
  useNotificationPrefs, useSetNotificationPref, type NotificationPreference,
} from '../../hooks/useNotificationPrefs'

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
  title = '通知偏好',
  description = '选择每种通知的接收渠道；未显示的类型默认全部开启',
  siteName,
  emailChannelNote,
}: NotificationPreferencesPageProps) {
  const { prefs, loading, error, refetch } = useNotificationPrefs()
  const { setPref } = useSetNotificationPref()
  
  
  const uid = useId()
  
  
  
  useSEO({ title: siteName ? `${title} · ${siteName}` : title })

  if (loading) return <div><PageHeader title={title} description={description} /><PageLoading /></div>
  if (error) {
    return (
      <div>
        <PageHeader title={title} description={description} />
        <PageError message={error instanceof Error ? error.message : '偏好加载失败'} onRetry={() => refetch()} />
      </div>
    )
  }

  
  const byType = new Map(prefs.map((p: NotificationPreference) => [p.notification_type, p]))
  const list: NotificationTypeMeta[] =
    types ?? prefs.map((p: NotificationPreference) => ({ type: p.notification_type, label: p.notification_type }))

  if (list.length === 0) {
    return (
      <div>
        <PageHeader title={title} description={description} />
        <PageEmpty
          label="暂无可配置的通知类型"
          hint="通知类型目录由服务端下发：首次产生通知设置（或后端接入类型目录接口）后，会出现在这里；默认所有通知双渠道开启。"
        />
      </div>
    )
  }

  const toggle = async (type: string, channel: 'email_enabled' | 'in_app_enabled', next: boolean) => {
    try {
      await setPref(type, { [channel]: next })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '保存失败') 
    }
  }

  return (
    <div>
      <PageHeader title={title} description={description} />

      <div className="w-full max-w-4xl space-y-4">
        {/* B2 诚实化：邮件未接线时产品传入的能力说明（单行渲染一次，不随行重复——
            390 窄屏行内追加会挤压开关组造成溢出） */}
        {emailChannelNote && (
          <p className="text-sm text-muted-foreground">邮件渠道：{emailChannelNote}</p>
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
                    站内<span className="sr-only">（{label}）</span>
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
                    邮件<span className="sr-only">（{label}）</span>
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
