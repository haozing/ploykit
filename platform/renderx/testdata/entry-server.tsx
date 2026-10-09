












import * as React from 'react'
import { renderToString } from 'react-dom/server.browser'
import { StaticRouter, Routes, Route, useParams } from 'react-router'

type HeadEntry = {
  tag: string
  attrs?: Record<string, string>
  children?: string
}



function useSEO(entries: HeadEntry[]): void {
  const host = (globalThis as { __ploykit_host__?: { directive: (kind: string, payload: unknown) => void } })
    .__ploykit_host__
  host?.directive('head', entries)
}


let renderProps: Record<string, unknown> = {}

function Landing() {
  useSEO([
    { tag: 'title', children: 'Ploykit — Go monolith' },
    { tag: 'meta', attrs: { name: 'description', content: 'SSG without Node' } },
  ])
  return (
    <main data-page="landing">
      <h1>Ploykit</h1>
      <p>Full-stack Go with embedded SSR.</p>
    </main>
  )
}

function Pricing() {
  return (
    <main data-page="pricing">
      <h1>Pricing</h1>
      <ul>
        <li>Starter — $0</li>
        <li>Pro — $29/mo</li>
      </ul>
    </main>
  )
}

function BlogPost() {
  const { slug } = useParams()
  const post = (renderProps['post'] as {
    title: string
    excerpt: string
    content: string
    cover?: string
  }) ?? { title: 'Untitled', excerpt: '', content: '' }
  useSEO([
    { tag: 'title', children: post.title },
    { tag: 'meta', attrs: { name: 'description', content: post.excerpt } },
    { tag: 'meta', attrs: { property: 'og:image', content: post.cover ?? '' } },
  ])
  return (
    <article data-page="blog-post">
      <h1>{post.title}</h1>
      <p data-slug>{slug}</p>
      <section data-content>{post.content}</section>
    </article>
  )
}


function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/pricing" element={<Pricing />} />
      <Route path="/blog/:slug" element={<BlogPost />} />
    </Routes>
  )
}

const g = globalThis as {
  __ploykit_directives__?: Array<{ kind: string; payload: unknown }>
  __ploykit_render__: (pageId: string, location: string, propsJson: string) => {
    html: string
    directives: Array<{ kind: string; payload: unknown }>
  }
  __ploykit_routes__: () => string
}

g.__ploykit_render__ = (_pageId: string, location: string, propsJson: string) => {
  renderProps = propsJson ? (JSON.parse(propsJson) as Record<string, unknown>) : {}
  g.__ploykit_directives__ = [] 
  const html = renderToString(
    <StaticRouter location={location}>
      <AppRoutes />
    </StaticRouter>,
  )
  const directives = (g.__ploykit_directives__ ?? []).slice()
  return { html, directives }
}

g.__ploykit_routes__ = () =>
  JSON.stringify([
    { path: '/', pageId: 'landing', render: 'static' },
    { path: '/pricing', pageId: 'pricing', render: 'static' },
    { path: '/blog/:slug', pageId: 'blog-post', render: 'static' },
  ])
