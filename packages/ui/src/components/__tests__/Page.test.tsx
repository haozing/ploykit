import '@testing-library/jest-dom/vitest'
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { PageHeader, PageLoading, PageEmpty, PageError } from '../Page'
import { KitLabelsProvider } from '../../labels/kit-labels'

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

  it('titleClassName 透传到 h1（orkome 报告 #4：truncate/淡化等消费方既有行为迁移缝）', () => {
    render(
      <PageHeader title="长名称文档" titleClassName="opacity-55" />,
    )
    expect(screen.getByRole('heading', { level: 1, name: '长名称文档' })).toHaveClass('opacity-55')
  })

  it('h1 内置 truncate + title 属性（长名称不再换行，悬停可见全文）', () => {
    render(<PageHeader title="很长的工作区名称" />)
    const heading = screen.getByRole('heading', { level: 1, name: '很长的工作区名称' })
    expect(heading).toHaveClass('truncate')
    expect(heading).toHaveAttribute('title', '很长的工作区名称')
  })
})

describe('Page 三态件接入 KitLabels（orkome 报告 #3：双语产品 en 环境不再露中文）', () => {
  it('不挂 Provider：默认文案与历史硬编码逐字一致（零破坏）', () => {
    render(
      <>
        <PageLoading />
        <PageEmpty />
        <PageError message="加载失败" onRetry={() => {}} />
      </>,
    )
    expect(screen.getByText('加载中…')).toBeInTheDocument()
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument()
  })

  it('KitLabelsProvider 覆盖三键：pageLoading / pageEmpty / pageRetry', () => {
    render(
      <KitLabelsProvider labels={{ pageLoading: 'Loading…', pageEmpty: 'No data', pageRetry: 'Retry' }}>
        <PageLoading />
        <PageEmpty />
        <PageError message="Failed" onRetry={() => {}} />
      </KitLabelsProvider>,
    )
    expect(screen.getByText('Loading…')).toBeInTheDocument()
    expect(screen.getByText('No data')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument()
  })

  it('组件级 prop 优先于 Provider（label / retryLabel 显式传参仍生效）', () => {
    render(
      <KitLabelsProvider labels={{ pageLoading: 'Loading…', pageEmpty: 'No data', pageRetry: 'Retry' }}>
        <PageLoading label="加载用量…" />
        <PageEmpty label="暂无任务" />
        <PageError message="Failed" onRetry={() => {}} retryLabel="再试一次" />
      </KitLabelsProvider>,
    )
    expect(screen.getByText('加载用量…')).toBeInTheDocument()
    expect(screen.getByText('暂无任务')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再试一次' })).toBeInTheDocument()
  })
})
