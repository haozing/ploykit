
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WsClient, type WsFrame, type WsStatus } from './ws'

class FakeSocket {
  static instances: FakeSocket[] = []
  
  readyState = 0
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((ev: { data: string }) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onclose: (() => void) | null = null

  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = 3
  }

  
  serverOpen(): void {
    this.readyState = 1
    this.onopen?.()
  }

  serverMessage(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) })
  }

  serverClose(): void {
    this.readyState = 3
    this.onclose?.()
  }

  sentFrames(): { type: string; payload?: unknown }[] {
    return this.sent.map((raw) => JSON.parse(raw) as { type: string; payload?: unknown })
  }
}

function makeClient(options?: ConstructorParameters<typeof WsClient>[0]) {
  const factory = vi.fn((url: string) => new FakeSocket(url))
  const client = new WsClient({ socketFactory: factory, url: 'ws://test/ws', ...options })
  return { client, factory }
}

beforeEach(() => {
  FakeSocket.instances = []
})

afterEach(() => {
  vi.useRealTimers()
})

describe('连接与状态机', () => {
  it('connect → connecting → open；onStatus 订阅收到全部迁移', () => {
    const { client, factory } = makeClient()
    const statuses: WsStatus[] = []
    client.onStatus((s) => statuses.push(s))
    expect(client.status).toBe('idle')

    client.connect()
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory).toHaveBeenCalledWith('ws://test/ws')
    expect(client.status).toBe('connecting')

    FakeSocket.instances[0].serverOpen()
    expect(client.status).toBe('open')
    expect(statuses).toEqual(['connecting', 'open'])
  })

  it('url 为 getter 时每次建连重新求值（工作区切换场景）', () => {
    let url = 'ws://test/ws?workspace_id=a'
    const factory = vi.fn((u: string) => new FakeSocket(u))
    const client = new WsClient({ socketFactory: factory, url: () => url })
    client.connect()
    FakeSocket.instances[0].serverClose() 
    url = 'ws://test/ws?workspace_id=b'
    return new Promise((done) => {
      setTimeout(() => {
        client.connect() 
        client.reconnect()
        expect(factory).toHaveBeenLastCalledWith('ws://test/ws?workspace_id=b')
        client.close()
        done(null)
      }, 30)
    })
  })

  it('close：状态 stopped，onclose 不再触发重连', () => {
    const { client, factory } = makeClient({ minRetryMs: 1, maxRetryMs: 2 })
    client.connect()
    FakeSocket.instances[0].serverOpen()
    client.close()
    expect(client.status).toBe('stopped')
    FakeSocket.instances[0].serverClose()
    return new Promise((done) => {
      setTimeout(() => {
        expect(factory).toHaveBeenCalledTimes(1)
        done(null)
      }, 20)
    })
  })
})

describe('scope 引用计数订阅', () => {
  it('open 态首次订阅发 subscribe，重复订阅只发一次；全部退订发 unsubscribe', () => {
    const { client } = makeClient()
    client.connect()
    const sock = FakeSocket.instances[0]
    sock.serverOpen()

    const off1 = client.subscribe('workspace', 'ws-1')
    const off2 = client.subscribe('workspace', 'ws-1')
    expect(sock.sentFrames().filter((f) => f.type === 'subscribe')).toHaveLength(1)

    off1()
    expect(sock.sentFrames().filter((f) => f.type === 'unsubscribe')).toHaveLength(0)
    off2()
    const unsubs = sock.sentFrames().filter((f) => f.type === 'unsubscribe')
    expect(unsubs).toHaveLength(1)
    expect(unsubs[0].payload).toEqual({ scope: 'workspace', id: 'ws-1' })
  })

  it('未连接时订阅先记账，onopen 后批量补发（含重连恢复）', () => {
    const { client, factory } = makeClient({ minRetryMs: 1, maxRetryMs: 2 })
    client.connect()
    client.subscribe('workspace', 'ws-1')

    const sock = FakeSocket.instances[0]
    sock.serverOpen()
    let subs = sock.sentFrames().filter((f) => f.type === 'subscribe')
    expect(subs).toHaveLength(1)
    expect(subs[0].payload).toEqual({ scope: 'workspace', id: 'ws-1' })

    
    sock.serverClose()
    return new Promise((done) => {
      setTimeout(() => {
        expect(factory).toHaveBeenCalledTimes(2)
        const sock2 = FakeSocket.instances[1]
        sock2.serverOpen()
        subs = sock2.sentFrames().filter((f) => f.type === 'subscribe')
        expect(subs).toHaveLength(1)
        expect(subs[0].payload).toEqual({ scope: 'workspace', id: 'ws-1' })
        client.close()
        done(null)
      }, 30)
    })
  })

  it('P3-54：id 含冒号时重连重订阅携带完整 id（split 截断回归）', () => {
    const { client } = makeClient({ minRetryMs: 1, maxRetryMs: 2 })
    client.connect()
    const sock = FakeSocket.instances[0]
    sock.serverOpen()
    client.subscribe('task', 'group:sub:leaf')

    sock.serverClose()
    return new Promise((done) => {
      setTimeout(() => {
        const sock2 = FakeSocket.instances[1]
        sock2.serverOpen()
        const subs = sock2.sentFrames().filter((f) => f.type === 'subscribe')
        expect(subs).toHaveLength(1)
        
        expect(subs[0].payload).toEqual({ scope: 'task', id: 'group:sub:leaf' })
        client.close()
        done(null)
      }, 30)
    })
  })
})

describe('帧分发与去重', () => {
  it('按 type 分发；通配 * 收全部；on 返回退订函数', () => {
    const { client } = makeClient()
    const got: string[] = []
    const all: string[] = []
    client.on('task.updated', (f) => got.push(f.type))
    const offAll = client.on('*', (f) => all.push(f.type))
    client.connect()
    const sock = FakeSocket.instances[0]
    sock.serverOpen()

    sock.serverMessage({ type: 'task.updated', event_id: 'e-1' })
    sock.serverMessage({ type: 'other.event', event_id: 'e-2' })
    expect(got).toEqual(['task.updated'])
    expect(all).toHaveLength(2)

    offAll()
    sock.serverMessage({ type: 'third.event', event_id: 'e-3' })
    expect(all).toHaveLength(2)
    expect(got).toHaveLength(1)
  })

  it('event_id 去重：重复帧只投递一次；无 event_id 的帧不去重', () => {
    const { client } = makeClient()
    const seen: WsFrame[] = []
    client.on('task.updated', (f) => seen.push(f))
    client.connect()
    const sock = FakeSocket.instances[0]
    sock.serverOpen()

    sock.serverMessage({ type: 'task.updated', event_id: 'dup' })
    sock.serverMessage({ type: 'task.updated', event_id: 'dup' })
    sock.serverMessage({ type: 'task.updated' })
    sock.serverMessage({ type: 'task.updated' })
    expect(seen).toHaveLength(3)
  })

  it('单个 handler 抛错不阻断其余 handler', () => {
    const { client } = makeClient()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const good: string[] = []
    client.on('boom', () => {
      throw new Error('handler bug')
    })
    client.on('boom', () => good.push('still alive'))
    client.connect()
    const sock = FakeSocket.instances[0]
    sock.serverOpen()
    sock.serverMessage({ type: 'boom' })
    expect(good).toEqual(['still alive'])
    errSpy.mockRestore()
  })
})

describe('重连退避', () => {
  it('onclose（非主动关闭）→ reconnecting，退避后重建 socket', () => {
    const { client, factory } = makeClient({ minRetryMs: 1, maxRetryMs: 2 })
    const statuses: WsStatus[] = []
    client.onStatus((s) => statuses.push(s))
    client.connect()
    FakeSocket.instances[0].serverOpen()
    FakeSocket.instances[0].serverClose()
    expect(client.status).toBe('reconnecting')

    return new Promise((done) => {
      setTimeout(() => {
        expect(factory).toHaveBeenCalledTimes(2)
        
        expect(statuses).toEqual(['connecting', 'open', 'reconnecting'])
        client.close()
        done(null)
      }, 30)
    })
  })
})

describe('P3-55 心跳看门狗（heartbeatMs）', () => {
  it('默认关闭：不发送任何 ping 探针', () => {
    vi.useFakeTimers()
    const { client } = makeClient()
    client.connect()
    const sock = FakeSocket.instances[0]
    sock.serverOpen()
    vi.advanceTimersByTime(60_000)
    expect(sock.sentFrames().some((f) => f.type === 'ping')).toBe(false)
    client.close()
  })

  it('开启后周期发 ping 探针；有入站帧则不触发重连', () => {
    vi.useFakeTimers()
    const { client, factory } = makeClient({ heartbeatMs: 1000, minRetryMs: 1, maxRetryMs: 2 })
    client.connect()
    const sock = FakeSocket.instances[0]
    sock.serverOpen()

    
    vi.advanceTimersByTime(500)
    expect(sock.readyState).toBe(1)
    sock.serverMessage({ type: 'task.updated', event_id: 'keepalive-1' })
    vi.advanceTimersByTime(500)
    sock.serverMessage({ type: 'task.updated', event_id: 'keepalive-2' })
    vi.advanceTimersByTime(500)
    expect(sock.sentFrames().some((f) => f.type === 'ping')).toBe(true)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(client.status).toBe('open')
    client.close()
  })

  it('超过一个窗口无入站帧：判定半开，拆除并重连', () => {
    vi.useFakeTimers()
    const { client, factory } = makeClient({ heartbeatMs: 1000, minRetryMs: 1, maxRetryMs: 2 })
    const statuses: WsStatus[] = []
    client.onStatus((s) => statuses.push(s))
    client.connect()
    const sock = FakeSocket.instances[0]
    sock.serverOpen()

    vi.advanceTimersByTime(1500)
    expect(sock.readyState).toBe(3) 
    expect(client.status).toBe('reconnecting')
    vi.advanceTimersByTime(10)
    expect(factory).toHaveBeenCalledTimes(2)
    FakeSocket.instances[1].serverOpen()
    expect(client.status).toBe('open')
    expect(statuses).toContain('reconnecting')
    client.close()
  })
})
