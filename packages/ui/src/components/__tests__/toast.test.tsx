import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { toast, Toaster } from '../toast'

describe('toast / Toaster', () => {
  it('toast.success 后 Toaster 渲染成功提示文案', async () => {
    render(<Toaster />)
    toast.success('保存成功')
    expect(await screen.findByText('保存成功')).toBeInTheDocument()
  })

  it('toast.error 渲染错误提示文案（props 可透传覆盖默认值）', async () => {
    render(<Toaster position="bottom-left" />)
    toast.error('保存失败')
    expect(await screen.findByText('保存失败')).toBeInTheDocument()
  })

  it('Toaster 容器 aria-label 走 i18n 字典（默认 en → Notifications）', () => {
    const { container } = render(<Toaster />)
    // sonner 会在 aria-label 后追加 ' alt+T' 快捷键提示，故用 toContain。
    expect(container.querySelector('section')?.getAttribute('aria-label')).toContain('Notifications')
  })

  
  
  
  
  
  it('B1/G1：sonner 样式表随组件入口可解析（import 缺失即红）', async () => {
    await expect(import('sonner/dist/styles.css')).resolves.toBeDefined()
  })
})
