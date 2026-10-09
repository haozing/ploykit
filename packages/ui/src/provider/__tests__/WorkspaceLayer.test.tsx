import '@testing-library/jest-dom/vitest'
import { act, render, waitFor } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'






const apiMocks = vi.hoisted(() => ({ get: vi.fn() }))
const providerState = vi.hoisted(() => ({
  latest: null as null | (() => string | null),
}))

vi.mock('@ploykit/client', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@ploykit/client')>()
  return {
    ...mod,
    api: { get: apiMocks.get, post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
    setWorkspaceIdProvider: (p: () => string | null) => {
      providerState.latest = p
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
})
