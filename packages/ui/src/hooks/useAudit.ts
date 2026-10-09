
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@ploykit/client'
import { useApi } from './useApi'
import { useWorkspace } from './useWorkspace'
import { queryKeys } from '../provider/PloykitProvider'
import type { components } from '@ploykit/client'

export type PKAuditEvent = components['schemas']['AuditEvent']

export interface AuditListResp {
  items: PKAuditEvent[]
  total: number
}


export interface AuditFilters {
  action: string
  actorId: string
  resourceType: string
  from: string
  to: string
}

export const EMPTY_AUDIT_FILTERS: AuditFilters = {
  action: '', actorId: '', resourceType: '', from: '', to: '',
}

export function auditQueryString(f: AuditFilters, limit: number, offset: number): string {
  const q = new URLSearchParams()
  if (f.action) q.set('action', f.action)
  if (f.actorId) q.set('actor_id', f.actorId)
  if (f.resourceType) q.set('resource_type', f.resourceType)
  if (f.from) q.set('from', f.from)
  if (f.to) q.set('to', f.to)
  q.set('limit', String(limit))
  q.set('offset', String(offset))
  return q.toString()
}


export function useAudit(filters: AuditFilters, limit = 20, offset = 0) {
  const { current } = useWorkspace()
  const api = useApi()
  const wsId = current?.id ?? ''
  const qs = auditQueryString(filters, limit, offset)

  const q = useQuery({
    queryKey: queryKeys.audit(wsId, { ...filters, limit, offset }),
    queryFn: () => api.get<AuditListResp>(`/api/audit?${qs}`),
    enabled: !!wsId,
  })

  return {
    wsId,
    items: wsId ? (q.data?.items ?? []) : [],
    total: wsId ? (q.data?.total ?? 0) : 0,
    loading: !!wsId && q.isPending,
    error: q.error,
    refetch: q.refetch,
  }
}


export async function exportAuditCsv(filters: AuditFilters): Promise<void> {
  const qs = auditQueryString(filters, 5000, 0)
  const blob = await apiFetch<Blob>(`/api/audit/export.csv?${qs}`, { responseType: 'blob' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `audit-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
