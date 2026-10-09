import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Button } from '../ui/Button'

describe('vitest 基建冒烟', () => {
  it('渲染 Button 并断言在文档中', () => {
    render(<Button>ok</Button>)
    expect(screen.getByRole('button', { name: 'ok' })).toBeInTheDocument()
  })
})
