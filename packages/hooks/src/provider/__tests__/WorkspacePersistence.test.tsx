import '@testing-library/jest-dom/vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, useQueryClient } from '@tanstack/react-query'
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
const ws = (id: string): Ws => ({ id, name: id, slug: id })

function PersistenceProbe() {
  const { user, logout } = useAuth()
  const { current, switchTo } = useWorkspace()
  const qc = useQueryClient()
  return (
    <div>
      <div data-testid="user">{user ? user.id : 'null'}</div>
      <div data-testid="current">{current ? current.id : 'null'}</div>
      <button onClick={() => switchTo('ws-2')}>switch-ws-2</button>
      <button onClick={() => switchTo('ws-a')}>switch-ws-a</button>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => void qc.invalidateQueries()}>refresh-all</button>
    </div>
  )
}

function renderApp() {
  return render(
    <PloykitProvider queryClient={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <PersistenceProbe />
    </PloykitProvider>,
  )
}


function urlWs(): string | null {
  return new URLSearchParams(window.location.search).get('ws')
}

beforeEach(() => {
  apiMocks.get.mockReset()
  apiMocks.post.mockReset().mockResolvedValue(undefined)
  window.localStorage.clear()
  window.history.replaceState(null, '', '/')
})

function mockUser(userId: string, list: Ws[]) {
  apiMocks.get.mockImplementation((url: string) => {
    if (url === '/auth/me') return Promise.resolve({ id: userId, email: `${userId}@x.test` })
    if (url === '/api/workspaces') return Promise.resolve(list)
    return Promise.reject(new Error(`unexpected ${url}`))
  })
}

describe('G3 初始化优先级：URL > localStorage > workspaces[0]', () => {
  it('URL ?ws= 命中（且压过 localStorage）→ 选中该区并落存储', async () => {
    window.history.replaceState(null, '', '/settings/workspace/general?ws=ws-2')
    
    window.localStorage.setItem('pk.ws.u1', 'ws-1')
    mockUser('u1', [ws('ws-1'), ws('ws-2')])
    renderApp()

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-2'))
    
    expect(window.localStorage.getItem('pk.ws.u1')).toBe('ws-2')
  })

  it('无 URL 参数 → localStorage pk.ws.<uid> 兜底恢复', async () => {
    window.localStorage.setItem('pk.ws.u1', 'ws-2')
    mockUser('u1', [ws('ws-1'), ws('ws-2')])
    renderApp()

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-2'))
  })

  it('两层载体均无 → workspaces[0]', async () => {
    mockUser('u1', [ws('ws-1'), ws('ws-2')])
    renderApp()

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-1'))
  })
})

describe('G3 失效回落与清理（不在列表 = 被删/被移出/无权限）', () => {
  it('localStorage 指向已失效工作区 → 回落 workspaces[0] 并清存储', async () => {
    window.localStorage.setItem('pk.ws.u1', 'ws-gone')
    mockUser('u1', [ws('ws-1'), ws('ws-2')])
    renderApp()

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-1'))
    expect(window.localStorage.getItem('pk.ws.u1')).toBeNull()
  })

  it('URL ?ws= 指向已失效工作区 → 回落 workspaces[0] 并清 URL 参数', async () => {
    window.history.replaceState(null, '', '/settings?ws=ws-gone')
    mockUser('u1', [ws('ws-1'), ws('ws-2')])
    renderApp()

    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-1'))
    expect(urlWs()).toBeNull()
  })
})

describe('G3 switchTo/clear 载体同步', () => {
  it('switchTo 同时写 localStorage 与 URL query', async () => {
    mockUser('u1', [ws('ws-1'), ws('ws-2')])
    renderApp()
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-1'))

    await act(async () => {
      screen.getByRole('button', { name: 'switch-ws-2' }).click()
    })
    expect(screen.getByTestId('current').textContent).toBe('ws-2')
    expect(window.localStorage.getItem('pk.ws.u1')).toBe('ws-2')
    expect(urlWs()).toBe('ws-2')
  })

  it('当前工作区被移出列表（P2-9 回收）→ 回落 workspaces[0] 且两层载体一并清空', async () => {
    mockUser('u1', [ws('ws-1'), ws('ws-2')])
    renderApp()
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-1'))
    await act(async () => {
      screen.getByRole('button', { name: 'switch-ws-2' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-2'))
    expect(window.localStorage.getItem('pk.ws.u1')).toBe('ws-2')

    
    mockUser('u1', [ws('ws-1')])
    await act(async () => {
      screen.getByRole('button', { name: 'refresh-all' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-1'))
    expect(window.localStorage.getItem('pk.ws.u1')).toBeNull()
    expect(urlWs()).toBeNull()
  })
})

describe('G3 跨账号隔离与登出清理', () => {
  it('换账号登录：u1 的存储键不进 u2 的选择（各读各的 pk.ws.<uid>）', async () => {
    mockUser('u1', [ws('ws-a')])
    renderApp()
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-a'))
    await act(async () => {
      screen.getByRole('button', { name: 'switch-ws-a' }).click()
    })
    await waitFor(() => expect(window.localStorage.getItem('pk.ws.u1')).toBe('ws-a'))

    
    mockUser('u2', [ws('ws-b')])
    await act(async () => {
      screen.getByRole('button', { name: 'refresh-all' }).click()
    })
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-b'))
    
    expect(window.localStorage.getItem('pk.ws.u1')).toBe('ws-a')
    expect(window.localStorage.getItem('pk.ws.u2')).toBeNull()
  })

  it('logout：清本账号工作区记忆键（P2-10 缓存面之外的存储面）', async () => {
    mockUser('u1', [ws('ws-1'), ws('ws-2')])
    renderApp()
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('ws-1'))
    await act(async () => {
      screen.getByRole('button', { name: 'switch-ws-2' }).click()
    })
    await waitFor(() => expect(window.localStorage.getItem('pk.ws.u1')).toBe('ws-2'))

    
    apiMocks.get.mockImplementation((url: string) => {
      if (url === '/auth/me') return Promise.reject(new ApiError(401, 'E_UNAUTHENTICATED', 'unauthenticated'))
      if (url === '/api/workspaces') return Promise.resolve([])
      return Promise.reject(new Error(`unexpected ${url}`))
    })
    await act(async () => {
      screen.getByRole('button', { name: 'logout' }).click()
    })

    expect(apiMocks.post).toHaveBeenCalledWith('/auth/logout')
    expect(window.localStorage.getItem('pk.ws.u1')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('current').textContent).toBe('null'))
  })
})
