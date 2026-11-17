import type { KeyboardEvent } from 'react'

/**
 * 单选/卡片组的方向键导航（WAI-ARIA radio group 模式）。
 *
 * 为什么需要：页面里的模板卡片与主题圆点此前只有 `role="radio"` 但既没有
 * roving tabindex 也没有方向键处理——键盘用户必须逐个 Tab 穿过所有选项，
 * 且 `aria-checked` 与实际选中态可能脱节。这里给出一个纯函数助手：
 *
 * - roving tabindex：选中项 tabIndex=0，其余 -1（整组只占一个 Tab 停靠点）；
 * - ArrowRight/Down → 下一项，ArrowLeft/Up → 上一项，Home/End → 首/末项；
 * - 焦点始终跟随移动；`onSelect` 存在时同时切换选中（真正的 radio 语义），
 *   不存在时只移动焦点（卡片是「点进去」的入口，方向键不替用户前进）。
 *
 * 元素需带 `data-radio-item`（由本助手返回）且为同一容器的直接/后代子元素。
 */
export interface RadioNavOptions {
  /** 本元素在组内的序号。 */
  index: number
  /** 组内元素总数。 */
  count: number
  /** 当前选中序号；-1 表示无选中（roving 落回第一项）。 */
  checkedIndex: number
  /** 方向键移动时是否同时选中。缺省只移动焦点。 */
  onSelect?: (index: number) => void
}

export function radioNavProps({ index, count, checkedIndex, onSelect }: RadioNavOptions) {
  const roving = checkedIndex >= 0 ? checkedIndex : 0
  return {
    'data-radio-item': '',
    tabIndex: index === roving ? 0 : -1,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      let next: number
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          next = (index + 1) % count
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          next = (index - 1 + count) % count
          break
        case 'Home':
          next = 0
          break
        case 'End':
          next = count - 1
          break
        default:
          return
      }
      e.preventDefault()
      const group = e.currentTarget.closest('[role="radiogroup"]')
      if (group) {
        const items = Array.from(group.querySelectorAll<HTMLElement>('[data-radio-item]'))
        items[next]?.focus()
      }
      onSelect?.(next)
    },
  } as const
}

/** 权限集包含判定（role_perms 未知时按「可见」处理，与框架侧 AppShell 规则一致）。 */
export function hasPerm(rolePerms: string[] | undefined, key: string): boolean {
  if (!rolePerms) return true
  return rolePerms.includes(key)
}
