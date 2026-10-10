import '@testing-library/jest-dom/vitest'
import { act, render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { FrameHandler, ScopePrefix, WsClient, WsFrame, WsStatus } from '@ploykit/client'
import { useWsFrame, useWsScope, useWsStatus } from '../ws'





type StatusCb = (s: WsStatus) => void

function makeFakeClient() {
  const statusCbs = new Set<StatusCb>()
  const frames = new Map<string, Set<FrameHandler>>()
  const scopeLog: string[] = []
  const client = {
    status: 'idle' as WsStatus,
    onStatus(cb: StatusCb) {
      statusCbs.add(cb)
      return () => statusCbs.delete(cb)
    },
    on(type: string, handler: FrameHandler) {
      let set = frames.get(type)
      if (!set) {
        set = new Set()
        frames.set(type, set)
      }
      set.add(handler)
      return () => {
        set!.delete(handler)
        if (set!.size === 0) frames.delete(type)
      }
    },
    subscribe(prefix: ScopePrefix, id: string) {
      scopeLog.push(`+${prefix}:${id}`)
      return () => scopeLog.push(`-${prefix}:${id}`)
    },
    
    emit(frame: WsFrame) {
      for (const h of frames.get(frame.type) ?? []) h(frame)
    },
    
    registeredTypes() {
      return [...frames.keys()]
    },
    
    setStatus(s: WsStatus) {
      client.status = s
      for (const cb of statusCbs) cb(s)
    },
    scopeLog,
  }
  return client
}

type FakeClient = ReturnType<typeof makeFakeClient>

const asClient = (c: FakeClient) => c as unknown as WsClient

describe('useWsStatus', () => {
  it('以 useSyncExternalStore 订阅 status：状态迁移触发重渲染', () => {
    const client = makeFakeClient()
    function Probe() {
      const status = useWsStatus(asClient(client))
      return <div data-testid="status">{status}</div>
    }
    render(<Probe />)
    expect(screen.getByTestId('status').textContent).toBe('idle')

    act(() => client.setStatus('connecting'))
    expect(screen.getByTestId('status').textContent).toBe('connecting')
    act(() => client.setStatus('open'))
    expect(screen.getByTestId('status').textContent).toBe('open')
  })

  it('卸载后退订（后续迁移不再影响已卸载组件）', () => {
    const client = makeFakeClient()
    function Probe() {
      const status = useWsStatus(asClient(client))
      return <div data-testid="status">{status}</div>
    }
    const { unmount } = render(<Probe />)
    unmount()
    expect(() => act(() => client.setStatus('reconnecting'))).not.toThrow()
  })
})

describe('useWsScope', () => {
  it('挂载订阅、卸载退订；id 未就绪（undefined）不订阅', () => {
    const client = makeFakeClient()
    function Probe({ id }: { id?: string }) {
      useWsScope('workspace', id, asClient(client))
      return null
    }
    const { rerender, unmount } = render(<Probe />)
    expect(client.scopeLog).toEqual([])

    rerender(<Probe id="ws-1" />)
    expect(client.scopeLog).toEqual(['+workspace:ws-1'])

    unmount()
    expect(client.scopeLog).toEqual(['+workspace:ws-1', '-workspace:ws-1'])
  })

  it('id 变化：先退旧再订新', () => {
    const client = makeFakeClient()
    function Probe({ id }: { id: string }) {
      useWsScope('workspace', id, asClient(client))
      return null
    }
    const { rerender, unmount } = render(<Probe id="ws-1" />)
    rerender(<Probe id="ws-2" />)
    expect(client.scopeLog).toEqual(['+workspace:ws-1', '-workspace:ws-1', '+workspace:ws-2'])
    unmount()
  })
})

describe('useWsFrame', () => {
  it('按 type 订阅：帧到达调用最新 handler 闭包，且不因闭包变化重订阅', () => {
    const client = makeFakeClient()
    const received: string[] = []
    function Probe({ tag }: { tag: string }) {
      useWsFrame('task.updated', (f) => received.push(`${tag}:${f.type}`), asClient(client))
      return null
    }
    const { rerender } = render(<Probe tag="v1" />)
    expect(client.registeredTypes()).toEqual(['task.updated'])

    act(() => client.emit({ type: 'task.updated' }))
    expect(received).toEqual(['v1:task.updated'])

    
    rerender(<Probe tag="v2" />)
    expect(client.registeredTypes()).toEqual(['task.updated'])
    act(() => client.emit({ type: 'task.updated' }))
    expect(received).toEqual(['v1:task.updated', 'v2:task.updated'])
  })

  it('type 变化退旧订新；卸载退订；其它类型帧不投递', () => {
    const client = makeFakeClient()
    const received: string[] = []
    function Probe({ type }: { type: string }) {
      useWsFrame(type, (f) => received.push(f.type), asClient(client))
      return null
    }
    const { rerender, unmount } = render(<Probe type="a.event" />)
    act(() => {
      client.emit({ type: 'a.event' })
      client.emit({ type: 'other.event' })
    })
    expect(received).toEqual(['a.event'])

    rerender(<Probe type="b.event" />)
    expect(client.registeredTypes().sort()).toEqual(['b.event'])
    unmount()
    expect(client.registeredTypes()).toEqual([])
  })
})
