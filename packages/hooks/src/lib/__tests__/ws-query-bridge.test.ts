import { QueryClient } from '@tanstack/react-query'
import { describe, it, expect, vi } from 'vitest'
import type { FrameHandler, StatusHandler, WsClient, WsStatus } from '@ploykit/client'
import { bridgeWsToQuery } from '../ws-query-bridge'




function makeFakeWs() {
  const statusCbs = new Set<StatusHandler>()
  const frameCbs = new Map<string, Set<FrameHandler>>()
  return {
    on(type: string, h: FrameHandler) {
      let set = frameCbs.get(type)
      if (!set) {
        set = new Set()
        frameCbs.set(type, set)
      }
      set.add(h)
      return () => {
        set!.delete(h)
        if (set!.size === 0) frameCbs.delete(type)
      }
    },
    onStatus(cb: StatusHandler) {
      statusCbs.add(cb)
      return () => statusCbs.delete(cb)
    },
    emit(type: string) {
      for (const h of frameCbs.get(type) ?? []) h({ type })
      for (const h of frameCbs.get('*') ?? []) h({ type })
    },
    setStatus(s: WsStatus) {
      for (const cb of statusCbs) cb(s)
    },
  }
}
const asWs = (w: ReturnType<typeof makeFakeWs>) => w as unknown as WsClient

describe('bridgeWsToQuery', () => {
  it('命中规则的帧按 key 失效；未命中的帧不失效', () => {
    const ws = makeFakeWs()
    const qc = new QueryClient()
    const inv = vi.spyOn(qc, 'invalidateQueries')
    const off = bridgeWsToQuery(asWs(ws), qc, [
      { match: 'task.updated', invalidate: [['tasks']] },
      { match: /^billing\./, invalidate: [['billing']] },
    ])

    ws.emit('task.updated')
    expect(inv).toHaveBeenCalledTimes(1)
    expect(inv).toHaveBeenCalledWith({ queryKey: ['tasks'] })

    ws.emit('unrelated.event')
    expect(inv).toHaveBeenCalledTimes(1)
    off()
    expect(() => ws.emit('task.updated')).not.toThrow()
    expect(inv).toHaveBeenCalledTimes(1)
  })

  it('P3-53：带 g 标志的正则不出现隔帧漏配（lastIndex 状态化回归）', () => {
    const ws = makeFakeWs()
    const qc = new QueryClient()
    const inv = vi.spyOn(qc, 'invalidateQueries')
    bridgeWsToQuery(asWs(ws), qc, [{ match: /an_/g, invalidate: [['analytics']] }])

    
    ws.emit('an_created')
    ws.emit('an_updated')
    ws.emit('an_deleted')
    expect(inv).toHaveBeenCalledTimes(3)
  })

  it('P2-4：重连开链批量失效桥登记键；首轮 open 不触发', () => {
    const ws = makeFakeWs()
    const qc = new QueryClient()
    const inv = vi.spyOn(qc, 'invalidateQueries')
    bridgeWsToQuery(asWs(ws), qc, [
      { match: 'a', invalidate: [['tasks'], ['tasks', 'detail']] },
      { match: 'b', invalidate: [['billing']] },
    ])

    
    ws.setStatus('open')
    expect(inv).not.toHaveBeenCalled()

    
    ws.setStatus('reconnecting')
    ws.setStatus('open')
    expect(inv).toHaveBeenCalledTimes(3)
    expect(inv).toHaveBeenCalledWith({ queryKey: ['tasks'] })
    expect(inv).toHaveBeenCalledWith({ queryKey: ['tasks', 'detail'] })
    expect(inv).toHaveBeenCalledWith({ queryKey: ['billing'] })

    
    inv.mockClear()
    ws.setStatus('reconnecting')
    ws.setStatus('open')
    expect(inv).toHaveBeenCalledTimes(3)
  })
})
