import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { describe, it, expect } from 'vitest'
import {
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogCancel, AlertDialogAction,
} from '../alert-dialog'


function Demo({ onConfirm }: { onConfirm?: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger>删除</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认删除？</AlertDialogTitle>
          <AlertDialogDescription>此操作不可撤销</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onConfirm?.()
              setOpen(false)
            }}
          >
            确定
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

describe('alert-dialog 冒烟', () => {
  it('Trigger 打开 → Action 确认并关闭', async () => {
    const confirmed: boolean[] = []
    render(<Demo onConfirm={() => confirmed.push(true)} />)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('确认删除？')).toBeVisible()
    expect(screen.getByText('此操作不可撤销')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: '确定' }))
    expect(confirmed).toEqual([true])
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
  })

  it('Cancel 关闭弹窗且不触发确认', async () => {
    const confirmed: boolean[] = []
    render(<Demo onConfirm={() => confirmed.push(true)} />)

    fireEvent.click(screen.getByRole('button', { name: '删除' }))
    fireEvent.click(await screen.findByRole('button', { name: '取消' }))
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    )
    expect(confirmed).toEqual([])
  })
})
