import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { currentLang, t } from '../i18n'


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




// 三个标签映射（g8 分片 lib.status.* / lib.role.* / lib.dim.*）均为 getter
// 惰性取词：每次属性访问都按模块级 t() 的当前语言翻译（默认 en；zh 切换后
// 即刻生效，不依赖模块加载顺序）。对外形状不变（Record<string, string> 的
// 索引访问），未知键依旧返回 undefined 由调用方兜底。
export const STATUS_LABEL: Record<string, string> = {
  get pending() { return t('lib.status.pending') },
  get accepted() { return t('lib.status.accepted') },
  get declined() { return t('lib.status.declined') },
  get revoked() { return t('lib.status.revoked') },
  get expired() { return t('lib.status.expired') },
  get redeemed() { return t('lib.status.redeemed') },
  get paid() { return t('lib.status.paid') },
  get canceled() { return t('lib.status.canceled') },
  get active() { return t('lib.status.active') },
  get inactive() { return t('lib.status.inactive') },
  get enabled() { return t('lib.status.enabled') },
  get disabled() { return t('lib.status.disabled') },
  get delivered() { return t('lib.status.delivered') },
  get failed() { return t('lib.status.failed') },
  get retrying() { return t('lib.status.retrying') },
  get completed() { return t('lib.status.completed') },
  get done() { return t('lib.status.done') },
  get running() { return t('lib.status.running') },
  get success() { return t('lib.status.success') },
  get error() { return t('lib.status.error') },

  get dead() { return t('lib.status.dead') },
  get warned() { return t('lib.status.warned') },
  get suspended() { return t('lib.status.suspended') },
  get removed() { return t('lib.status.removed') },
  get entitled() { return t('lib.status.entitled') },
  get refunded() { return t('lib.status.refunded') },
}


export function statusLabel(status: string): string {
  return STATUS_LABEL[status.toLowerCase()] ?? status
}



/** 角色 → 标签（owner/admin/member 的唯一权威映射，页面不得各自抄副本；随当前语言翻译）。 */
export const ROLE_LABEL: Record<string, string> = {
  get owner() { return t('lib.role.owner') },
  get admin() { return t('lib.role.admin') },
  get member() { return t('lib.role.member') },
}


/** 计量维度键 → 标签（未知键由调用方兜底显示原始键；随当前语言翻译）。 */
export const DIM_LABEL: Record<string, string> = {
  get tasks_monthly() { return t('lib.dim.tasksMonthly') },
  get workspaces() { return t('lib.dim.workspaces') },
  get seats() { return t('lib.dim.seats') },
  get webhooks() { return t('lib.dim.webhooks') },
}


export function dimLabel(key: string): string {
  return DIM_LABEL[key] ?? key
}




// 日期格式化随当前语言取 locale（en 默认 → en-US；zh 产品 → zh-CN）。
function dateLocale(): string {
  return currentLang() === 'zh' ? 'zh-CN' : 'en-US'
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(dateLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' })
}


export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(dateLocale(), {
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
  return t('lib.tz.local')
}


export function formatDateTimeTz(iso: string): string {
  return `${formatDateTime(iso)} (${browserTzLabel()})`
}

export function shortID(id: string, len = 8): string {
  return id.slice(0, len)
}
