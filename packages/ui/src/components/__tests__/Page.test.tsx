import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PageHeader } from '../Page'

describe('PageHeader', () => {
  it('leading 内容在 DOM 顺序上先于标题（h1）渲染', () => {
    const { container } = render(
      <PageHeader
        title="密钥详情"
        leading={<button type="button">返回</button>}
      />,
    )

    const back = screen.getByRole('button', { name: '返回' })
    const heading = screen.getByRole('heading', { level: 1, name: '密钥详情' })
    // back-btn precedes h1: bitwise CONTAINS|POSITION_FOLLOWING check via compareDocumentPosition
    expect(back.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // 两者同处标题行：leading 是 h1 的前一个兄弟
    expect(back.nextElementSibling).toBe(heading)
    expect(container.firstChild).toBeInTheDocument()
  })

  it('不传 leading 时行为不变：仅渲染标题/描述/操作', () => {
    render(
      <PageHeader
        title="工作区"
        description="管理成员与配额"
        actions={<button type="button">邀请</button>}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: '工作区' })).toBeInTheDocument()
    expect(screen.getByText('管理成员与配额')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '邀请' })).toBeInTheDocument()
  })

  it('description 仍位于标题行下方（同一左列内）', () => {
    const { container } = render(
      <PageHeader title="配额" description="本月用量" />,
    )

    const heading = screen.getByRole('heading', { level: 1, name: '配额' })
    const description = screen.getByText('本月用量')
    // 描述紧跟标题行 div 之后（同一左列内），且保留原 mt-1 间距
    expect(heading.parentElement!.nextElementSibling).toBe(description)
    expect(description).toHaveClass('mt-1')
  })
})
