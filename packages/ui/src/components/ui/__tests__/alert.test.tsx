import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Alert, AlertDescription, AlertTitle } from '../alert'

describe('Alert warning variant', () => {
  it('variant="warning" 应用语义 warning 色（bg-card + text-warning）', () => {
    const { container } = render(
      <Alert variant="warning">
        <AlertTitle>注意</AlertTitle>
        <AlertDescription>磁盘空间不足</AlertDescription>
      </Alert>,
    )
    const alert = container.querySelector('[data-slot="alert"]')
    expect(alert).not.toBeNull()
    expect(alert).toHaveClass('bg-card', 'text-warning')
    expect(alert).not.toHaveClass('text-destructive')
  })

  it('description 使用 warning/90 派生色（与 destructive 同构）', () => {
    const { container } = render(
      <Alert variant="warning">
        <AlertDescription>磁盘空间不足</AlertDescription>
      </Alert>,
    )
    const description = container.querySelector('[data-slot="alert-description"]')
    expect(description).not.toBeNull()
    // cva 的子元素选择器作用于父级；description 自身不带该 class。
    expect(container.querySelector('[data-slot="alert"]')?.className).toContain(
      '*:data-[slot=alert-description]:text-warning/90',
    )
  })
})
