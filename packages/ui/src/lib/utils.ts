import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'


export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}



export type StatusTone = 'positive' | 'critical' | 'warning' | 'neutral' | 'brand'


export const STATUS_TONE_CLASS: Record<StatusTone, string> = {
  positive: 'bg-(--success)/10 text-(--success) border-(--success)/30',
  critical: 'bg-(--destructive)/10 text-(--destructive) border-(--destructive)/30',
  warning: 'bg-(--warning)/15 text-(--warning) border-(--warning)/40',
  neutral: 'bg-muted text-muted-foreground border-border',
  brand: 'bg-primary/10 text-primary border-primary/20',
}


export function statusTone(status: string): StatusTone {
  const s = status.toLowerCase()
  if (['active','paid','delivered','completed','success','running','entitled','done'].includes(s)) return 'positive'
  if (['failed','dead','error','disabled','canceled','expired','removed'].includes(s)) return 'critical'
  if (['pending','warned','suspended','retrying'].includes(s)) return 'warning'
  if (['owner','admin','pro','recommended'].includes(s)) return 'brand'
  return 'neutral'
}




export const STATUS_LABEL: Record<string, string> = {
  pending: '待处理',
  accepted: '已接受',
  declined: '已拒绝',
  revoked: '已撤销',
  expired: '已过期',
  redeemed: '已兑换',
  paid: '已支付',
  canceled: '已取消',
  active: '生效中',
  inactive: '未启用',
  enabled: '已启用',
  disabled: '已禁用',
  delivered: '已投递',
  failed: '失败',
  retrying: '重试中',
  completed: '已完成',
  done: '已完成',
  running: '运行中',
  success: '成功',
  error: '错误',
  
  dead: '死信/投递失败',
  warned: '已警告',
  suspended: '已暂停',
  removed: '已移除',
  entitled: '已生效',
  refunded: '已退款',
}


export function statusLabel(status: string): string {
  return STATUS_LABEL[status.toLowerCase()] ?? status
}




export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}


export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
}




export function browserTzLabel(): string {
  for (const nameType of ['shortOffset', 'short'] as const) {
    try {
      
      const opts = { timeZoneName: nameType } as Intl.DateTimeFormatOptions
      const parts = new Intl.DateTimeFormat('en-US', opts).formatToParts(new Date())
      const label = parts.find((p) => p.type === 'timeZoneName')?.value
      if (label) return label
    } catch {
      // 试下一档兜底
    }
  }
  return '本地时区'
}


export function formatDateTimeTz(iso: string): string {
  return `${formatDateTime(iso)} (${browserTzLabel()})`
}

export function shortID(id: string, len = 8): string {
  return id.slice(0, len)
}
