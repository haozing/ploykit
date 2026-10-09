
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { DataTable, type Column } from '../../components/DataTable'
import { SettingsCard } from '../../components/SettingsCard'
import { useConfirm } from '../../components/ConfirmDialog'
import { toast } from '../../components/toast'
import { Button } from '../../components/ui/Button'
import { Badge, StatusBadge } from '../../components/ui/Badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { useApi } from '../../hooks/useApi'
import { useBilling } from '../../hooks/useBilling'
import { useSiteConfig } from '../../hooks/useSiteConfig'
import { useWorkspace } from '../../hooks/useWorkspace'
import {
  queryKeys, type PKOrder, type PKPlan, type PKSubscription,
} from '../../provider/PloykitProvider'
import { formatDateTime, cn } from '../../lib/utils'
import { apiErrorMessage } from '../../lib/api-error'

type Interval = 'monthly' | 'yearly'

const INTERVAL_LABEL: Record<Interval, string> = { monthly: '按月', yearly: '按年' }
const INTERVAL_UNIT: Record<Interval, string> = { monthly: '月', yearly: '年' }



const CHANNEL_LABEL: Record<string, string> = {
  stripe: 'Stripe（银行卡）',
  alipay: '支付宝',
  wechat: '微信支付',
  manual: '线下转账（管理员核销）',
}
const channelLabel = (code: string): string => CHANNEL_LABEL[code] ?? code


const LIMIT_LABEL: Record<string, string> = {
  tasks_monthly: '任务数 / 周期',
  workspaces: '工作区数',
  seats: '成员席位',
  webhooks: 'Webhook 订阅',
}

function priceCentsOf(plan: PKPlan, interval: Interval): number {
  const key = interval === 'yearly' ? 'price_yearly_cents' : 'price_monthly_cents'
  return plan.limits[key] ?? 0
}


function fmtCents(cents: number, currency?: string): string {
  if (cents === 0) return '免费'
  const cur = (currency ?? 'CNY').toUpperCase()
  const symbol = cur === 'CNY' ? '¥' : `${cur} `
  return `${symbol}${(cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export interface BillingPageProps {
  
  channel?: string
}

export function BillingPage({ channel = 'stripe' }: BillingPageProps = {}) {
  const { current } = useWorkspace()
  const { subscription, plans, loading } = useBilling()
  const api = useApi()
  const confirm = useConfirm()
  const qc = useQueryClient()

  
  const [searchParams, setSearchParams] = useSearchParams()
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
  
  
  const channelOptions = billingChannels !== undefined ? billingChannels : Object.keys(CHANNEL_LABEL)
  
  
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
  const sortedPlans = [...plans].sort((a, b) => a.sort_no - b.sort_no)

  
  
  const checkoutDescription =
    payChannel === 'manual'
      ? '升级立即生效；下单后请联系管理员完成线下转账，订单在管理员核销后生效。'
      : payChannel === 'stripe'
        ? '升级立即生效；Stripe 结账完成后自动跳回。'
        : '升级立即生效；在所选渠道的收银台完成支付后自动生效。'

  const refreshBilling = () => qc.invalidateQueries({ queryKey: queryKeys.billing })

  const handleCheckout = async (plan: PKPlan) => {
    if (noChannels || (billingChannels !== undefined && billingChannels.length > 0 && !billingChannels.includes(payChannel))) {
      toast.error('该支付渠道未配置')
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
        
        
        
        setManualNote(`已创建 ${plan.name} 订单（待处理）：下单后请联系管理员完成支付，订单在管理员核销后生效。`)
        toast.success('订单已创建，请联系管理员完成支付')
        await refreshBilling()
      } else {
        toast.error('支付渠道未返回跳转地址')
      }
    } catch (e) {
      toast.error(apiErrorMessage(e, '发起结账失败'))
    } finally {
      setCheckoutPlan(null)
    }
  }

  const handleCancel = async (order: PKOrder) => {
    
    if (!(await confirm({
      title: '取消订单',
      description: `取消 ${order.plan_code}（${INTERVAL_LABEL[order.interval as Interval] ?? order.interval}）的待处理订单？`,
      confirmText: '取消订单', danger: true,
    }))) return
    try {
      await api.post(`/api/billing/orders/${order.id}/cancel`)
      await refreshBilling()
      toast.success('订单已取消')
    } catch (e) {
      toast.error(apiErrorMessage(e, '取消失败'))
    }
  }

  const orderColumns: Column<PKOrder>[] = [
    { key: 'plan_code', header: '套餐', render: (o) => <span className="font-medium">{o.plan_code}</span> },
    { key: 'interval', header: '周期', render: (o) => INTERVAL_LABEL[o.interval as Interval] ?? o.interval },
    { key: 'amount_cents', header: '金额', render: (o) => fmtCents(o.amount_cents, o.currency) },
    { key: 'status', header: '状态', render: (o) => <StatusBadge status={o.status} /> },
    { key: 'created_at', header: '创建时间', render: (o) => <span className="text-muted-foreground">{formatDateTime(o.created_at)}</span> },
    {
      key: 'actions', header: '操作', className: 'text-right',
      render: (o) =>
        o.status === 'pending' ? (
          <Button size="sm" variant="outline" onClick={() => handleCancel(o)}>取消</Button>
        ) : null,
    },
  ]

  if (!wsId) {
    return (
      <div>
        <PageHeader title="计费" />
        <PageEmpty label="请先创建并选择一个工作区" />
      </div>
    )
  }
  if (loading) return <PageLoading label="加载计费信息…" />
  
  if (loadError) {
    return (
      <div>
        <PageHeader title="计费" />
        <PageError
          message={apiErrorMessage(loadError, '计费信息加载失败')}
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
      <PageHeader title="计费" description="当前套餐、升级与订单管理（按周期购买，到期后需再次购买或续期）" />

      {/* 当前套餐 */}
      <SettingsCard
        title="当前套餐"
        description="工作区当前生效的套餐与历史订单。"
        cta={<Badge variant="outline">{currentPlanCode ?? '未知'}</Badge>}
      >
        <p className="text-sm text-muted-foreground">
          套餐 <span className="font-medium text-foreground">{currentPlanCode ?? '—'}</span>
          ，共 {orders.length} 笔订单（待处理 {orders.filter((o) => o.status === 'pending').length} 笔）。
        </p>
      </SettingsCard>

      {/* 套餐选择 */}
      <SettingsCard title="选择套餐" description={checkoutDescription}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/* interval 切换 pill（formbricks 版式） */}
          <div className="w-fit rounded-xl border bg-muted p-1" role="group" aria-label="计费周期">
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
                {INTERVAL_LABEL[it]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Select value={payChannel} onValueChange={(v) => {
              if (typeof v === 'string') { setPayChannelSel(v); syncParams({ channel: v }) }
            }}>
              <SelectTrigger size="sm" className="w-44" aria-label="支付渠道">
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
          <p
            role="note"
            className="mb-4 rounded-lg border-(--warning)/40 bg-(--warning)/15 px-3 py-2 text-sm text-(--warning)"
          >
            {manualNote}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          {sortedPlans.map((plan) => {
            const isCurrent = plan.code === currentPlanCode
            const price = priceCentsOf(plan, interval)
            const features = Object.entries(plan.limits)
              .filter(([k]) => !k.startsWith('price_') && k !== 'trial_days')
              .map(([k, v]) => `${LIMIT_LABEL[k] ?? k}：${v < 0 ? '不限' : v}`)
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
                  {isCurrent && <Badge>当前计划</Badge>}
                </div>
                <p className="mt-3 text-3xl font-bold tabular-nums">
                  {fmtCents(price)}
                  {price > 0 && (
                    <span className="text-sm font-normal text-muted-foreground">
                      {` / ${INTERVAL_UNIT[interval]}`}
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
                    ? '当前计划'
                    : checkoutPlan === plan.code
                      ? '跳转收银台…'
                      : '升级'}
                </Button>
                {/* F8：升级不可用原因可见化（不只 title 悬停）。B1/G4：动态渠道表下
                    仅剩"站点零渠道"一种不可用场景，文案如实、不再自相矛盾。 */}
                {!isCurrent && noChannels && (
                  <p className="mt-2 text-xs text-muted-foreground" role="note">
                    暂不可升级：站点未配置任何支付渠道，请联系管理员。
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
      <SettingsCard title="订单" description="全部购买记录；待处理订单可取消。" bodyClassName="px-4 pt-4 pb-4">
        <DataTable
          columns={orderColumns}
          rows={orders}
          rowKey={(o) => o.id}
          empty={<PageEmpty label="暂无订单" hint="选择套餐完成首次购买后，订单会出现在这里" />}
        />
      </SettingsCard>
    </div>
  )
}
