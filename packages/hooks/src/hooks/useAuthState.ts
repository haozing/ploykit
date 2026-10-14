import { useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@ploykit/client'
import type { PKUser } from '../provider/PloykitProvider'

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
    queryFn: () =>
      api.get<PKUser | null>('/auth/me').catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }),
  })
  return { user: q.data ?? null, loading: q.isPending, error: q.error }
}
