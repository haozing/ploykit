
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, setWorkspaceIdProvider } from '@ploykit/client'
import type {
  APIUser, APIWorkspace, APISubscription, APIOrder, APIPlan,
} from '@ploykit/client'



export const queryKeys = {
  auth: ['auth'] as const,
  me: ['auth', 'me'] as const,
  sessions: ['auth', 'sessions'] as const,
  tokens: ['auth', 'tokens'] as const,
  workspace: ['workspace'] as const,
  workspaceList: ['workspace', 'list'] as const,
  members: (wsId: string) => ['workspace', wsId, 'members'] as const,
  invitations: (wsId: string) => ['workspace', wsId, 'invitations'] as const,
  shareLinks: (wsId: string) => ['workspace', wsId, 'share-links'] as const,
  roleConfig: (wsId: string) => ['workspace', wsId, 'role-config'] as const,
  
  
  
  myInvitations: ['workspace', 'my-invitations'] as const,
  audit: (wsId: string, q: object) => ['audit', wsId, q] as const,
  usage: (wsId: string) => ['usage', wsId] as const,
  billing: ['billing'] as const,
  billingSubscription: (workspaceId: string) => ['billing', 'subscription', workspaceId] as const,
  billingPlans: ['billing', 'plans'] as const,
  notifications: ['notifications'] as const, // 元组：可作前缀失效（原为裸字符串）
  notificationPrefs: ['notifications', 'preferences'] as const,
  webhooks: (wsId: string) => ['webhooks', wsId] as const,
  admin: ['admin'] as const,
}

function createDefaultQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        
        
        retry: (failureCount, error) => {
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false
          return failureCount < 1
        },
        refetchOnWindowFocus: false,
      },
    },
  })
}












const WS_URL_PARAM = 'ws'


const wsStorageKey = (userId: string) => `pk.ws.${userId}`

function readWsIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return new URLSearchParams(window.location.search).get(WS_URL_PARAM) || null
  } catch {
    return null
  }
}

function writeWsIdToUrl(id: string): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    url.searchParams.set(WS_URL_PARAM, id)
    
    
    window.history.replaceState(window.history.state, '', url.href)
  } catch {
    /* 受限环境降级：仅不写 URL，上下文本体不受影响 */
  }
}

function removeWsIdFromUrl(): void {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has(WS_URL_PARAM)) return
    url.searchParams.delete(WS_URL_PARAM)
    window.history.replaceState(window.history.state, '', url.href)
  } catch {
    /* 同上：静默降级 */
  }
}

function readStoredWsId(userId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(wsStorageKey(userId)) || null
  } catch {
    return null
  }
}

function writeStoredWsId(userId: string, id: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(wsStorageKey(userId), id)
  } catch {
    /* localStorage 不可用（隐私模式/配额）：降级为内存 + URL 两层 */
  }
}

function removeStoredWsId(userId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(wsStorageKey(userId))
  } catch {
    /* 静默降级 */
  }
}






export type PKUser = APIUser
export type PKWorkspace = APIWorkspace
export type PKSubscription = APISubscription
export type PKOrder = APIOrder
export type PKPlan = APIPlan



export interface AuthContextValue {
  user: PKUser | null; workspaces: PKWorkspace[]; loading: boolean;
  
  error: unknown;
  refresh(): Promise<void>; logout(): Promise<void>;
}
export const AuthContext = createContext<AuthContextValue | null>(null)



export interface WorkspaceContextValue {
  current: PKWorkspace | null;
  switchTo(id: string): void; clear(): void;
}
export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)



export function useAuthCtx(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('must be used within PloykitProvider')
  return ctx
}
export function useWorkspaceCtx(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('must be used within PloykitProvider')
  return ctx
}



export function PloykitProvider({ children, queryClient }: {
  children: ReactNode
  
  queryClient?: QueryClient
}) {
  const [qc] = useState(() => queryClient ?? createDefaultQueryClient())
  
  
  
  useEffect(() => {
    qc.setQueryDefaults(queryKeys.admin, { staleTime: 0 })
  }, [qc])
  return (
    <QueryClientProvider client={qc}>
      <AuthLayer>
        <WorkspaceLayer>{children}</WorkspaceLayer>
      </AuthLayer>
    </QueryClientProvider>
  )
}



function AuthLayer({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  
  
  const meQ = useQuery({
    queryKey: queryKeys.me,
    queryFn: () =>
      api.get<PKUser | null>('/auth/me').catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }),
  })
  const wsQ = useQuery({
    queryKey: queryKeys.workspaceList,
    queryFn: () =>
      api.get<PKWorkspace[]>('/api/workspaces').catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return [] as PKWorkspace[]
        throw err
      }),
  })

  const user = meQ.data ?? null
  const workspaces = Array.isArray(wsQ.data) ? wsQ.data : []

  
  
  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.auth }),
      qc.invalidateQueries({ queryKey: queryKeys.workspace }),
    ])
  }, [qc])

  const logout = useCallback(async () => {
    
    
    
    
    const me = qc.getQueryData<PKUser | null>(queryKeys.me)
    if (me?.id) removeStoredWsId(me.id)
    await api.post('/auth/logout').catch(() => {})
    
    
    
    
    
    
    
    qc.setQueryData(queryKeys.me, null)
    qc.setQueryData(queryKeys.workspaceList, [])
    qc.removeQueries()
  }, [qc])

  
  
  
  
  const value = useMemo<AuthContextValue>(() => ({
    user,
    workspaces,
    loading: meQ.isPending || wsQ.isPending,
    error: meQ.error ?? wsQ.error ?? null,
    refresh,
    logout,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, workspaces, meQ.isPending, wsQ.isPending, meQ.error, wsQ.error, refresh, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function WorkspaceLayer({ children }: { children: ReactNode }) {
  const { user, workspaces } = useAuthCtx()
  const [currentId, setCurrentId] = useState<string | null>(null)
  const userId = user?.id

  
  
  
  
  
  
  
  
  useEffect(() => {
    if (!user || workspaces.length === 0 || currentId) return
    const uid = user.id
    const candidate = readWsIdFromUrl() ?? (uid ? readStoredWsId(uid) : null)
    if (candidate && workspaces.some((ws) => ws.id === candidate)) {
      setCurrentId(candidate)
      
      if (uid) writeStoredWsId(uid, candidate)
      return
    }
    if (candidate) {
      if (uid) removeStoredWsId(uid)
      removeWsIdFromUrl()
    }
    setCurrentId(workspaces[0].id)
  }, [user, workspaces, currentId])

  
  
  
  
  useEffect(() => {
    if (currentId && !workspaces.some((ws) => ws.id === currentId)) {
      setCurrentId(workspaces[0]?.id ?? null)
      if (userId) removeStoredWsId(userId)
      removeWsIdFromUrl()
    }
  }, [workspaces, currentId, userId])

  
  
  
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onPopState = () => {
      const urlId = readWsIdFromUrl()
      if (!urlId) return
      setCurrentId((prev) => (prev === urlId ? prev : urlId))
      if (userId) writeStoredWsId(userId, urlId)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [userId])

  
  
  
  
  
  
  
  
  
  const current = workspaces.find((ws) => ws.id === currentId) ?? null
  setWorkspaceIdProvider(() => current?.id ?? null)

  
  
  const switchTo = useCallback((id: string) => {
    setCurrentId(id)
    if (userId) writeStoredWsId(userId, id)
    writeWsIdToUrl(id)
  }, [userId])

  
  
  
  const clear = useCallback(() => {
    setCurrentId(null)
    if (userId) removeStoredWsId(userId)
    removeWsIdFromUrl()
  }, [userId])

  
  const value = useMemo<WorkspaceContextValue>(() => ({
    current,
    switchTo,
    clear,
  }), [current, switchTo, clear])
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}
