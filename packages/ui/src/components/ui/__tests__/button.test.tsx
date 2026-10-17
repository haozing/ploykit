import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Button } from '../button'

describe('Button', () => {
  it('is its own positioning context (relative) so absolute children anchor to it', () => {
    const { container } = render(<Button>hi</Button>)
    expect(container.firstChild).toHaveClass('relative')
  })
})
