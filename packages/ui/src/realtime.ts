
import { WsClient, type WsClientOptions } from '@ploykit/client'


export function defaultWsUrl(workspaceId?: string | null): string {
  const proto =
    typeof location === 'undefined' ? 'ws' : location.protocol === 'https:' ? 'wss' : 'ws'
  const host = typeof location === 'undefined' ? 'localhost' : location.host
  return workspaceId
    ? `${proto}://${host}/ws?workspace_id=${encodeURIComponent(workspaceId)}`
    : `${proto}://${host}/ws`
}


export function createWsClient(url: () => string, options?: Omit<WsClientOptions, 'url'>): WsClient {
  return new WsClient({ ...options, url })
}
