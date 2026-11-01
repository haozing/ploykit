
import { Link } from '../../router'
import { PageHeader, PageLoading, PageError, PageEmpty } from '../../components/Page'
import { Badge } from '../../components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '../../components/ui/tooltip'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '../../components/ui/card'
import {
  Progress, ProgressLabel, ProgressValue,
} from '../../components/ui/progress'
import { DataTable, type Column } from '../../components/DataTable'
import { useUsage, type PKUsageItem } from '@ploykit/hooks'
import { apiErrorMessage } from '../../lib/api-error'
import { DIM_LABEL, dimLabel } from '../../lib/utils'
import { useT } from '../../i18n'


const NEAR_FULL_PCT = 80


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


// i18n（g6 分片）：预留状态标签进字典，状态码 → key。
const RESERVATION_STATUS_LABEL_KEY: Record<string, string> = {
  reserved: 'workspace.usage.statusReserved',
  settled: 'workspace.usage.statusSettled',
  released: 'workspace.usage.statusReleased',
  expired: 'workspace.usage.statusExpired',
}


function formatExpires(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}


function SegmentedProgress({ item, reserved, total }: { item: UsageItem; reserved: number; total: number }) {
  const t = useT()
  const base = Math.max(total, 1)
  const usedPct = Math.min(100, Math.round(((item.used + item.granted) / base) * 100))
  const reservedPct = Math.min(100 - usedPct, Math.round((reserved / base) * 100))
  const now = item.used + item.granted + reserved
  return (
    <div
      data-slot="progress"
      role="progressbar"



      aria-label={t('workspace.usage.ariaLabel', { dim: dimLabel(item.key) })}
      aria-valuemin={0}
      aria-valuemax={Math.max(total, now)}
      aria-valuenow={now}
      aria-valuetext={t('workspace.usage.ariaValueText', {
        used: fmtNum(item.used),
        granted: item.granted > 0 ? t('workspace.usage.grantedPart', { n: fmtNum(item.granted) }) : '',
        reserved: fmtNum(reserved),
        limit: fmtNum(total),
      })}
      className="flex flex-wrap gap-3"
    >
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div data-testid="progress-indicator-used" data-slot="progress-indicator-used" className="absolute inset-y-0 left-0 bg-primary transition-all" style={{ width: `${usedPct}%` }} />
        <div data-testid="progress-indicator-reserved" data-slot="progress-indicator-reserved" className="absolute inset-y-0 bg-primary/40 transition-all" style={{ width: `${reservedPct}%`, left: `${usedPct}%` }} />
      </div>
    </div>
  )
}


// 预留明细表列定义移入 UsageCard（g6 i18n：header/状态文案需随语言解析）。
function UsageCard({ item }: { item: UsageItem }) {
  const t = useT()
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

  const reservationColumns: Column<ReservationDetail>[] = [
    { key: 'amount', header: t('workspace.usage.colAmount') },
    {
      key: 'status', header: t('workspace.usage.colStatus'),
      render: (r) => {
        const key = RESERVATION_STATUS_LABEL_KEY[r.status]
        return key ? t(key) : r.status
      },
    },
    { key: 'expires_at', header: t('workspace.usage.colExpiresAt'), render: (r) => formatExpires(r.expires_at) },
  ]

  return (
    <Card size="sm">
      <CardHeader>
        {/* B2：卡题中文标签，原始 API 键（tasks_monthly 等）经 Tooltip 悬停/聚焦查看，
            收起时 portal 不挂载、不进正文。CardTitle 是普通 div（无 render 通道），
            故 Tooltip 套在外层、Trigger render 成 span 包住标题文本；tabIndex 保键盘可达。 */}
        <CardTitle>
          {DIM_LABEL[item.key] ? (
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} className="cursor-help" />}>
                {dimLabel(item.key)}
              </TooltipTrigger>
              <TooltipContent>{item.key}</TooltipContent>
            </Tooltip>
          ) : (
            dimLabel(item.key)
          )}
        </CardTitle>
        {unlimited && <CardAction><Badge variant="secondary">{t('workspace.usage.unlimitedBadge')}</Badge></CardAction>}
        {!unlimited && full && <CardAction><Badge variant="destructive">{t('workspace.usage.exhaustedBadge')}</Badge></CardAction>}
      </CardHeader>
      <CardContent>
        {hasReserved ? (
          <>
            <SegmentedProgress item={item} reserved={reserved} total={total} />
            <p className="mt-1.5 text-sm text-muted-foreground">
              {t('workspace.usage.usedLabel')} <span className="font-medium text-foreground tabular-nums">{fmtNum(item.used)}{item.granted > 0 ? ` (+${fmtNum(item.granted)})` : ''}</span>
              {' · '}{t('workspace.usage.reservedLabel')} <span className="font-medium text-foreground tabular-nums">{fmtNum(reserved)}</span>
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
            {full
              ? t('workspace.usage.quotaExhausted', {
                note: hasReserved ? t('workspace.usage.inclReserved') : '',
              })
              : t('workspace.usage.quotaNearFull')}
            <Link
              to="/settings/workspace/billing"
              className="ml-1 inline-flex items-center py-1.5 -my-1.5 text-primary underline-offset-2 hover:underline"
            >
              {t('workspace.usage.upgradePlan')}
            </Link>
          </p>
        )}
        {hasReserved && (item.reservations?.length ?? 0) > 0 && (
          <details className="mt-3 group" data-testid="reservation-details">
            <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
              {t('workspace.usage.reservedDetails', { count: item.reservations!.length })}
            </summary>
            <div className="mt-2">
              <DataTable
                columns={reservationColumns}
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
  const t = useT()
  const { wsId, usage, loading, error, refetch } = useUsage()

  if (!wsId) {
    return (
      <div>
        <PageHeader title={t('workspace.usage.title')} />
        <PageEmpty label={t('workspace.usage.emptyNoWs')} />
      </div>
    )
  }
  if (loading) return <PageLoading label={t('workspace.usage.loading')} />
  if (error) {
    return <PageError message={apiErrorMessage(error, t('workspace.usage.loadFailed'))} onRetry={() => refetch()} />
  }

  return (
    <div>
      <PageHeader
        title={t('workspace.usage.title')}
        description={
          usage
            ? t('workspace.usage.headerDesc', { plan: usage.plan_code, period: usage.period })
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
        <PageEmpty label={t('workspace.usage.noDimensions')} />
      )}
    </div>
  )
}
