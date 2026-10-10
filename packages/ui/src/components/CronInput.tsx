
import { useEffect, useRef, useState } from 'react'
import { api } from '@ploykit/client'
import { apiErrorMessage } from '../lib/api-error'
import { Button } from './ui/button'
import { Input } from './ui/input'

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


const DOW_LABEL: Record<string, string> = {
  '0': '周日', '1': '周一', '2': '周二', '3': '周三', '4': '周四', '5': '周五', '6': '周六', '7': '周日',
}


export function describeCron(expr: string): string {
  const fields = expr.trim().split(/\s+/)
  if (fields.length !== 5) return expr
  const [min, hour, dom, mon, dow] = fields
  if (mon !== '*') return expr
  const intIn = (s: string, lo: number, hi: number) => /^\d+$/.test(s) && Number(s) >= lo && Number(s) <= hi
  if (min !== '*' && !intIn(min, 0, 59)) return expr
  if (hour !== '*' && !intIn(hour, 0, 23)) return expr
  if (dow !== '*' && !intIn(dow, 0, 7)) return expr
  const hhmm = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`
  if (min === '*' && hour === '*' && dom === '*' && dow === '*') return '每分钟'
  if (hour === '*' && dom === '*' && dow === '*') return `每小时（第 ${min.padStart(2, '0')} 分）`
  if (dom === '*' && dow === '*') return `每天 ${hhmm}`
  if (dom === '*' && hour !== '*' && min !== '*') return `每${DOW_LABEL[dow] ?? dow} ${hhmm}`
  return expr 
}


function formatPreviewTime(iso: string, tz: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  try {
    return new Intl.DateTimeFormat('zh-CN', {
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
      if (stillCurrent()) setError(apiErrorMessage(e, '预览失败，请检查表达式后重试'))
    } finally {
      
      setLoading(false)
    }
  }

  const zones = timezoneOptions()

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <label htmlFor={`${idPrefix}-expr`} className="text-sm font-medium">
            Cron 表达式
          </label>
          <Input
            id={`${idPrefix}-expr`}
            placeholder="0 9 * * *"
            className="font-mono"
            value={value.cron}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, cron: e.target.value })}
          />
          <p className="text-xs text-muted-foreground" data-testid="cron-hint">
            {value.cron.trim() ? describeCron(value.cron) : '五字段：分 时 日 月 周'}
          </p>
        </div>
        <div className="w-48 shrink-0 space-y-1">
          <label htmlFor={`${idPrefix}-tz`} className="text-sm font-medium">
            时区
          </label>
          <select
            id={`${idPrefix}-tz`}
            className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            value={value.timezone}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          >
            {zones.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
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
          {loading ? '预览中…' : `预览下次 ${previewCount} 次`}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-destructive">{error}</p>
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
