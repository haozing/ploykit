import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSEO } from '../useSEO'




function Probe(props: { title?: string; description?: string; ogImage?: string }) {
  useSEO(props)
  return <p>probe</p>
}

beforeEach(() => {
  document.title = ''
  document.head
    .querySelectorAll('meta[name="description"],meta[property^="og:"],meta[name="twitter:card"]')
    .forEach((el) => el.remove())
})

describe('useSEO（经 @ploykit/runtime 指令通道）', () => {
  it('title/description/ogImage 落位 document.head（og 图附带 twitter:card 策略）', () => {
    render(<Probe title="页题" description="描述" ogImage="/cover.png" />)
    expect(document.title).toBe('页题')
    expect(document.head.querySelector('meta[name="description"]')).toHaveAttribute('content', '描述')
    expect(document.head.querySelector('meta[property="og:image"]')).toHaveAttribute('content', '/cover.png')
    expect(document.head.querySelector('meta[name="twitter:card"]')).toHaveAttribute(
      'content', 'summary_large_image',
    )
  })

  it('未传的可选项不产生条目（空字段不落 head）', () => {
    render(<Probe title="只有标题" />)
    expect(document.title).toBe('只有标题')
    expect(document.head.querySelector('meta[name="description"]')).toBeNull()
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull()
    expect(document.head.querySelector('meta[name="twitter:card"]')).toBeNull()
  })

  it('重渲染（SPA 导航语义）：title 覆写、meta 原位更新不重复', () => {
    const { rerender } = render(<Probe title="A页" description="a" />)
    rerender(<Probe title="B页" description="b" />)
    expect(document.title).toBe('B页')
    const metas = document.head.querySelectorAll('meta[name="description"]')
    expect(metas).toHaveLength(1)
    expect(metas[0]).toHaveAttribute('content', 'b')
  })
})
