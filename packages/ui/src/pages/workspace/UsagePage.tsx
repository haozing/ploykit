
import { Link } from 'react-router'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { Badge } from '../../components/ui/Badge'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '../../components/ui/card'
import {
  Progress, ProgressLabel, ProgressValue,
} from '../../components/ui/progress'
import { DataTable, type Column } from '../../components/DataTable'
import { useUsage, type PKUsageItem } from '@ploykit/hooks'
import { apiErrorMessage } from '../../lib/api-error'


const NEAR_FULL_PCT = 80


const DIM_LABEL: Record<string, string> = {
  tasks_monthly: '任务数（本月）',
  workspaces: '工作区数',
  seats: '成员席位',
  webhooks: 'Webhook 订阅数',
}

function dimLabel(key: string): string {
  return DIM_LABEL[key] ?? key
}


function fmtNum(n: number): string {
  return n.toLocaleString('zh-CN')
}


interface ReservationDetail {
  id: string
  amount: number
  status: string
  expires_at: string
}


export type UsageItem = PKUsageItem & { reserved?: number; reservations?: ReservationDetail[] }


const RESERVATION_STATUS_LABEL: Record<string, string> = {
  reserved: '预留中',
  settled: '已结算',
  released: '已释放',
  expired: '已过期',
}

function reservationStatusLabel(status: string): string {
  return RESERVATION_STATUS_LABEL[status] ?? status
}


function formatExpires(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}


function SegmentedProgress({ item, reserved, total }: { item: UsageItem; reserved: number; total: number }) {
  const base = Math.max(total, 1)
  const usedPct = Math.min(100, Math.round(((item.used + item.granted) / base) * 100))
  const reservedPct = Math.min(100 - usedPct, Math.round((reserved / base) * 100))
  const now = item.used + item.granted + reserved
  return (
    <div
      data-slot="progress"
      role="progressbar"
      
      
      
      aria-label={`${dimLabel(item.key)} 用量`}
      aria-valuemin={0}
      aria-valuemax={Math.max(total, now)}
      aria-valuenow={now}
      aria-valuetext={`已用 ${fmtNum(item.used)}${item.granted > 0 ? `（另获赠 ${fmtNum(item.granted)}）` : ''}，预留中 ${fmtNum(reserved)}，上限 ${fmtNum(total)}`}
      className="flex flex-wrap gap-3"
    >
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div data-testid="progress-indicator-used" data-slot="progress-indicator-used" className="absolute inset-y-0 left-0 bg-primary transition-all" style={{ width: `${usedPct}%` }} />
        <div data-testid="progress-indicator-reserved" data-slot="progress-indicator-reserved" className="absolute inset-y-0 bg-primary/40 transition-all" style={{ width: `${reservedPct}%`, left: `${usedPct}%` }} />
      </div>
    </div>
  )
}


const RESERVATION_COLUMNS: Column<ReservationDetail>[] = [
  { key: 'amount', header: '数量' },
  { key: 'status', header: '状态', render: (r) => reservationStatusLabel(r.status) },
  { key: 'expires_at', header: '到期时间', render: (r) => formatExpires(r.expires_at) },
]

function UsageCard({ item }: { item: UsageItem }) {
  const unlimited = item.limit < 0
  
  const reserved = item.reserved ?? 0
  const hasReserved = reserved > 0
  const total = unlimited ? Math.max(item.used + reserved, 1) : item.limit
  const pct = unlimited
    ? Math.min(100, Math.round(((item.used + reserved) / Math.max(total, 10)) * 100))
    : Math.min(100, Math.round(((item.used + item.granted + reserved) / Math.max(total, 1)) * 100))
  
  const committed = item.used + item.granted + reserved
  const full = !unlimited && committed >= item.limit
  const nearFull = !unlimited && !full && pct >= NEAR_FULL_PCT

  const valueText = `${fmtNum(item.used)}${item.granted > 0 ? ` (+${fmtNum(item.granted)})` : ''} / ${unlimited ? '∞' : fmtNum(total)}`

  return (
    <Card size="sm">
      <CardHeader>
        {/* B2：卡题中文标签，原始 API 键（tasks_monthly 等）仅留 title 悬停辅助，不再入正文。 */}
        <CardTitle title={DIM_LABEL[item.key] ? item.key : undefined}>{dimLabel(item.key)}</CardTitle>
        {unlimited && <CardAction><Badge variant="secondary">不限量</Badge></CardAction>}
        {!unlimited && full && <CardAction><Badge variant="destructive">已用尽</Badge></CardAction>}
      </CardHeader>
      <CardContent>
        {hasReserved ? (
          <>
            <SegmentedProgress item={item} reserved={reserved} total={total} />
            <p className="mt-1.5 text-sm text-muted-foreground">
              已用 <span className="font-medium text-foreground tabular-nums">{fmtNum(item.used)}{item.granted > 0 ? ` (+${fmtNum(item.granted)})` : ''}</span>
              {' · 预留中 '}<span className="font-medium text-foreground tabular-nums">{fmtNum(reserved)}</span>
              {` / ${unlimited ? '∞' : fmtNum(total)}`}
            </p>
          </>
        ) : (
          <Progress value={pct}>
            <ProgressLabel>{dimLabel(item.key)}</ProgressLabel>
            <ProgressValue>{() => valueText}</ProgressValue>
          </Progress>
        )}
        {!unlimited && (full || nearFull) && (
          <p className="mt-2 text-xs text-muted-foreground">
            {/* G5 后文案：不写"超额操作将被拒绝"的硬承诺（账号级维度的硬闸在
                装配方策略，工作区桶维度才是 402 直拒），统一引导升级。 */}
            {full ? `该维度配额已用尽${hasReserved ? '（含预留中）' : ''}，可升级套餐提高上限。` : '该维度配额即将用尽。'}
            <Link
              to="/settings/workspace/billing"
              className="ml-1 inline-flex items-center py-1.5 -my-1.5 text-primary underline-offset-2 hover:underline"
            >
              升级套餐
            </Link>
          </p>
        )}
        {hasReserved && (item.reservations?.length ?? 0) > 0 && (
          <details className="mt-3 group" data-testid="reservation-details">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              预留明细（{item.reservations!.length} 笔）
            </summary>
            <div className="mt-2">
              <DataTable
                columns={RESERVATION_COLUMNS}
                rows={item.reservations!}
                rowKey={(r) => r.id}
              />
            </div>
          </details>
        )}
      </CardContent>
    </Card>
  )
}

export interface UsagePageProps {}

export function UsagePage(_props: UsagePageProps = {}) {
  const { wsId, usage, loading, error, refetch } = useUsage()

  if (!wsId) {
    return (
      <div>
        <PageHeader title="用量" />
        <PageEmpty label="请先创建并选择一个工作区" />
      </div>
    )
  }
  if (loading) return <PageLoading label="加载用量数据…" />
  if (error) {
    return <PageError message={apiErrorMessage(error, '用量数据加载失败')} onRetry={() => refetch()} />
  }

  return (
    <div>
      <PageHeader
        title="用量"
        description={
          usage
            ? `当前套餐 ${usage.plan_code} · 计费周期 ${usage.period}（周期内累计，超限将按套餐规则限制或计费）`
            : undefined
        }
      />
      {usage && usage.items.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {usage.items.map((item) => (
            <UsageCard key={item.key} item={item} />
          ))}
        </div>
      ) : (
        <PageEmpty label="当前套餐没有计量维度" />
      )}
    </div>
  )
}
