import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import {
  Sheet, SheetTrigger, SheetContent,
} from '../sheet'
import {
  Dialog, DialogTrigger, DialogContent,
} from '../dialog'

function SheetDemo({ size }: { size?: 'sm' | 'md' | 'lg' }) {
  const [open, setOpen] = useState(true)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger>打开</SheetTrigger>
      <SheetContent size={size} data-testid="sheet-content">
        <div>面板内容</div>
      </SheetContent>
    </Sheet>
  )
}

function DialogDemo({ size }: { size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const [open, setOpen] = useState(true)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>打开</DialogTrigger>
      <DialogContent size={size} data-testid="dialog-content">
        <div>弹窗内容</div>
      </DialogContent>
    </Dialog>
  )
}

describe('sheet/dialog size 档位（data-size 落地）', () => {
  it('Sheet 默认 size=sm → data-size="sm"', () => {
    render(<SheetDemo />)
    expect(screen.getByTestId('sheet-content')).toHaveAttribute('data-size', 'sm')
  })

  it('Sheet size=lg → data-size="lg"，类含 data-[size=lg] 档位与 overflow-y-auto', () => {
    render(<SheetDemo size="lg" />)
    const el = screen.getByTestId('sheet-content')
    expect(el).toHaveAttribute('data-size', 'lg')
    expect(el).toHaveAttribute('data-side', 'right')
    expect(el.className).toContain('data-[side=right]:data-[size=lg]:sm:max-w-2xl')
    expect(el.className).toContain('overflow-y-auto')
  })

  it('Sheet top 侧 lg → max-h 档位', () => {
    render(
      <Sheet open>
        <SheetContent side="top" size="lg" data-testid="sheet-top">
          内容
        </SheetContent>
      </Sheet>,
    )
    const el = screen.getByTestId('sheet-top')
    expect(el.className).toContain('data-[side=top]:data-[size=lg]:max-h-[80vh]')
  })

  it('Dialog 默认 size=sm → data-size="sm"，保留 sm:max-w-sm 基础类', () => {
    render(<DialogDemo />)
    const el = screen.getByTestId('dialog-content')
    expect(el).toHaveAttribute('data-size', 'sm')
    expect(el.className).toContain('sm:max-w-sm')
  })

  it('Dialog size=xl → data-size="xl"', () => {
    render(<DialogDemo size="xl" />)
    const el = screen.getByTestId('dialog-content')
    expect(el).toHaveAttribute('data-size', 'xl')
    expect(el.className).toContain('data-[size=xl]:sm:max-w-4xl')
  })

  it('Dialog size=md / lg → 对应档位类', () => {
    const { rerender } = render(<DialogDemo size="md" />)
    expect(screen.getByTestId('dialog-content').className).toContain('data-[size=md]:sm:max-w-lg')

    rerender(<DialogDemo size="lg" />)
    expect(screen.getByTestId('dialog-content').className).toContain('data-[size=lg]:sm:max-w-2xl')
  })
})
