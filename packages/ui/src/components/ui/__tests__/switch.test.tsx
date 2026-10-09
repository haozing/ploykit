import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { Switch } from '../switch'

function Demo() {
  const [on, setOn] = useState(false)
  return <Switch checked={on} onCheckedChange={setOn} aria-label="通知开关" />
}

describe('switch 冒烟', () => {
  it('点击切换 aria-checked', () => {
    render(<Demo />)
    const sw = screen.getByRole('switch', { name: '通知开关' })
    expect(sw).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(sw)
    expect(sw).toHaveAttribute('aria-checked', 'false')
  })
})
