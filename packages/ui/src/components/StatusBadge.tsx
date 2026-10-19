import { cn, statusLabel, statusTone, STATUS_TONE_CLASS, type StatusTone } from '../lib/utils'

// 业务语义件（shadcn 无对应物，按"有则用 stock、无则留业务层"规则留守）：
// 按订阅/订单/投递等业务状态映射色调与文案的徽章，从 stock 镜像 badge.tsx 迁出。
// 可选 label/tone 覆盖：业务层自有状态集（如 WS 连接状态）复用同一视觉时，
// 不走 statusLabel/statusTone 默认映射；不传则行为与原来完全一致。
export function StatusBadge({
  status,
  label,
  tone,
  className,
}: {
  /** 业务状态键（推导默认文案/色调）；与 label+tone 同时省略无意义，全给时仅剩 className 生效 */
  status?: string
  /** 覆盖默认文案（statusLabel(status)） */
  label?: string
  /** 覆盖默认色调（statusTone(status)），取 STATUS_TONE_CLASS 的键 */
  tone?: StatusTone
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
      STATUS_TONE_CLASS[tone ?? statusTone(status ?? '')], className)}>
      {label ?? statusLabel(status ?? '')}
    </span>
  )
}
