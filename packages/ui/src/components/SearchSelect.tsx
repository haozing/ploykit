import * as React from 'react'
import { Combobox } from '@base-ui/react/combobox'
import { CheckIcon, ChevronDownIcon, SearchIcon, XIcon } from 'lucide-react'
import { cn } from '../lib/utils'
import { useKitLabels } from '../labels/kit-labels'

/**
 * SearchSelect：可搜索单选下拉（补件三件套之一）。
 *
 * 契约（对消费方稳定）：
 * - options 为 `{ value, label }`，value 支持 string | number；触发按钮展示 label。
 * - 受控 value 允许 null / undefined（未选中）；onChange 在选中时给原始 value，
 *   清空（clearable 的 X、或列表里取消选择）时给 null——消费方无需判空对象。
 * - searchable 时弹层顶部出现搜索框，按 label 文本过滤（Base UI Combobox 内建过滤）。
 * - 文案走 kit-labels（searchSelect* 键），组件级 prop 优先于 Provider。
 *
 * 实现纪律：Base UI Combobox 原语（键盘导航 / ARIA combobox 语义 / 过滤内建），
 * 样式只用语义令牌类（semantic-tokens 合同测试覆盖）。
 */
export interface SearchSelectOption<TValue extends string | number = string> {
  value: TValue
  label: React.ReactNode
  /** 该选项不可选（仍展示，用于"无权限/已停用"等场景）。 */
  disabled?: boolean
}

export interface SearchSelectProps<TValue extends string | number = string> {
  options: SearchSelectOption<TValue>[]
  value: TValue | null | undefined
  onChange: (value: TValue | null) => void
  placeholder?: string
  disabled?: boolean
  /** 已选中时触发按钮右侧显示清除按钮，点击回调 onChange(null)。 */
  clearable?: boolean
  /** 弹层顶部渲染搜索输入框（按 label 过滤）。 */
  searchable?: boolean
  /** 外层容器类（宽度/布局由消费方给）。 */
  className?: string
  /** 触发按钮类（覆盖触发器视觉）。 */
  triggerClassName?: string
  /** 触发按钮 aria-label（未渲染可见 label 时必填，供屏幕阅读器）。 */
  triggerAriaLabel?: string
  /** 无匹配项文案覆盖（默认取 kit-labels 的 searchSelectEmpty）。 */
  emptyText?: string
  /** 搜索框占位文案覆盖（默认取 kit-labels 的 searchSelectSearchPlaceholder）。 */
  searchPlaceholder?: string
  /** 触发按钮高度档位：'default' = h-8，'sm' = h-7（工具栏/紧凑筛选条）。 */
  size?: 'sm' | 'default'
  /** 透传给触发按钮（表单关联 / label htmlFor）。 */
  id?: string
  name?: string
}

export function SearchSelect<TValue extends string | number = string>({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  clearable = false,
  searchable = false,
  className,
  triggerClassName,
  triggerAriaLabel,
  emptyText,
  searchPlaceholder,
  size = 'default',
  id,
  name,
}: SearchSelectProps<TValue>) {
  const L = useKitLabels()
  // 选项数组常被消费方内联重建（map 产物），不能按引用比较：
  // 选中项按业务值匹配，跨引用仍能高亮/回显。
  const selected = options.find((o) => o.value === value) ?? null

  return (
    <Combobox.Root<SearchSelectOption<TValue>>
      items={options}
      value={selected}
      onValueChange={(next) => onChange(next ? next.value : null)}
      isItemEqualToValue={(item, v) => item?.value === v?.value}
      disabled={disabled}
      name={name}
      // 弹层锚定触发按钮宽度，长选项由弹层自身滚动承载
      modal={false}
    >
      <div data-slot="search-select" className={cn('relative w-full', className)}>
        <Combobox.Trigger
          id={id}
          aria-label={triggerAriaLabel}
          data-slot="search-select-trigger"
          data-size={size}
          data-placeholder={selected ? undefined : ''}
          className={cn(
            'flex w-full items-center justify-between gap-1.5 rounded-lg border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-8 data-[size=sm]:h-7 dark:bg-input/30 dark:hover:bg-input/50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
            clearable && selected !== null && 'pr-9',
            triggerClassName,
          )}
        >
          {/* Base UI 契约：Value 的 children 优先于 placeholder，两者同时给时
              placeholder 不生效——空值文案在 children 内自行兜底。 */}
          <Combobox.Value>
            {(v: SearchSelectOption<TValue> | null | undefined) => (
              <span className="line-clamp-1 flex-1 text-left">
                {v?.label ?? (placeholder ?? L.searchSelectPlaceholder)}
              </span>
            )}
          </Combobox.Value>
          <Combobox.Icon className="shrink-0 text-muted-foreground">
            <ChevronDownIcon className="size-4" />
          </Combobox.Icon>
        </Combobox.Trigger>

        {/* 清除控件必须是 Trigger 的兄弟：Clear 渲染 <button>，嵌在 Trigger
            （同为 button）内是非法 HTML。绝对定位叠在触发按钮右内侧。 */}
        {clearable && selected !== null && (
          <Combobox.Clear
            aria-label={L.searchSelectClear}
            data-slot="search-select-clear"
            className="absolute top-1/2 right-7 z-10 flex size-4 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <XIcon className="size-3.5" />
          </Combobox.Clear>
        )}

        <Combobox.Portal>
          <Combobox.Positioner side="bottom" sideOffset={4} align="start" className="isolate z-50">
            <Combobox.Popup
              data-slot="search-select-content"
              className="relative isolate z-50 flex max-h-(--available-height) w-(--anchor-width) min-w-40 max-w-(--available-width) origin-(--transform-origin) flex-col overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
            >
              {searchable && (
                <div className="relative border-b p-1.5">
                  <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Combobox.Input
                    data-slot="search-select-input"
                    placeholder={searchPlaceholder ?? L.searchSelectSearchPlaceholder}
                    className="h-7 w-full rounded-md border-0 bg-transparent pl-6 text-sm outline-none placeholder:text-muted-foreground"
                  />
                </div>
              )}
              <Combobox.Empty>
                <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                  {emptyText ?? L.searchSelectEmpty}
                </div>
              </Combobox.Empty>
              <Combobox.List
                data-slot="search-select-list"
                className="overflow-y-auto overscroll-contain p-1 empty:p-0"
              >
                {(item: SearchSelectOption<TValue>) => (
                  <Combobox.Item
                    key={String(item.value)}
                    value={item}
                    disabled={item.disabled}
                    className="relative flex w-full cursor-default items-center gap-1.5 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50"
                  >
                    <span className="flex-1 truncate">{item.label}</span>
                    <Combobox.ItemIndicator
                      render={
                        <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center" />
                      }
                    >
                      <CheckIcon className="pointer-events-none" />
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </div>
    </Combobox.Root>
  )
}
