
import { useState } from 'react'
import { useSearchParamsCompat } from '../../router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { SettingsCard } from '../../components/SettingsCard'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui/button'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Spinner } from '../../components/ui/spinner'
import { Badge } from '../../components/ui/badge'
import { StatusBadge } from '../../components/StatusBadge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { useApi } from '@ploykit/hooks'
import { useBilling } from '@ploykit/hooks'
import { useSiteConfig } from '@ploykit/hooks'
import { useWorkspace } from '@ploykit/hooks'
import {
  queryKeys, type PKOrder, type PKPlan, type PKSubscription,
} from '@ploykit/hooks'
import { formatDateTime, cn } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'
import { useT } from '../../i18n'

type Interval = 'monthly' | 'yearly'

// i18n（g6 分片）：标签文案进字典，码表只留 key；渠道/周期/限额取值在组件内经 t() 解析。
const INTERVAL_LABEL_KEY: Record<Interval, string> = {
  monthly: 'workspace.billing.intervalMonthly',
  yearly: 'workspace.billing.intervalYearly',
}
const INTERVAL_UNIT_KEY: Record<Interval, string> = {
  monthly: 'workspace.billing.unitMonthly',
  yearly: 'workspace.billing.unitYearly',
}



const CHANNEL_LABEL_KEY: Record<string, string> = {
  stripe: 'workspace.billing.channelStripe',
  alipay: 'workspace.billing.channelAlipay',
  wechat: 'workspace.billing.channelWechat',
  manual: 'workspace.billing.channelManual',
}


const LIMIT_LABEL_KEY: Record<string, string> = {
  tasks_monthly: 'workspace.billing.limitTasksMonthly',
  workspaces: 'workspace.billing.limitWorkspaces',
  seats: 'workspace.billing.limitSeats',
  webhooks: 'workspace.billing.limitWebhooks',
}

function priceCentsOf(plan: PKPlan, interval: Interval): number {
  const key = interval === 'yearly' ? 'price_yearly_cents' : 'price_monthly_cents'
  return plan.limits[key] ?? 0
}



// 0 元（免费档）不在此处处理：调用点用 t('workspace.billing.freePrice') 显示"Free/免费"。
function fmtCents(cents: number, currency?: string): string {
  if (cents === 0) return ''
  const cur = (currency ?? 'CNY').toUpperCase()
  const symbol = cur === 'CNY' ? '¥' : `${cur} `
  return `${symbol}${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export interface BillingPageProps {

  channel?: string
}

export function BillingPage({ channel = 'stripe' }: BillingPageProps = {}) {
  const t = useT()
  const { current } = useWorkspace()
  const { subscription, plans, loading } = useBilling()
  const api = useApi()
  const confirm = useConfirm()
  const qc = useQueryClient()

  const intervalLabel = (it: Interval): string => t(INTERVAL_LABEL_KEY[it])
  const channelLabel = (code: string): string => {
    const key = CHANNEL_LABEL_KEY[code]
    return key ? t(key) : code
  }


  const [searchParams, setSearchParams] = useSearchParamsCompat()
  const [interval, setInterval] = useState<Interval>(
    searchParams.get('interval') === 'yearly' ? 'yearly' : 'monthly',
  )
  const [payChannelSel, setPayChannelSel] = useState(searchParams.get('channel') ?? channel)
  const [checkoutPlan, setCheckoutPlan] = useState<string | null>(null)

  const [manualNote, setManualNote] = useState<string | null>(null)


  const syncParams = (next: { interval?: Interval; channel?: string }) => {
    const p = new URLSearchParams(searchParams)
    if (next.interval) p.set('interval', next.interval)
    if (next.channel) p.set('channel', next.channel)
    setSearchParams(p, { replace: true })
  }




  const configQ = useSiteConfig()
  const billingChannels = configQ.data?.billing_channels


  const channelOptions = billingChannels !== undefined ? billingChannels : Object.keys(CHANNEL_LABEL_KEY)


  const payChannel =
    billingChannels !== undefined && billingChannels.length > 0 && !billingChannels.includes(payChannelSel)
      ? billingChannels[0]
      : payChannelSel
  const noChannels = billingChannels !== undefined && billingChannels.length === 0

  const wsId = current?.id ?? ''


  const subErrQ = useQuery({
    queryKey: queryKeys.billingSubscription(wsId),
    queryFn: () => api.get<PKSubscription>('/api/billing/subscription'),
    enabled: !!wsId,
  })
  const plansErrQ = useQuery({
    queryKey: queryKeys.billingPlans,
    queryFn: () => api.get<PKPlan[]>('/api/billing/plans'),
  })
  const loadError = subErrQ.isError
    ? subErrQ.error
    : plansErrQ.isError
      ? plansErrQ.error
      : null
  const orders: PKOrder[] = subscription?.orders ?? []
  const currentPlanCode = subscription?.plan_code ?? null
  // UP-8/D4 (docs/plan-upstream-shuijing-admin-billing.md): filter by price-key capability, not code-prefix — a plan with neither price_monthly_cents nor price_yearly_cents (one_time pack) must not render as a ¥0 subscription card.
  const sortedPlans = [...plans]
    .filter((p) => p.limits.price_monthly_cents !== undefined || p.limits.price_yearly_cents !== undefined)
    .sort((a, b) => a.sort_no - b.sort_no)



  const checkoutDescription =
    payChannel === 'manual'
      ? t('workspace.billing.checkoutDescManual')
      : payChannel === 'stripe'
        ? t('workspace.billing.checkoutDescStripe')
        : t('workspace.billing.checkoutDescOther')

  const refreshBilling = () => qc.invalidateQueries({ queryKey: queryKeys.billing })

  const handleCheckout = async (plan: PKPlan) => {
    if (noChannels || (billingChannels !== undefined && billingChannels.length > 0 && !billingChannels.includes(payChannel))) {
      toast.error(t('workspace.billing.channelNotConfigured'))
      return
    }
    setCheckoutPlan(plan.code)
    setManualNote(null)
    try {
      const res = await api.post<{ action_url?: string }>('/api/billing/checkout', {
        plan_code: plan.code, interval, channel: payChannel,
      })
      if (res.action_url) {

        window.location.href = res.action_url
      } else if (payChannel === 'manual') {



        setManualNote(t('workspace.billing.orderCreatedNote', { plan: plan.name }))
        toast.success(t('workspace.billing.orderCreatedToast'))
        await refreshBilling()
      } else {
        toast.error(t('workspace.billing.noRedirect'))
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.billing.checkoutFailed')))
    } finally {
      setCheckoutPlan(null)
    }
  }

  const handleCancel = async (order: PKOrder) => {

    if (!(await confirm({
      title: t('workspace.billing.cancelOrderTitle'),
      description: t('workspace.billing.cancelOrderDesc', {
        plan: order.plan_code,
        interval: intervalLabel(order.interval as Interval) || order.interval,
      }),
      confirmText: t('workspace.billing.cancelOrderTitle'), danger: true,
    }))) return
    try {
      await api.post(`/api/billing/orders/${order.id}/cancel`)
      await refreshBilling()
      toast.success(t('workspace.billing.orderCanceled'))
    } catch (e) {
      toast.error(apiErrorMessage(e, t('workspace.billing.cancelFailed')))
    }
  }

  const orderColumns: Column<PKOrder>[] = [
    { key: 'plan_code', header: t('workspace.billing.colPlan'), render: (o) => <span className="font-medium">{o.plan_code}</span> },
    { key: 'interval', header: t('workspace.billing.colInterval'), render: (o) => intervalLabel(o.interval as Interval) || o.interval },
    { key: 'amount_cents', header: t('workspace.billing.colAmount'), render: (o) => o.amount_cents === 0 ? t('workspace.billing.freePrice') : fmtCents(o.amount_cents, o.currency) },
    { key: 'status', header: t('workspace.billing.colStatus'), render: (o) => <StatusBadge status={o.status} /> },
    { key: 'created_at', header: t('workspace.billing.colCreatedAt'), render: (o) => <span className="text-muted-foreground">{formatDateTime(o.created_at)}</span> },
    {
      key: 'actions', header: t('workspace.billing.colActions'), className: 'text-right',
      render: (o) =>
        o.status === 'pending' ? (
          <Button size="sm" variant="outline" onClick={() => handleCancel(o)}>{t('workspace.billing.cancel')}</Button>
        ) : null,
    },
  ]

  if (!wsId) {
    return (
      <div>
        <PageHeader title={t('workspace.billing.title')} />
        <PageEmpty label={t('workspace.billing.emptyNoWs')} />
      </div>
    )
  }
  if (loading) return <PageLoading label={t('workspace.billing.loading')} />

  if (loadError) {
    return (
      <div>
        <PageHeader title={t('workspace.billing.title')} />
        <PageError
          message={apiErrorMessage(loadError, t('workspace.billing.loadFailed'))}
          onRetry={() => {
            void subErrQ.refetch()
            void plansErrQ.refetch()
          }}
        />
      </div>
    )
  }

  return (
    <div>
      <PageHeader title={t('workspace.billing.title')} />

      {/* 当前套餐 */}
      <SettingsCard
        title={t('workspace.billing.currentPlanCard')}
        cta={<Badge variant="outline">{currentPlanCode ?? t('workspace.billing.unknownPlan')}</Badge>}
      >
        <p className="text-sm text-muted-foreground">
          {t('workspace.billing.summaryPlanPrefix')}<span className="font-medium text-foreground">{currentPlanCode ?? '—'}</span>
          {t('workspace.billing.summaryOrders', { total: orders.length, pending: orders.filter((o) => o.status === 'pending').length })}
        </p>
      </SettingsCard>

      {/* 套餐选择 */}
      <SettingsCard title={t('workspace.billing.choosePlan')} description={checkoutDescription}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/* interval 切换 pill（formbricks 版式） */}
          <div className="w-fit rounded-xl border bg-muted p-1" role="group" aria-label={t('workspace.billing.billingCycleAria')}>
            {(['monthly', 'yearly'] as Interval[]).map((it) => (
              <button
                key={it}
                type="button"
                onClick={() => { setInterval(it); syncParams({ interval: it }) }}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  interval === it
                    ? 'bg-primary text-primary-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {intervalLabel(it)}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Select value={payChannel} onValueChange={(v) => {
              if (typeof v === 'string') { setPayChannelSel(v); syncParams({ channel: v }) }
            }}>
              <SelectTrigger size="sm" className="w-44" aria-label={t('workspace.billing.channelAria')}>
                <SelectValue>{channelLabel(payChannel)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {channelOptions.map((code) => (
                  <SelectItem key={code} value={code}>{channelLabel(code)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* B1/G4：manual 空 InfoURL 的线下支付指引（下单成功但无收银台时持续可见） */}
        {manualNote && (
          <Alert className="mb-4 border-(--warning)/40 bg-(--warning)/15">
            <AlertDescription className="text-(--warning)/90">{manualNote}</AlertDescription>
          </Alert>
        )}

        {sortedPlans.length === 0 && (
          <PageEmpty label={t('workspace.billing.noPlans')} hint={t('workspace.billing.noPlansHint')} />
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {sortedPlans.map((plan) => {
            const isCurrent = plan.code === currentPlanCode
            const price = priceCentsOf(plan, interval)
            const features = Object.entries(plan.limits)
              .filter(([k]) => !k.startsWith('price_') && k !== 'trial_days')
              .map(([k, v]) => t('workspace.billing.featureLine', {
                label: LIMIT_LABEL_KEY[k] ? t(LIMIT_LABEL_KEY[k]) : k,
                value: v < 0 ? t('workspace.billing.unlimited') : v,
              }))
            return (
              <div
                key={plan.code}
                className={cn(
                  'flex flex-col rounded-xl border bg-card p-5 shadow-xs',
                  isCurrent && 'border-primary/40',
                )}
              >
                <div className="flex items-center justify-between">
                  <p className="font-semibold">{plan.name}</p>
                  {isCurrent && <Badge>{t('workspace.billing.currentPlanBadge')}</Badge>}
                </div>
                <p className="mt-3 text-3xl font-bold tabular-nums">
                  {price === 0 ? t('workspace.billing.freePrice') : fmtCents(price, plan.currency)}
                  {price > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {` / ${t(INTERVAL_UNIT_KEY[interval])}`}
                    </span>
                  )}
                </p>
                <Button
                  className="mt-4 w-full"
                  variant={isCurrent ? 'secondary' : 'default'}
                  disabled={isCurrent || checkoutPlan !== null || noChannels}
                  onClick={() => handleCheckout(plan)}
                >
                  {isCurrent
                    ? t('workspace.billing.currentPlanBadge')
                    : checkoutPlan === plan.code
                      ? (
                        <span className="inline-flex items-center gap-1.5">
                          <Spinner className="size-3.5" aria-hidden="true" />
                          {t('workspace.billing.redirecting')}
                        </span>
                      )
                      : t('workspace.billing.upgrade')}
                </Button>
                {/* F8：升级不可用原因可见化（不只 title 悬停）。B1/G4：动态渠道表下
                    仅剩"站点零渠道"一种不可用场景，文案如实、不再自相矛盾。 */}
                {!isCurrent && noChannels && (
                  <p className="mt-2 text-xs text-muted-foreground" role="note">
                    {t('workspace.billing.upgradeUnavailable')}
                  </p>
                )}
                {features.length > 0 && (
                  <ul className="mt-6 space-y-3 border-t pt-6 text-sm text-muted-foreground">
                    {features.map((f) => (
                      <li key={f} className="flex items-center gap-2">
                        <span className="text-primary">✓</span> {f}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </SettingsCard>

      {/* 订单 */}
      <SettingsCard title={t('workspace.billing.ordersTitle')} bodyClassName="px-4 pt-4 pb-4">
        <DataTable
          columns={orderColumns}
          rows={orders}
          rowKey={(o) => o.id}
          empty={<PageEmpty label={t('workspace.billing.noOrders')} hint={t('workspace.billing.noOrdersHint')} />}
        />
      </SettingsCard>
    </div>
  )
}
