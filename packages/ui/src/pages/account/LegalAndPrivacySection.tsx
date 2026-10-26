
import { useConfirm } from '../../components/ConfirmDialog'
import { SettingsCard } from '../../components/SettingsCard'
import { StatusBadge } from '../../components/StatusBadge'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from '../../components/ui/item'
import { Spinner } from '../../components/ui/spinner'
import { formatDate } from '../../lib/utils'

/**
 * LegalAndPrivacySection —— 账号设置页的可选"法务与隐私"区块
 * （docs/plan-legal-compliance-framework-2026-10-25.md §6 LC-4 / §9；审计 L2/L8）。
 *
 * 两条自助入口：
 * - **数据导出**（LC-5 DSAR）：`onExportData` 由产品侧接线（下载/跳转皆可）；
 * - **订阅取消**（LC-4 CA ARL"取消同介质同难度"）：确认弹窗按渠道
 *   `ChannelCaps.CancelTiming` 如实分流承诺口径——immediate/period_end/未知三支，
 *   未知支（渠道未实现直通取消、请求进运营队列）**绝不假称自助停扣**，
 *   只承诺"已受理，人工在渠道后台完成"。
 *
 * 纯展示 + 回调组件：**不 fetch**。订阅快照、busy、error（含取消结果 outcome，
 * 如 operator_pending 的如实告知）全部由调用方喂入——与 SignInForm
 * "可选 props 缺省即不渲染"同一哲学：不传订阅 props 不渲染取消区、不传
 * onExportData 不渲染导出按钮、零可见内容（无订阅且无导出入口）时整块
 * 返回 null，产品账号页零成本嵌入。
 *
 * 确认弹窗复用全局 ConfirmProvider（useConfirm / ConfirmDialogBody 懒加载资产），
 * 需宿主挂 ConfirmProvider——AppProviders 默认已含。
 */

/** 订阅现状快照（产品侧从 useBilling()/自有状态喂入；组件不自取） */
export interface LegalAndPrivacySubscription {
  /** 当前套餐码/名（展示用） */
  plan: string
  /** 下次续费时间（ISO）；period_end 取消文案的"保留至"即它 */
  renewsAt?: string
  /** 渠道取消时序（ChannelCaps.CancelTiming 透传），决定确认弹窗的承诺口径 */
  cancelTiming?: 'immediate' | 'period_end' | ''
  /** 已提交过取消请求的时间（ISO）：按钮转"取消已受理"禁用态 */
  cancelRequestedAt?: string
}

export interface LegalAndPrivacySectionProps {
  subscription?: LegalAndPrivacySubscription
  /** DSAR 导出入口：点击即回调；组件不发起请求 */
  onExportData?: () => void
  /** 取消订阅入口：确认弹窗通过后回调；请求与结果呈现由调用方负责 */
  onCancelSubscription?: () => void
  /** 调用方请求进行中：禁用全部动作按钮 */
  busy?: boolean
  /** 调用方呈现的失败/结果文案（如取消已进运营队列的如实告知） */
  error?: string | null
}

// 确认弹窗文案三分流（LC-4）：口径与 Caps 时序一一对应，逗号分隔的短句
// 是对外承诺文案——改动前先对齐计划 §6 LC-4 的裁定。
function cancelTimingCopy(sub: LegalAndPrivacySubscription): string {
  if (sub.cancelTiming === 'immediate') return '立即取消,权益马上结束'
  if (sub.cancelTiming === 'period_end') {
    return sub.renewsAt
      ? `取消生效,权益保留至 ${formatDate(sub.renewsAt)}`
      : '取消生效,权益保留至本期结束'
  }
  return '已受理,我们将完成取消'
}

export function LegalAndPrivacySection({
  subscription,
  onExportData,
  onCancelSubscription,
  busy = false,
  error = null,
}: LegalAndPrivacySectionProps) {
  const confirm = useConfirm()

  // 零可见复杂度裁定（§9）：无订阅快照也无导出入口时整块不渲染。
  // busy/error 是动作的伴生状态，无动作即无可呈现内容。
  if (!subscription && !onExportData) return null

  const cancelRequested = Boolean(subscription?.cancelRequestedAt)

  const handleCancelClick = () => {
    if (!subscription) return
    void confirm({
      title: '取消订阅',
      description: cancelTimingCopy(subscription),
      confirmText: '确认取消',
      danger: true,
    }).then((ok) => {
      if (ok) onCancelSubscription?.()
    })
  }

  return (
    <SettingsCard
      title="法务与隐私"
      description="数据导出与订阅取消的自助入口。"
    >
      <div className="space-y-3">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {onExportData && (
          <Item variant="outline">
            <ItemContent className="min-w-0">
              <ItemTitle>我的数据</ItemTitle>
              <ItemDescription>
                导出账号关联数据（JSON）：身份资料、订阅与权益记录等。
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={onExportData}
              >
                {busy && <Spinner aria-hidden="true" />}
                Export my data (JSON)
              </Button>
            </ItemActions>
          </Item>
        )}

        {subscription && (
          <Item variant="outline">
            <ItemContent className="min-w-0">
              <ItemTitle>订阅</ItemTitle>
              <ItemDescription data-testid="legal-subscription">
                {subscription.plan}
                {subscription.renewsAt &&
                  ` · 下次续费 ${formatDate(subscription.renewsAt)}`}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              {cancelRequested ? (
                // 已提交过取消请求：不再可发起（LC-4 运营队列语义，
                // 结果/outcome 由调用方经 error/外部状态如实告知）
                onCancelSubscription ? (
                  <Button variant="outline" size="sm" disabled>
                    取消已受理
                  </Button>
                ) : (
                  <StatusBadge label="取消已受理" tone="neutral" />
                )
              ) : (
                onCancelSubscription && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={handleCancelClick}
                  >
                    {busy && <Spinner aria-hidden="true" />}
                    取消订阅
                  </Button>
                )
              )}
            </ItemActions>
          </Item>
        )}
      </div>
    </SettingsCard>
  )
}
