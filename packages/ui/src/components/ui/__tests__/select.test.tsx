import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '../select'

const items = [
  { value: 'a', label: '选项 A' },
  { value: 'b', label: '选项 B' },
]

function Demo() {
  const [value, setValue] = useState<string | null>('a')
  return (
    <Select items={items} value={value} onValueChange={(v) => setValue(v)}>
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

describe('select 冒烟', () => {
  it('Trigger 显示当前值；点击选项后切换', async () => {
    render(<Demo />)
    const trigger = screen.getByRole('combobox')
    expect(trigger).toHaveTextContent('选项 A')

    fireEvent.click(trigger)
    const option = await screen.findByRole('option', { name: '选项 B' })
    expect(option).toBeVisible()

    
    fireEvent.pointerDown(option, { button: 0, pointerType: 'mouse' })
    fireEvent.pointerUp(option, { button: 0, pointerType: 'mouse' })
    fireEvent.click(option)

    await waitFor(() => expect(trigger).toHaveTextContent('选项 B'))
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
  })
})
