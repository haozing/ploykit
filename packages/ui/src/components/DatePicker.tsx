import { XIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useKitLabels } from '../labels/kit-labels'

/**
 * DatePicker：单日期选择控件（补件三件套之一）。
 *
 * 契约：
 * - value 为本地日历日的 `Date`（时分秒忽略）；onChange 选中给当天 00:00:00 的
 *   本地 Date，清空给 null。
 * - 值格式一律按本地时区 Y-M-D 处理（不做 toISOString）——避免 UTC+8 下
 *   `toISOString().slice(0,10)` 把 8 月 1 日退成 7 月 31 日的典型时区 bug。
 * - min / max 约束可选范围（同样按本地日历日）。
 *
 * 实现纪律：原生 `<input type="date">` 之上做主题化包装，不引入日历依赖
 * （component-selection 的"标准库能做的就不加第三方"原则）；浏览器原生日期
 * 选择器自带无障碍与本地化。需要自定义日历面板时再单独立项评估。
 */
export interface DatePickerProps {
  value?: Date | null
  onChange?: (date: Date | null) => void
  /** 空值时显示的占位文案（默认取 kit-labels 的 datePickerPlaceholder）。 */
  placeholder?: string
  className?: string
  disabled?: boolean
  /** 有值时显示清除按钮，点击回调 onChange(null)。 */
  clearable?: boolean
  /** 可选范围下界（含当天）。 */
  min?: Date
  /** 可选范围上界（含当天）。 */
  max?: Date
  /** 高度档位：'default' = h-8，'sm' = h-7（工具栏/紧凑筛选条）。 */
  size?: 'sm' | 'default'
  /** 透传给原生 input（表单关联 / label htmlFor）。 */
  id?: string
  name?: string
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

function toLocalYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function parseLocalYMD(v: string): Date | null {
  if (!v) return null
  const d = new Date(`${v}T00:00:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  clearable = false,
  min,
  max,
  size = 'default',
  id,
  name,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: DatePickerProps) {
  const L = useKitLabels()
  const hasValue = value instanceof Date && !Number.isNaN(value.getTime())
  const ymd = hasValue ? toLocalYMD(value) : ''

  return (
    <div
      data-slot="date-picker"
      className={cn('relative inline-flex w-full', className)}
    >
      <input
        id={id}
        name={name}
        type="date"
        disabled={disabled}
        value={ymd}
        min={min ? toLocalYMD(min) : undefined}
        max={max ? toLocalYMD(max) : undefined}
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => onChange?.(parseLocalYMD(e.target.value))}
        data-slot="date-picker-input"
        data-size={size}
        className={cn(
          'w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 data-[size=default]:h-8 data-[size=sm]:h-7 data-[size=sm]:rounded-[min(var(--radius-md),10px)]',
          // 空值：隐藏浏览器自带占位（yyyy/mm/dd），改用下方主题化占位文案
          !ymd && 'text-transparent',
          clearable && hasValue && 'pr-8',
        )}
      />
      {!ymd && (
        <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-muted-foreground">
          {placeholder ?? L.datePickerPlaceholder}
        </span>
      )}
      {clearable && hasValue && (
        <button
          type="button"
          aria-label={L.datePickerClear}
          disabled={disabled}
          onClick={() => onChange?.(null)}
          className="absolute top-1/2 right-7 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </div>
  )
}
