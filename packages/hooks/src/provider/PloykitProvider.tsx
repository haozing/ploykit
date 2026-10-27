
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, setWorkspaceIdProvider } from '@ploykit/client'
import { fetchMeNullable } from '../hooks/useAuthState'
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



export function PloykitProvider({ children, queryClient, workspaceHeaderSource }: {
  children: ReactNode

  queryClient?: QueryClient
  /** X-Workspace-Id 请求头的真相归属（orkome 采纳报告 #1）：
   *  'kit'（默认）——Provider 把自身 current 工作区注册进 @ploykit/client 的
   *  全局 workspaceIdProvider；消费方必须用 kit 的 switchTo 切换工作区，自行
   *  维护切换状态会让 kit 的陈旧 current 覆盖消费方的真相（串数据）。
   *  'consumer'——Provider 完全不注册，消费方自行调
   *  setWorkspaceIdProvider(自己的 getter)，切换语义归消费方。 */
  workspaceHeaderSource?: 'kit' | 'consumer'
}) {
  const [qc] = useState(() => queryClient ?? createDefaultQueryClient())



  useEffect(() => {
    qc.setQueryDefaults(queryKeys.admin, { staleTime: 0 })
  }, [qc])
  return (
    <QueryClientProvider client={qc}>
      <AuthLayer>
        <WorkspaceLayer workspaceHeaderSource={workspaceHeaderSource ?? 'kit'}>{children}</WorkspaceLayer>
      </AuthLayer>
    </QueryClientProvider>
  )
}



function AuthLayer({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  
  
  const meQ = useQuery({
    queryKey: queryKeys.me,
    queryFn: fetchMeNullable,
  })

  // 登录态门控（2026-10-25 上游 issue #2）：/auth/me 探针确认登录后才拉工作区
  // 列表。匿名（queryFn 把 401 吞成 data=null，非 error 态）与探针 pending
  // （data=undefined）都必须挡住——cookie 型会话客户端无本地 token 可判，
  // 匿名访客（公开营销页/预渲染壳全站挂本 Provider）原实现每载必白发一条
  // /api/workspaces 401，浏览器网络层红字 JS 无法抑制，唯一出路是"不发"。
  const authed = meQ.data != null
  const wsQ = useQuery({
    queryKey: queryKeys.workspaceList,
    enabled: authed,
    queryFn: () =>
      api.get<PKWorkspace[]>('/api/workspaces').catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 401) return [] as PKWorkspace[]
        throw err
      }),
  })

  // 隐性过期兜底：cookie 失效但未走显式 logout 时，me 探针翻转为 null 后 wsQ
  // 已被门控 disable，但 queryCache 里旧的工作区列表会残留（workspaces 继续
  // 暴露过期数据）。显式 logout 路径已有 removeQueries() 全量兜底，这里只补
  // list 键：用 remove 而非 setQueryData([])，否则重新登录时 [] 若仍在
  // staleTime 窗口内会被当作新鲜数据而不重拉（空列表假象）。
  useEffect(() => {
    if (meQ.data === null) {
      qc.removeQueries({ queryKey: queryKeys.workspaceList })
    }
  }, [meQ.data, qc])

  const user = meQ.data ?? null
  const workspaces = Array.isArray(wsQ.data) ? wsQ.data : []
  // wsQ 被 disable 时 v5 语义是 status 恒 'pending'（isPending 恒 true）——匿名
  // 态不能把 loading 卡死成永远 true（消费方拿 loading 渲染全页 spinner），
  // 故仅登录态把 wsQ 计入 loading。
  const loading = meQ.isPending || (authed && wsQ.isPending)

  
  
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
    loading,
    error: meQ.error ?? wsQ.error ?? null,
    refresh,
    logout,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, workspaces, loading, meQ.error, wsQ.error, refresh, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function WorkspaceLayer({ children, workspaceHeaderSource }: {
  children: ReactNode
  workspaceHeaderSource: 'kit' | 'consumer'
}) {
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

  // 全局 workspace 头注册（orkome 采纳报告 #1）：仅 workspaceHeaderSource==='kit'
  // 时注册，且仅在 current.id 变化时写入（含首次与清空）——渲染期不再无条件
  // last-write-wins 覆盖。useLayoutEffect 保证同一提交内子层的 effect / 请求
  // 发起时读到的已是新 id（时序语义与旧实现一致，由 WorkspaceLayer.test.tsx
  // 锁死）。'consumer' 模式完全不注册：消费方自行 setWorkspaceIdProvider，
  // 切换真相归消费方，kit 的 current 不再覆盖消费方注册。
  const headerId = workspaceHeaderSource === 'kit' ? current?.id ?? null : null
  const registeredHeaderId = useRef<string | null | undefined>(undefined)
  useLayoutEffect(() => {
    if (workspaceHeaderSource !== 'kit') {
      // 中途切到 consumer 模式：撤回自己的注册，把全局缝让给消费方。
      if (registeredHeaderId.current !== undefined) {
        registeredHeaderId.current = undefined
        setWorkspaceIdProvider(() => null)
      }
      return
    }
    if (registeredHeaderId.current === headerId) return
    registeredHeaderId.current = headerId
    setWorkspaceIdProvider(() => headerId)
  }, [headerId, workspaceHeaderSource])

  // 卸载时清掉自己的注册，避免留下指向已卸载树状态的陈旧 getter。
  useEffect(() => {
    return () => {
      if (registeredHeaderId.current !== undefined) {
        setWorkspaceIdProvider(() => null)
        registeredHeaderId.current = undefined
      }
    }
  }, [])

  
  
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
