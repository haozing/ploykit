

export interface WsFrame<T = unknown> {
  type: string
  payload?: T
  event_id?: string
}

export type WsStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'stopped'
export type FrameHandler = (frame: WsFrame) => void
export type StatusHandler = (status: WsStatus) => void

export interface WsClientOptions {
  url?: string | (() => string)
  socketFactory?: (url: string) => WebSocket
  minRetryMs?: number
  maxRetryMs?: number
  dedupeLimit?: number
  
  heartbeatMs?: number
}


export type ScopePrefix = 'workspace' | 'user' | 'task' | 'chat'

export class WsClient {
  private socket: WebSocket | null = null
  private statusValue: WsStatus = 'idle'
  private stopped = true
  private retryCount = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly frameHandlers = new Map<string, Set<FrameHandler>>()
  private readonly statusHandlers = new Set<StatusHandler>()
  private readonly scopeRefs = new Map<string, number>()
  private readonly seenIds = new Set<string>()
  private readonly seenOrder: string[] = []
  private readonly dedupeLimit: number
  private readonly socketFactory: (url: string) => WebSocket
  private readonly minRetryMs: number
  private readonly maxRetryMs: number
  private readonly heartbeatMs: number
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastActivityAt = 0
  private readonly options: WsClientOptions

  constructor(options: WsClientOptions = {}) {
    this.options = options
    this.socketFactory = options.socketFactory ?? ((url) => new WebSocket(url))
    this.minRetryMs = options.minRetryMs ?? 500
    this.maxRetryMs = options.maxRetryMs ?? 30000
    this.dedupeLimit = options.dedupeLimit ?? 1000
    this.heartbeatMs = options.heartbeatMs ?? 0
  }

  get url(): string {
    const u = this.options.url
    if (typeof u === 'function') return u()
    if (typeof u === 'string') return u
    return typeof location === 'undefined'
      ? 'ws://localhost/ws'
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
  }

  get status(): WsStatus {
    return this.statusValue
  }

  connect(): void {
    if (!this.stopped) return
    this.stopped = false
    this.retryCount = 0
    this.openSocket('connecting')
  }

  close(): void {
    this.stopped = true
    this.stopHeartbeat()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.socket?.close()
    this.socket = null
    this.setStatus('stopped')
  }

  
  reconnect(): void {
    if (this.stopped) return
    this.stopHeartbeat()
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const s = this.socket
    this.socket = null
    if (s) {
      s.onopen = null
      s.onmessage = null
      s.onerror = null
      s.onclose = null
      s.close()
    }
    this.retryCount = 0
    this.openSocket('connecting')
  }

  
  on(type: string, handler: FrameHandler): () => void {
    let set = this.frameHandlers.get(type)
    if (!set) {
      set = new Set()
      this.frameHandlers.set(type, set)
    }
    set.add(handler)
    return () => {
      set.delete(handler)
      if (set.size === 0) this.frameHandlers.delete(type)
    }
  }

  onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler)
    return () => this.statusHandlers.delete(handler)
  }

  
  subscribe(prefix: ScopePrefix, id: string): () => void {
    const key = `${prefix}:${id}`
    const refs = (this.scopeRefs.get(key) ?? 0) + 1
    this.scopeRefs.set(key, refs)
    if (refs === 1) this.send('subscribe', { scope: prefix, id })
    return () => {
      const left = (this.scopeRefs.get(key) ?? 0) - 1
      if (left <= 0) {
        this.scopeRefs.delete(key)
        this.send('unsubscribe', { scope: prefix, id })
      } else {
        this.scopeRefs.set(key, left)
      }
    }
  }

  send(type: string, payload?: unknown): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return
    this.socket.send(JSON.stringify({ type, payload }))
  }

  private openSocket(nextStatus: WsStatus): void {
    this.setStatus(nextStatus)
    const socket = this.socketFactory(this.url)
    this.socket = socket
    socket.onopen = () => {
      this.retryCount = 0
      this.setStatus('open')
      this.startHeartbeat()
      for (const key of this.scopeRefs.keys()) {
        
        
        
        const sep = key.indexOf(':')
        const prefix = key.slice(0, sep) as ScopePrefix
        const id = key.slice(sep + 1)
        this.send('subscribe', { scope: prefix, id })
      }
    }
    socket.onmessage = (ev: MessageEvent) => {
      this.lastActivityAt = Date.now()
      let frame: WsFrame
      try {
        frame = JSON.parse(String(ev.data)) as WsFrame
      } catch {
        return
      }
      if (typeof frame?.type !== 'string') return
      this.dispatch(frame)
    }
    socket.onerror = () => {}
    socket.onclose = () => {
      if (this.stopped) return
      this.scheduleReconnect()
    }
  }

  
  private startHeartbeat(): void {
    this.stopHeartbeat()
    if (this.heartbeatMs <= 0) return
    this.lastActivityAt = Date.now()
    this.heartbeatTimer = setInterval(() => {
      if (Date.now() - this.lastActivityAt >= this.heartbeatMs) {
        
        
        const s = this.socket
        this.socket = null
        this.stopHeartbeat()
        if (s) {
          s.onopen = null
          s.onmessage = null
          s.onerror = null
          s.onclose = null
          s.close()
        }
        this.scheduleReconnect()
        return
      }
      
      this.send('ping')
    }, Math.ceil(this.heartbeatMs / 2))
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private scheduleReconnect(): void {
    this.socket = null
    this.stopHeartbeat()
    this.setStatus('reconnecting')
    const delay = Math.min(this.maxRetryMs, this.minRetryMs * 2 ** this.retryCount)
    const jitter = delay * 0.3 * Math.random()
    this.retryCount += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.openSocket('reconnecting')
    }, delay + jitter)
  }

  private dispatch(frame: WsFrame): void {
    
    if (frame.event_id) {
      if (this.seenIds.has(frame.event_id)) return
      this.seenIds.add(frame.event_id)
      this.seenOrder.push(frame.event_id)
      if (this.seenOrder.length > this.dedupeLimit) {
        const evicted = this.seenOrder.shift()
        if (evicted !== undefined) this.seenIds.delete(evicted)
      }
    }
    const handlers = this.frameHandlers.get(frame.type)
    if (handlers) {
      for (const h of handlers) {
        try {
          h(frame)
        } catch (err) {
          console.error(`[ws] handler for ${frame.type} threw`, err)
        }
      }
    }
    const wildcard = this.frameHandlers.get('*')
    if (wildcard) {
      for (const h of wildcard) {
        try {
          h(frame)
        } catch (err) {
          console.error('[ws] wildcard handler threw', err)
        }
      }
    }
  }

  private setStatus(status: WsStatus): void {
    if (this.statusValue === status) return
    this.statusValue = status
    for (const h of this.statusHandlers) h(status)
  }
}
