
import { useQuery } from '@tanstack/react-query'
import { useApi } from './useApi'
import { useWorkspace } from './useWorkspace'
import { queryKeys } from '../provider/PloykitProvider'
import type { components } from '@ploykit/client'

export type PKUsageResp = components['schemas']['UsageResp']
export type PKUsageItem = components['schemas']['UsageItem']

export function useUsage() {
  const { current } = useWorkspace()
  const api = useApi()
  const wsId = current?.id ?? ''

  const q = useQuery({
    queryKey: queryKeys.usage(wsId),
    queryFn: () => api.get<PKUsageResp>('/api/usage'),
    enabled: !!wsId,
  })

  return {
    wsId,
    usage: wsId ? (q.data ?? null) : null,
    loading: !!wsId && q.isPending,
    error: q.error,
    refetch: q.refetch,
  }
}
