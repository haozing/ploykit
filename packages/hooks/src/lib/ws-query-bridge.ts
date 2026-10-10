
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { WsClient, WsFrame } from '@ploykit/client'

export interface WsInvalidationRule {
  
  match: string | RegExp
  
  invalidate: readonly QueryKey[]
}

function ruleMatches(rule: WsInvalidationRule, type: string): boolean {
  if (typeof rule.match === 'string') return rule.match === type
  
  
  rule.match.lastIndex = 0
  return rule.match.test(type)
}


export function bridgeWsToQuery(
  ws: WsClient,
  queryClient: QueryClient,
  rules: readonly WsInvalidationRule[],
): () => void {
  
  
  let sawOpen = false
  const offStatus = ws.onStatus((status) => {
    if (status !== 'open') return
    if (!sawOpen) {
      
      
      sawOpen = true
      return
    }
    for (const rule of rules) {
      for (const key of rule.invalidate) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    }
  })

  const offFrame = ws.on('*', (frame: WsFrame) => {
    for (const rule of rules) {
      if (!ruleMatches(rule, frame.type)) continue
      for (const key of rule.invalidate) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    }
  })

  return () => {
    offStatus()
    offFrame()
  }
}
