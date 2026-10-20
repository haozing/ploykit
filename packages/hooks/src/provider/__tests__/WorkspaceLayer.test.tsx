import '@testing-library/jest-dom/vitest'
import { act, render, waitFor } from '@testing-library/react'
import { useEffect, useRef, useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setWorkspaceIdProvider } from '@ploykit/client'




const apiMocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}))
const providerState = vi.hoisted(() => ({
  latest: null as null | (() => string | null),
  writes: [] as (string | null)[],
}))

vi.mock('@ploykit/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ploykit/client')>()
  return {
    ...mod,
    api: { get: apiMocks.get, post: apiMocks.post, put: apiMocks.put, patch: apiMocks.patch, delete: apiMocks.delete },
    setWorkspaceIdProvider: (p: () => string | null) => {
      providerState.latest = p
      providerState.writes.push(p())
    },
  }
})

import { PloykitProvider } from '../PloykitProvider'
import { useWorkspace } from '../../hooks/useWorkspace'


function Probe({ onCapture }: { onCapture: (v: string | null | 'unset') => void }) {
  const { current } = useWorkspace()
  const done = useRef(false)
  useEffect(() => {
    if (current && !done.current) {
      done.current = true
      onCapture(providerState.latest ? providerState.latest() : 'unset')
    }
  }, [current, onCapture])
  return null
}

describe('WorkspaceLayer provider 接线时序', () => {
  beforeEach(() => {
    apiMocks.get.mockReset()
    providerState.latest = null
    setWorkspaceIdProvider(() => null)
    providerState.writes = []
  })

  it('工作区到达的同一提交内，子层 effect 读到的 provider 已是新工作区 id', async () => {
    let resolveWs!: (v: unknown[]) => void
    apiMocks.get.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve({ id: 'u1', email: 'a@b.c' })
      if (path === '/api/workspaces')
        return new Promise((r) => {
          resolveWs = r
        })
      return Promise.resolve(null)
    })

    const captured: (string | null | 'unset')[] = []
    const onCapture = (v: string | null | 'unset') => captured.push(v)
    render(
      <PloykitProvider>
        <Probe onCapture={onCapture} />
      </PloykitProvider>,
    )


    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith('/api/workspaces'))
    expect(providerState.latest).not.toBeNull()
    expect(providerState.latest!()).toBeNull()


    await act(async () => {
      resolveWs([{ id: 'ws-1', slug: 'w1', name: 'W1', role: 'owner' }])
    })
    await waitFor(() => expect(captured).toHaveLength(1))
    expect(captured[0]).toBe('ws-1')
  })

  it('仅 id 变化时写入：无关重渲染不触发 setWorkspaceIdProvider（orkome 报告 #1）', async () => {
    apiMocks.get.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve({ id: 'u1', email: 'a@b.c' })
      if (path === '/api/workspaces') return Promise.resolve([{ id: 'ws-1', slug: 'w1', name: 'W1', role: 'owner' }])
      return Promise.resolve(null)
    })

    // 外层消费方自有 state 高频变化，触发 Provider 子树重渲染，但 kit 的 current 不变
    function Outer() {
      const [tick, setTick] = useState(0)
      useEffect(() => {
        const timer = setInterval(() => setTick((v) => v + 1), 5)
        return () => clearInterval(timer)
      }, [])
      return (
        <PloykitProvider>
          <div data-testid="tick">{tick}</div>
        </PloykitProvider>
      )
    }
    render(<Outer />)

    await waitFor(() => expect(providerState.latest!()).toBe('ws-1'))
    const writesAfterSettle = providerState.writes.length
    expect(providerState.writes).toEqual([null, 'ws-1'])

    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })
    // 多次重渲染后注册次数不增长（id 未变不再 last-write-wins）
    expect(providerState.writes.length).toBe(writesAfterSettle)
  })

  it("workspaceHeaderSource='consumer'：完全不注册，消费方注册不被覆盖（orkome 报告 #1）", async () => {
    apiMocks.get.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve({ id: 'u1', email: 'a@b.c' })
      if (path === '/api/workspaces') return Promise.resolve([{ id: 'ws-1', slug: 'w1', name: 'W1', role: 'owner' }])
      return Promise.resolve(null)
    })

    // 消费方先注册自己的真相（如自有切换器/zustand）
    const consumerGetter = () => 'consumer-ws'
    setWorkspaceIdProvider(consumerGetter)
    providerState.writes = []

    render(
      <PloykitProvider workspaceHeaderSource="consumer">
        <Probe onCapture={() => {}} />
      </PloykitProvider>,
    )

    await waitFor(() => expect(apiMocks.get).toHaveBeenCalledWith('/api/workspaces'))
    await act(async () => {})
    // 工作区到达后仍不覆盖消费方注册：无任何 kit 侧写入，getter 保持消费方指针
    expect(providerState.writes).toEqual([])
    expect(providerState.latest).toBe(consumerGetter)
  })

  it("默认（'kit'）：switchTo 切换后 provider 读数跟随，写入序列 = id 变更序列", async () => {
    apiMocks.get.mockImplementation((path: string) => {
      if (path === '/auth/me') return Promise.resolve({ id: 'u1', email: 'a@b.c' })
      if (path === '/api/workspaces')
        return Promise.resolve([
          { id: 'ws-1', slug: 'w1', name: 'W1', role: 'owner' },
          { id: 'ws-2', slug: 'w2', name: 'W2', role: 'owner' },
        ])
      return Promise.resolve(null)
    })

    function SwitchProbe() {
      const { current, switchTo } = useWorkspace()
      const switched = useRef(false)
      useEffect(() => {
        if (current?.id === 'ws-1' && !switched.current) {
          switched.current = true
          switchTo('ws-2')
        }
      }, [current, switchTo])
      return null
    }
    render(
      <PloykitProvider>
        <SwitchProbe />
        <Probe onCapture={() => {}} />
      </PloykitProvider>,
    )

    await waitFor(() => expect(providerState.latest!()).toBe('ws-2'))
    expect(providerState.writes).toEqual([null, 'ws-1', 'ws-2'])
  })
})
