import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@ploykit/client'
import type { PKUser } from '../provider/PloykitProvider'

/**
 * GET /auth/me 匿名归一化（hooks 0.9.3 起）：服务端对匿名访客返回
 * 200 {authenticated:false}（「未登录」是正常答案而非错误状态——401 在浏览器
 * 网络层是硬错误且无法被 fetch 抑制，应用壳的每访客探测曾对 Best Practices
 * 审计全站亮红，shuijing 生产实锤 2026-10-27）。旧服务（或版本偏差窗口）的
 * 401 也归一为 null。useAuthState 与 PloykitProvider.AuthLayer 两个消费点
 * 共用，保证同一个 queryKey 下的数据形状恒为 PKUser | null。
 */
export interface AnonymousMe {
  authenticated: false
}

function isAnonymousMe(v: unknown): v is AnonymousMe {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { authenticated?: unknown }).authenticated === false
  )
}

export async function fetchMeNullable(): Promise<PKUser | null> {
  const res = await api.get<PKUser | AnonymousMe | null>('/auth/me').catch(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    },
  )
  return isAnonymousMe(res) ? null : (res as PKUser | null)
}

/**
 * Provider-free auth state (renderx-walk #5 companion): reads /auth/me with
 * its own react-query key, no PloykitProvider required. For product-side
 * chrome OUTSIDE AppShell (SiteNav, marketing headers) that previously had
 * to hand-roll the same fetch the provider does. Inside AppShell keep
 * useAuth() (the context also carries workspaces/refresh/logout and stays
 * the single session source); this hook intentionally shares the queryKey
 * so the two views never diverge.
 */
export function useAuthState() {
  const q = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchMeNullable,
  })
  return { user: q.data ?? null, loading: q.isPending, error: q.error }
}
