
import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@ploykit/client'
import { queryKeys } from '../provider/PloykitProvider'

export interface NotificationPreference {
  notification_type: string
  email_enabled: boolean
  in_app_enabled: boolean
  updated_at: string
}

export function useNotificationPrefs() {
  const q = useQuery({
    queryKey: queryKeys.notificationPrefs,
    queryFn: async () => {
      const data = await api.get<{ items?: NotificationPreference[] }>(
        '/api/notification-preferences',
      )
      return data?.items ?? []
    },
  })
  return { prefs: q.data ?? [], loading: q.isPending, error: q.error, refetch: q.refetch }
}


export function useSetNotificationPref() {
  const qc = useQueryClient()

  const m = useMutation({
    mutationFn: (v: { type: string; email_enabled?: boolean; in_app_enabled?: boolean }) =>
      api.put<NotificationPreference>(
        `/api/notification-preferences/${encodeURIComponent(v.type)}`,
        { email_enabled: v.email_enabled, in_app_enabled: v.in_app_enabled },
      ),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: queryKeys.notificationPrefs })
      const prev = qc.getQueryData<NotificationPreference[]>(queryKeys.notificationPrefs) ?? []
      
      const existing = prev.find((p) => p.notification_type === v.type)
      const next: NotificationPreference = {
        notification_type: v.type,
        email_enabled: v.email_enabled ?? existing?.email_enabled ?? true,
        in_app_enabled: v.in_app_enabled ?? existing?.in_app_enabled ?? true,
        updated_at: new Date().toISOString(),
      }
      qc.setQueryData(
        queryKeys.notificationPrefs,
        existing
          ? prev.map((p) => (p.notification_type === v.type ? next : p))
          : [...prev, next],
      )
      return { prev }
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.notificationPrefs, ctx.prev)
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.notificationPrefs }),
  })

  const setPref = useCallback(
    (type: string, channels: { email_enabled?: boolean; in_app_enabled?: boolean }) =>
      m.mutateAsync({ type, ...channels }),
    [m],
  )
  return { setPref, loading: m.isPending, error: m.error }
}
