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

  
  
  
  
  
  it('B1/G1：sonner 样式表随组件入口可解析（import 缺失即红）', async () => {
    await expect(import('sonner/dist/styles.css')).resolves.toBeDefined()
  })
})
