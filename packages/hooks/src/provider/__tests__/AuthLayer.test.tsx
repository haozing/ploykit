import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'




const apiMocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }))
vi.mock('@ploykit/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ploykit/client')>()
  return {
    ...mod,
    api: {
      get: apiMocks.get,
      post: apiMocks.post,
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  }
})

import { ApiError } from '@ploykit/client'
import { PloykitProvider } from '../PloykitProvider'
import { useAuth } from '../../hooks/useAuth'
import { useWorkspace } from '../../hooks/useWorkspace'

type Ws = { id: string; name: string; slug: string }

function AuthProbe({ onReady }: { onReady?: () => void }) {
  const { user, workspaces, loading, error, logout } = useAuth()
  const { current, switchTo } = useWorkspace()
  const qc = useQueryClient()
  return (
    <div>
      <div data-testid="user">{user ? user.email : 'null'}</div>
      <div data-testid="workspaces">{workspaces.map((w) => w.id).join(',') || 'empty'}</div>
      <div data-testid="loading">{loading ? 'yes' : 'no'}</div>
      <div data-testid="error">{error ? String((error as Error).message) : 'none'}</div>
      <div data-testid="current">{current ? current.id : 'null'}</div>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => void qc.invalidateQueries()}>refresh-all</button>
      <button onClick={() => onReady?.()}>ready</button>
    </div>
  )
}


function CacheProbe() {
  const q = useQuery({
    queryKey: ['sessions', 'mine'],
    queryFn: () => apiMocks.get('/api/sessions') as Promise<unknown>,
  })
  return <div data-testid="cache">{q.data === undefined ? 'none' : 'cached'}</div>
}


function renderApp(ui: React.ReactNode) {
  return render(
    <PloykitProvider queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {ui}
    </PloykitProvider>,
  )
}

const userBody = { email: 'u@x.test' } as never
const ws = (id: string): Ws => ({ id, name: id, slug: id })

function meOk() {
  return (url: string) => {
    if (url === '/auth/me') return Promise.resolve(userBody)
    if (url === '/api/workspaces') return Promise.resolve([])
    return Promise.reject(new Error(`unexpected ${url}`))
  }
}

beforeEach(() => {
  apiMocks.get.mockReset()
  apiMocks.post.mockReset().mockResolvedValue(undefined)
})

describe('AuthLayer FT-D2 分流', () => {
  it('401：me → user null、workspaces → []，不算错误', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject(new ApiError(401, 'E_UNAUTHENTICATED', 'unauthenticated'))
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    renderApp(<AuthProbe />)
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('null'))
    expect(screen.getByTestId('workspaces').textContent).toBe('empty')
    expect(screen.getByTestId('error').textContent).toBe('none')
    // 门控后匿名只发 me 探针一条：/api/workspaces 不再被无条件拉取
    expect(apiMocks.get.mock.calls.map((c) => c[0])).toEqual(['/auth/me'])
  })

  it('非 401（如 500）：错误经 error 暴露，不伪装成未登录', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject(new ApiError(500, 'E_INTERNAL', 'internal error'))
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    renderApp(<AuthProbe />)
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('internal error'))
    expect(screen.getByTestId('user').textContent).toBe('null')
  })

  it('网络层异常（TypeError）：同样上抛不吞', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject(new TypeError('fetch failed'))
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    renderApp(<AuthProbe />)
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('fetch failed'))
  })
})

describe('logout/refresh 语义（P2-10）', () => {
  it('logout：POST /auth/logout 且全量清缓存（sessions 等非 auth 键一并消失）', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve(userBody)
      if (url === '/api/workspaces') return Promise.resolve([ws('a')])
      if (url === '/api/sessions') return Promise.resolve([{ id: 's-1' }])
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <PloykitProvider queryClient={qc}>
        <AuthProbe />
        <CacheProbe />
      </PloykitProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('cache').textContent).toBe('cached'))
    // 门控后列表是 me 之后的串行一跳，current 到位需等列表到达（原并行假设不再成立）
    await waitFor(() => expect(screen.getByTestId('current')).toHaveTextContent('a'))
    
    expect(qc.getQueryData(['sessions', 'mine'])).toEqual([{ id: 's-1' }])
    expect(qc.getQueryData(['auth', 'me'])).toEqual(userBody)

    
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject(new ApiError(401, 'E_UNAUTHENTICATED', 'unauthenticated'))
      if (url === '/api/workspaces') return Promise.resolve([])
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    await act(async () => {
      screen.getByRole('button', { name: 'logout' }).click()
    })

    expect(apiMocks.post).toHaveBeenCalledWith('/auth/logout')
    
    
    
    
    await waitFor(() => expect(qc.getQueryData(['sessions', 'mine'])).toBeUndefined())
    await waitFor(() => expect(qc.getQueryData(['auth', 'me']) ?? null).toBeNull())
    
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('null'))
  })

  it('refresh：invalidate auth/workspace 前缀，重新拉取 me 与列表', async () => {
    let meCalls = 0
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') {
        meCalls += 1
        return Promise.resolve(meCalls === 1 ? userBody : ({ email: 'u2@x.test' } as never))
      }
      if (url === '/api/workspaces') return Promise.resolve([ws('a')])
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    renderApp(<AuthProbe />)
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('u@x.test'))

    await act(async () => {
      screen.getByRole('button', { name: 'refresh-all' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('u2@x.test'))
  })
})

describe('stale currentId 回收（P2-9）', () => {
  it('当前工作区被移出列表：current 回落 workspaces[0]，不残留 null 死局', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve(userBody)
      if (url === '/api/workspaces') return Promise.resolve([ws('a'), ws('b')])
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    renderApp(<AuthProbe />)
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('a'))

    
    await act(async () => {
      
      
      apiMocks.get.mockImplementation((url: string) => {
        if (url === '/auth/me') return Promise.resolve(userBody)
        if (url === '/api/workspaces') return Promise.resolve([ws('a')])
        return Promise.reject(new Error(`unexpected ${url}`))
      })
      screen.getByRole('button', { name: 'refresh-all' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('workspaces').textContent).toBe('a'))
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('a'))
  })

  it('列表清空：current 回落 null', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve(userBody)
      if (url === '/api/workspaces') return Promise.resolve([ws('a')])
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    renderApp(<AuthProbe />)
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('a'))

    apiMocks.get.mockImplementation(meOk())
    await act(async () => {
      screen.getByRole('button', { name: 'refresh-all' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('null'))
  })
})

describe('工作区列表登录态门控（2026-10-25 上游 issue #2）', () => {
  it('匿名：只发 /auth/me 探针，loading 收敛 false 不被 disable 态卡死', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject(new ApiError(401, 'E_UNAUTHENTICATED', 'unauthenticated'))
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    renderApp(<AuthProbe />)
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('null'))
    // v5 里 disabled query 的 status 恒 'pending'——loading 必须绕过 wsQ 收敛
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('no'))
    expect(apiMocks.get.mock.calls.map((c) => c[0])).toEqual(['/auth/me'])
  })

  it('登录态：me 探针返回用户后才发 /api/workspaces（串行一跳）', async () => {
    let resolveMe!: (v: unknown) => void
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return new Promise((r) => { resolveMe = r })
      if (url === '/api/workspaces') return Promise.resolve([ws('a')])
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    renderApp(<AuthProbe />)
    // me 未决期间（data=undefined）：门控关闭，不预发列表请求
    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledTimes(1))
    expect(apiMocks.get.mock.calls[0][0]).toBe('/auth/me')

    await act(async () => {
      resolveMe(userBody)
    })
    await waitFor(() => expect(screen.getByTestId('workspaces').textContent).toBe('a'))
    expect(screen.getByTestId('loading').textContent).toBe('no')
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('a'))
  })

  it('隐性过期（cookie 失效但未显式 logout）：me 翻转 null 后清 list 缓存，workspaces 不残留', async () => {
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.resolve(userBody)
      if (url === '/api/workspaces') return Promise.resolve([ws('a'), ws('b')])
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <PloykitProvider queryClient={qc}>
        <AuthProbe />
      </PloykitProvider>,
    )
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('a'))
    expect(qc.getQueryData(['workspace', 'list'])).toEqual([ws('a'), ws('b')])

    // 会话隐性过期：me 与列表都 401（列表即便旧缓存也翻不出登录态）
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject(new ApiError(401, 'E_UNAUTHENTICATED', 'unauthenticated'))
      if (url === '/api/workspaces') return Promise.reject(new ApiError(401, 'E_UNAUTHENTICATED', 'unauthenticated'))
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    await act(async () => {
      screen.getByRole('button', { name: 'refresh-all' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('null'))
    // 门控 + 清缓存：列表缓存被移除（remove 而非 setQueryData，重登录才不会
    // 拿 staleTime 窗口内的空数组当新鲜数据），workspaces 归空、loading 收敛
    await waitFor(() => expect(qc.getQueryData(['workspace', 'list'])).toBeUndefined())
    expect(screen.getByTestId('workspaces').textContent).toBe('empty')
    expect(screen.getByTestId('current').textContent).toBe('null')
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('no'))
  })
})
