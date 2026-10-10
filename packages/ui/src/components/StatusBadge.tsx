import { cn, statusLabel, statusTone, STATUS_TONE_CLASS } from '../lib/utils'

// 业务语义件（shadcn 无对应物，按"有则用 stock、无则留业务层"规则留守）：
// 按订阅/订单/投递等业务状态映射色调与文案的徽章，从 stock 镜像 badge.tsx 迁出。
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
      STATUS_TONE_CLASS[statusTone(status)], className)}>
      {statusLabel(status)}
    </span>
  )
}
