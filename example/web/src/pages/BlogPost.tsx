
import { useSEO } from '@ploykit/hooks'
import { Link } from 'react-router-dom'


export interface BlogPostData {
  slug: string
  title: string
  excerpt: string
  content: string
}

export function BlogPost({ post }: { post: BlogPostData }) {
  useSEO({ title: post.title, description: post.excerpt })
  return (
    <main className="min-h-screen bg-white">
      <article className="max-w-3xl mx-auto px-4 py-16">
        <p className="text-sm text-gray-400 mb-2">
          <Link to="/" className="hover:text-gray-600">← 返回首页</Link>
        </p>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">{post.title}</h1>
        <p className="mt-4 text-lg text-gray-500">{post.excerpt}</p>
        <div className="mt-8 text-base leading-7 text-gray-700 whitespace-pre-line">{post.content}</div>
      </article>
    </main>
  )
}
