
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@ploykit/client'
import type { components } from '@ploykit/client'
import { queryKeys } from '../provider/PloykitProvider'




export type SessionInfo = components['schemas']['SessionInfo'] & {
  
  current?: boolean
}

function normalize(data: unknown): SessionInfo[] {
  
  const list = Array.isArray(data) ? data : (data as { items?: SessionInfo[] })?.items
  return Array.isArray(list) ? list : []
}

export function useSessions() {
  const q = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: async () => normalize(await api.get<unknown>('/auth/sessions')),
  })
  return { sessions: q.data ?? [], loading: q.isPending, error: q.error, refetch: q.refetch }
}


export function useRevokeSession() {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: (id: string) => api.delete<void>(`/auth/sessions/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sessions }),
  })
  return {
    revoke: (id: string) => m.mutateAsync(id),
    loading: m.isPending,
    error: m.error,
  }
}


export function useRevokeAllSessions() {
  const qc = useQueryClient()
  const m = useMutation({
    mutationFn: () => api.delete<void>('/auth/sessions'),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.sessions }),
  })
  return {
    revokeAll: () => m.mutateAsync(),
    loading: m.isPending,
    error: m.error,
  }
}
