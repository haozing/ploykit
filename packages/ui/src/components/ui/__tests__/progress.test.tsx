import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  Progress, ProgressLabel, ProgressValue,
} from '../progress'

describe('progress 冒烟', () => {
  it('value=50 渲染轨道/指示条/标签/数值', () => {
    const { container } = render(
      <Progress value={50}>
        <ProgressLabel>用量</ProgressLabel>
        <ProgressValue />
      </Progress>,
    )
    expect(screen.getByText('用量')).toBeInTheDocument()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')

    
    expect(container.querySelector('[data-slot="progress-track"]')).toBeInTheDocument()
    expect(container.querySelector('[data-slot="progress-indicator"]')).toBeInTheDocument()
  })
})
