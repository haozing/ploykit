import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { hasPerm, radioNavProps } from './radio-nav'

/** 模板/主题 radio 组的键盘可达性（WAI-ARIA radio group：roving tabindex + 方向键）。 */

function Group({ labels, withSelect = true }: { labels: string[]; withSelect?: boolean }) {
  const [checked, setChecked] = useState(0)
  return (
    <div role="radiogroup" aria-label="选项">
      {labels.map((label, i) => (
        <button
          key={label}
          type="button"
          role="radio"
          aria-checked={checked === i}
          onClick={() => setChecked(i)}
          {...radioNavProps({
            index: i,
            count: labels.length,
            checkedIndex: checked,
            onSelect: withSelect ? setChecked : undefined,
          })}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

describe('radioNavProps', () => {
  it('roving tabindex：选中项 tabIndex=0，其余 -1（整组只有一个 Tab 停靠点）', () => {
    render(<Group labels={['甲', '乙', '丙']} />)
    const radios = screen.getAllByRole('radio')
    expect(radios[0]).toHaveAttribute('tabindex', '0')
    expect(radios[1]).toHaveAttribute('tabindex', '-1')
    expect(radios[2]).toHaveAttribute('tabindex', '-1')
  })

  it('方向键切换选中并移动焦点；Home/End 到首尾', () => {
    render(<Group labels={['甲', '乙', '丙']} />)
    const radios = screen.getAllByRole('radio')

    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' })
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    expect(radios[1]).toHaveFocus()

    fireEvent.keyDown(radios[1]!, { key: 'ArrowDown' })
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')

    fireEvent.keyDown(radios[2]!, { key: 'Home' })
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
    expect(radios[0]).toHaveFocus()

    fireEvent.keyDown(radios[0]!, { key: 'End' })
    expect(radios[2]).toHaveAttribute('aria-checked', 'true')
  })

  it('不传 onSelect（卡片式入口）时方向键只移动焦点，不替用户前进', () => {
    render(<Group labels={['甲', '乙']} withSelect={false} />)
    const radios = screen.getAllByRole('radio')
    fireEvent.keyDown(radios[0]!, { key: 'ArrowRight' })
    expect(radios[1]).toHaveFocus()
    expect(radios[0]).toHaveAttribute('aria-checked', 'true')
  })

  it('hasPerm：role_perms 已知时按集合判定，未知（旧载荷）按可见处理', () => {
    expect(hasPerm(['video:read'], 'video:write')).toBe(false)
    expect(hasPerm(['video:read', 'video:write'], 'video:write')).toBe(true)
    expect(hasPerm(undefined, 'video:render')).toBe(true)
  })
})
