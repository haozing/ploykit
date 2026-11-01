
import { useEffect, useRef, useState } from 'react'
import { api } from '@ploykit/client'
import { apiErrorMessage } from '../lib/api-error'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { FieldError } from './ui/field'
import { Label } from './ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import { useT, t, currentLang } from '../i18n'

export interface CronValue {
  cron: string
  timezone: string
}

export interface CronInputProps {
  value: CronValue
  onChange: (v: CronValue) => void
  
  idPrefix?: string
  
  previewCount?: number
  disabled?: boolean
}


export const FALLBACK_TIMEZONES = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
]


export function timezoneOptions(): string[] {
  let zones: string[] = []
  try {
    const i = Intl as { supportedValuesOf?: (key: string) => string[] }
    if (typeof i.supportedValuesOf === 'function') {
      zones = i.supportedValuesOf('timeZone')
    }
  } catch {
    // fall through 到内置列表
  }
  if (zones.length === 0) return FALLBACK_TIMEZONES
  return Array.from(new Set(['UTC', ...zones]))
}


// 翻译函数签名：useT() 的返回值与模块级 t() 均满足（describeCron 纯函数可脱离
// React 上下文调用，默认走模块级 t，组件内传入 hook 版以随 Provider 语言切换）。
type Translate = (key: string, vars?: Record<string, string | number>) => string

// 周几文案走字典（ui.cron.dow.0..7，0/7 均为周日——cron 惯例）；缺翻译时回退
// 原始数字段，对齐原先 DOW_LABEL[dow] ?? dow 的兜底行为。
function dayLabel(dow: string, translate: Translate = t): string {
  const key = `ui.cron.dow.${dow}`
  const label = translate(key)
  return label === key ? dow : label
}


export function describeCron(expr: string, translate: Translate = t): string {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return expr
  const [min, hour, dom, mon, dow] = fields
  if (mon !== '*') return expr
  const intIn = (s: string, lo: number, hi: number) => /^\d+$/.test(s) && Number(s) >= lo && Number(s) <= hi
  if (min !== '*' && !intIn(min, 0, 59)) return expr
  if (hour !== '*' && !intIn(hour, 0, 23)) return expr
  if (dow !== '*' && !intIn(dow, 0, 7)) return expr
  const hhmm = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  if (min === '*' && hour === '*' && dom === '*' && dow === '*') return translate('ui.cron.everyMinute')
  if (hour === '*' && dom === '*' && dow === '*') return translate('ui.cron.hourlyAt', { minute: min.padStart(2, '0') })
  if (dom === '*' && dow === '*') return translate('ui.cron.dailyAt', { time: hhmm })
  if (dom === '*' && hour !== '*' && min !== '*') return translate('ui.cron.weeklyAt', { day: dayLabel(dow, translate), time: hhmm })
  return expr
}


function formatPreviewTime(iso: string, tz: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    // 预览时间随 UI 语言格式化（B 方案 EN 默认）：zh 走 zh-CN，其余 en-US。
    return new Intl.DateTimeFormat(currentLang() === 'zh' ? 'zh-CN' : 'en-US', {
      timeZone: tz, dateStyle: 'medium', timeStyle: 'short',
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

export function CronInput({
  value,
  onChange,
  idPrefix = 'cron',
  previewCount = 3,
  disabled,
}: CronInputProps) {
  const [preview, setPreview] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const t = useT() // 组件内文案走字典（g9：ui.cron.*）；describeCron 传入以随 Provider 语言
  
  const valueRef = useRef(value)
  valueRef.current = value

  
  
  useEffect(() => {
    setPreview(null)
  }, [value.cron, value.timezone])

  const runPreview = async () => {
    const reqCron = value.cron.trim()
    const reqTz = value.timezone
    setLoading(true)
    setError(null)
    setPreview(null)
    const stillCurrent = () =>
      valueRef.current.cron.trim() === reqCron && valueRef.current.timezone === reqTz
    try {
      const d = await api.post<{ items: string[] }>('/api/schedules/preview', {
        cron_expr: reqCron,
        timezone: reqTz,
        count: previewCount,
      })
      
      if (stillCurrent()) setPreview(d?.items ?? [])
    } catch (e) {
      if (stillCurrent()) setError(apiErrorMessage(e, t('ui.cron.previewError')))
    } finally {
      
      setLoading(false)
    }
  }

  const zones = timezoneOptions()

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={`${idPrefix}-expr`}>
            {t('ui.cron.expressionLabel')}
          </Label>
          <Input
            id={`${idPrefix}-expr`}
            placeholder="0 9 * * *"
            className="font-mono"
            value={value.cron}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, cron: e.target.value })}
          />
          <p className="text-xs text-muted-foreground" data-testid="cron-hint">
            {value.cron.trim() ? describeCron(value.cron, t) : t('ui.cron.fieldsHint')}
          </p>
        </div>
        <div className="w-48 shrink-0 space-y-1">
          <Label htmlFor={`${idPrefix}-tz`}>
            {t('ui.cron.timezoneLabel')}
          </Label>
          <Select
            value={value.timezone}
            onValueChange={(tz) => onChange({ ...value, timezone: tz })}
            disabled={disabled}
          >
            <SelectTrigger id={`${idPrefix}-tz`} className="w-full">
              <SelectValue>{value.timezone}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {zones.map((tz) => (
                <SelectItem key={tz} value={tz}>{tz}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || loading || !value.cron.trim()}
          onClick={() => void runPreview()}
        >
          {loading ? t('ui.cron.previewing') : t('ui.cron.previewNext', { count: previewCount })}
        </Button>
        {error && (
          <FieldError className="text-xs">{error}</FieldError>
        )}
        {preview && preview.length > 0 && (
          <ul data-testid="cron-preview" className="list-inside list-disc text-xs text-muted-foreground">
            {preview.map((t, i) => (
              <li key={i}>{formatPreviewTime(t, value.timezone)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
