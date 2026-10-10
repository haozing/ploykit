import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../select'
import type * as React from 'react'

const items = [
  { value: 'a', label: '选项 A' },
  { value: 'b', label: '选项 B' },
]

/** 产品侧目标写法：回调参数已是 string，无需 `v ?? ''` 卫语句。 */
function Demo({ onValueChange }: { onValueChange: (v: string) => void }) {
  const [value, setValue] = useState<string | null>('a')
  const handle = (v: string) => {
    received.push(v)
    setValue(v || null)
    onValueChange(v)
  }
  return (
    <Select items={items} value={value} onValueChange={handle}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const received: string[] = []

describe('select 包装层：onValueChange 永远收到 string', () => {
  it('受控交互：点击选项后回调收到 string（非 null）', async () => {
    render(<Demo onValueChange={() => {}} />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('选项 A')

    fireEvent.click(trigger)
    const option = await screen.findByRole('option', { name: '选项 B' })
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
    fireEvent.click(option)

    await waitFor(() => expect(trigger).toHaveTextContent('选项 B'))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(received).toEqual(['b'])
    received.length = 0
  })

  it('类型契约：onValueChange 参数为 string，value 仍允许 null（编译期断言）', () => {
    // 1) string 回调可直接作为 onValueChange 使用
    const onString = (_v: string) => {}
    const ok: React.ComponentProps<typeof Select>['onValueChange'] = onString
    expect(ok).toBeTypeOf('function')

    // 2) 受控 value 保留 null 能力（base-ui 原生语义不收窄）
    const nullValue: React.ComponentProps<typeof Select>['value'] = null
    expect(nullValue).toBeNull()

    // 3) 旧卫语句写法 `(v) => setX(v ?? '')` 对 string 参数仍合法（?? 的左操作数可为非空类型）
    const legacy = (_v: string) => {}
    const tolerant = (v: string) => legacy(v ?? '')
    expect(tolerant).toBeTypeOf('function')
  })
})
