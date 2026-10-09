
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { FrameHandler, ScopePrefix, WsClient, WsFrame, WsStatus } from '@ploykit/client'


export function useWsStatus(client: WsClient): WsStatus {
  return useSyncExternalStore(
    (cb) => client.onStatus(cb),
    () => client.status,
    () => 'idle',
  )
}


export function useWsScope(prefix: ScopePrefix, id: string | undefined, client: WsClient): void {
  useEffect(() => {
    if (!id) return
    return client.subscribe(prefix, id)
  }, [prefix, id, client])
}


export function useWsFrame(type: string, handler: FrameHandler, client: WsClient): void {
  const ref = useRef(handler)
  useEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    const dispatch = (frame: WsFrame) => ref.current(frame)
    return client.on(type, dispatch)
  }, [type, client])
}
