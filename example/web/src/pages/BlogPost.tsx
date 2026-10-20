
import { useState } from 'react'
import { useSEO } from '@ploykit/hooks'
import { isApiError } from '@ploykit/client'
import { SignInModal, Button, toast, apiErrorMessage } from '@ploykit/ui'
import { apiFetch } from '@ploykit/client'
import { Link, useLocation, useNavigate } from '@tanstack/react-router'


export interface BlogPostData {
  slug: string
  title: string
  excerpt: string
  content: string
}

export function BlogPost({ post }: { post: BlogPostData }) {
  useSEO({
    title: post.title,
    description: post.excerpt,
    canonical: `/blog/${post.slug}`,
  })

  // ---- In-flow sign-in（框架 SignInModal 的产品接线）----
  // 「收藏到任务列表」是登录后动作。未登录点收藏不跳走（保住阅读上下文）：
  // 服务端 401 E_UNAUTHENTICATED 时就地弹 SignInModal。以服务端错误为唯一
  // 判定（useAuth 在公开页首帧 loading，拿它判定有匿名/已登录竞态）。
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [signInOpen, setSignInOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const collect = async () => {
    setSaving(true)
    try {
      await apiFetch('/api/tasks', {
        method: 'POST',
        body: { title: `阅读文章：${post.title}` },
      })
      setSaved(true)
      toast.success('已收藏到任务列表')
    } catch (err: unknown) {
      if (isApiError(err, 'E_UNAUTHENTICATED')) {
        // SignInModal 成功后整页硬跳转 location.state.from（loginRedirectTarget
        // 守卫，缺省 /app）。原地 replace 写入 from（URL 与路由匹配不变、组件
        // 不重挂），登录后回到本文页 —— 与全站 Protected/Navigate 的 from 约定一致。
        await navigate({
          to: pathname,
          state: { from: pathname } as never, // TanStack ParsedHistoryState 受键约束，同 routes.tsx 的 as never
          replace: true,
        })
        setSignInOpen(true)
        return
      }
      toast.error(apiErrorMessage(err, '收藏失败，请稍后重试'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="min-h-screen bg-white">
      <article className="max-w-3xl mx-auto px-4 py-16">
        <p className="text-sm text-gray-400 mb-2">
          <Link to="/" className="hover:text-gray-600">← 返回首页</Link>
        </p>
        <h1 className="text-4xl font-bold text-gray-900 tracking-tight">{post.title}</h1>
        <p className="mt-4 text-lg text-gray-500">{post.excerpt}</p>
        <div className="mt-8 text-base leading-7 text-gray-700 whitespace-pre-line">{post.content}</div>
        <div className="mt-10 pt-6 border-t border-border">
          <Button onClick={() => void collect()} disabled={saving || saved}>
            {saved ? '已收藏' : saving ? '收藏中…' : '收藏到任务列表'}
          </Button>
        </div>
      </article>
      <SignInModal
        open={signInOpen}
        onOpenChange={setSignInOpen}
        passwordOnly
        title="登录后继续"
        description="登录以收藏文章到你的任务列表"
      />
    </main>
  )
}
