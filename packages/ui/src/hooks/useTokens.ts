
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@ploykit/client'
import type { components } from '@ploykit/client'
import { queryKeys } from '../provider/PloykitProvider'



export type PAT = components['schemas']['PAT']
export type CreatePATResult = components['schemas']['CreatePATResponse']

export function useTokens() {
  const q = useQuery({
    queryKey: queryKeys.tokens,
    queryFn: async () => {
      const data = await api.get<unknown>('/api/tokens')
      return Array.isArray(data) ? (data as PAT[]) : []
    },
  })
  return { tokens: q.data ?? [], loading: q.isPending, error: q.error, refetch: q.refetch }
}

export function useCreateToken() {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (v: { name: string; ttl_hours?: number }) =>
      api.post<CreatePATResult>('/api/tokens', v),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tokens }),
  })
  const create = useCallback(
    (name: string, ttlHours?: number) =>
      m.mutateAsync({ name, ttl_hours: ttlHours }),
    [m],
  )
  return { create, loading: m.isPending, error: m.error }
}

export function useRevokeToken() {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/api/tokens/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.tokens }),
  })
  return {
    revoke: (id: string) => m.mutateAsync(id),
    loading: m.isPending,
    error: m.error,
  }
}
