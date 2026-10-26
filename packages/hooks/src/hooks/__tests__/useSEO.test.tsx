import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { useSEO, type SeoMeta } from '../useSEO'





function Probe(props: SeoMeta) {
  useSEO(props)
  return <p>probe</p>
}

beforeEach(() => {
  document.title = ''
  document.head
    .querySelectorAll('meta[name="description"],meta[property^="og:"],meta[name^="twitter:"],link[rel="canonical"]')
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

  it('重渲染（SPA 导航语义）：title 覆写、meta 原位更新不重复', () => {
    const { rerender } = render(<Probe title="A页" description="a" />)
    rerender(<Probe title="B页" description="b" />)
    expect(document.title).toBe('B页')
    const metas = document.head.querySelectorAll('meta[name="description"]')
    expect(metas).toHaveLength(1)
    expect(metas[0]).toHaveAttribute('content', 'b')
  })

  it('canonical：落位 link[rel=canonical]，换页原位更新不重复', () => {
    const { rerender } = render(<Probe title="A" canonical="https://x.com/a" />)
    rerender(<Probe title="B" canonical="https://x.com/b" />)
    const links = document.head.querySelectorAll('link[rel="canonical"]')
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', 'https://x.com/b')
  })

  it('空 meta 不产生任何条目', () => {
    render(<Probe />)
    expect(document.title).toBe('')
    expect(document.head.querySelector('meta[property^="og:"]')).toBeNull()
    expect(document.head.querySelector('meta[name^="twitter:"]')).toBeNull()
    expect(document.head.querySelector('meta[name="description"]')).toBeNull()
    expect(document.head.querySelector('link[rel="canonical"]')).toBeNull()
  })
})

describe('useSEO OG 四要素（#22：镜像默认 + 显式覆盖 + twitter 镜像）', () => {
  it('title/description/canonical 自动镜像 og:title/og:description/og:url，og:type 默认 website', () => {
    render(<Probe title="页题" description="描述" canonical="https://x.com/p" />)
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute('content', '页题')
    expect(document.head.querySelector('meta[property="og:description"]')).toHaveAttribute('content', '描述')
    expect(document.head.querySelector('meta[property="og:url"]')).toHaveAttribute('content', 'https://x.com/p')
    expect(document.head.querySelector('meta[property="og:type"]')).toHaveAttribute('content', 'website')
  })

  it('og 块激活时 twitter:title/description 镜像；无 ogImage 则无 twitter:card/image', () => {
    render(<Probe title="页题" description="描述" />)
    expect(document.head.querySelector('meta[name="twitter:title"]')).toHaveAttribute('content', '页题')
    expect(document.head.querySelector('meta[name="twitter:description"]')).toHaveAttribute('content', '描述')
    expect(document.head.querySelector('meta[name="twitter:card"]')).toBeNull()
    expect(document.head.querySelector('meta[name="twitter:image"]')).toBeNull()
  })

  it('显式 og* 字段覆盖镜像值；ogType 覆写默认', () => {
    render(
      <Probe
        title="页题"
        description="描述"
        ogTitle="社媒题"
        ogDescription="社媒描述"
        ogUrl="https://x.com/social"
        ogType="article"
        twitterSite="@brand"
      />,
    )
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute('content', '社媒题')
    expect(document.head.querySelector('meta[property="og:description"]')).toHaveAttribute('content', '社媒描述')
    expect(document.head.querySelector('meta[property="og:url"]')).toHaveAttribute('content', 'https://x.com/social')
    expect(document.head.querySelector('meta[property="og:type"]')).toHaveAttribute('content', 'article')
    expect(document.head.querySelector('meta[name="twitter:site"]')).toHaveAttribute('content', '@brand')
  })

  it('ogImage 附带 twitter:image，twitter:title/description 照常镜像', () => {
    render(<Probe title="页题" description="描述" ogImage="/cover.png" />)
    expect(document.head.querySelector('meta[name="twitter:image"]')).toHaveAttribute('content', '/cover.png')
    expect(document.head.querySelector('meta[name="twitter:title"]')).toHaveAttribute('content', '页题')
    expect(document.head.querySelector('meta[name="twitter:description"]')).toHaveAttribute('content', '描述')
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute('content', '页题')
  })

  it('仅 ogType 也能激活 og 块（其余四要素缺省不落）', () => {
    render(<Probe ogType="website" />)
    expect(document.head.querySelector('meta[property="og:type"]')).toHaveAttribute('content', 'website')
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull()
    expect(document.head.querySelector('meta[name="twitter:title"]')).toBeNull()
  })
})

describe('useSEO F-3 og 增强字段（site_name / locale / image 子标签）', () => {
  it('ogSiteName/ogLocale 存在即发：og:site_name / og:locale', () => {
    render(<Probe title="页题" ogSiteName="MyProduct" ogLocale="zh_CN" />)
    expect(document.head.querySelector('meta[property="og:site_name"]')).toHaveAttribute(
      'content', 'MyProduct',
    )
    expect(document.head.querySelector('meta[property="og:locale"]')).toHaveAttribute('content', 'zh_CN')
  })

  it('ogImage 存在时 ogImageAlt/Width/Height 随图发出（尺寸序列化为像素数字串）', () => {
    render(
      <Probe
        title="页题"
        ogImage="/cover.png"
        ogImageAlt="产品封面图"
        ogImageWidth={1200}
        ogImageHeight={630}
      />,
    )
    expect(document.head.querySelector('meta[property="og:image:alt"]')).toHaveAttribute(
      'content', '产品封面图',
    )
    expect(document.head.querySelector('meta[property="og:image:width"]')).toHaveAttribute(
      'content', '1200',
    )
    expect(document.head.querySelector('meta[property="og:image:height"]')).toHaveAttribute(
      'content', '630',
    )
    // 原有 og:image 透传不回归（绝对化归 Go 层，hook 原样透传）。
    expect(document.head.querySelector('meta[property="og:image"]')).toHaveAttribute('content', '/cover.png')
  })

  it('无 ogImage 时 ogImageAlt/Width/Height 不发（alt/尺寸不落成无图孤儿标签）', () => {
    render(
      <Probe
        title="页题"
        description="描述"
        ogImageAlt="孤儿 alt"
        ogImageWidth={1200}
        ogImageHeight={630}
      />,
    )
    expect(document.head.querySelector('meta[property="og:image"]')).toBeNull()
    expect(document.head.querySelector('meta[property="og:image:alt"]')).toBeNull()
    expect(document.head.querySelector('meta[property="og:image:width"]')).toBeNull()
    expect(document.head.querySelector('meta[property="og:image:height"]')).toBeNull()
    // og 块本身照常激活，其余字段不受影响。
    expect(document.head.querySelector('meta[property="og:title"]')).toHaveAttribute('content', '页题')
  })

  it('仅 ogSiteName（或仅 ogLocale）也能激活 og 块——存在即发的字面语义', () => {
    render(<Probe ogSiteName="MyProduct" />)
    expect(document.head.querySelector('meta[property="og:site_name"]')).toHaveAttribute(
      'content', 'MyProduct',
    )
    expect(document.head.querySelector('meta[property="og:title"]')).toBeNull()
    expect(document.head.querySelector('meta[property="og:type"]')).toHaveAttribute('content', 'website')
  })

  it('新字段不进 twitter 镜像：twitter:* 组不含 site_name/locale 对应物', () => {
    render(<Probe title="页题" description="描述" ogSiteName="MyProduct" ogLocale="zh_CN" />)
    const twitterNames = [...document.head.querySelectorAll('meta[name^="twitter:"]')].map((m) =>
      m.getAttribute('name'),
    )
    expect(twitterNames).toEqual(['twitter:title', 'twitter:description'])
  })
})
