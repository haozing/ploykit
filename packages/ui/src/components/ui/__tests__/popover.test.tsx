import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  Popover, PopoverTrigger, PopoverContent, PopoverHeader,
  PopoverTitle, PopoverDescription,
} from '../popover'

describe('popover 冒烟', () => {
  it('Trigger 打开浮层；Escape 关闭', async () => {
    render(
      <Popover>
        <PopoverTrigger>打开</PopoverTrigger>
        <PopoverContent>
          <PopoverHeader>
            <PopoverTitle>浮层标题</PopoverTitle>
            <PopoverDescription>浮层描述</PopoverDescription>
          </PopoverHeader>
        </PopoverContent>
      </Popover>,
    )

    fireEvent.click(screen.getByRole('button', { name: '打开' }))
    expect(await screen.findByText('浮层标题')).toBeVisible()
    expect(screen.getByText('浮层描述')).toBeVisible()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByText('浮层标题')).not.toBeInTheDocument(),
    )
  })
})
