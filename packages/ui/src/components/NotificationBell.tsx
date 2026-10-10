
import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type APINotification, type components } from '@ploykit/client'
import { queryKeys } from '@ploykit/hooks'
import { cn, formatDateTime } from '../lib/utils'


type Notification = APINotification

export function NotificationBell({ onNavigate }: { onNavigate?: (link: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const qc = useQueryClient()

  
  const badgeQ = useQuery({
    queryKey: [queryKeys.notifications, 'badge'],
    queryFn: () => api.get<components['schemas']['BadgeResponse']>('/api/notifications/badge'),
    refetchInterval: 60_000,
  })
  const unread = badgeQ.data?.count ?? 0

  
  const listQ = useQuery({
    queryKey: [queryKeys.notifications, 'list'],
    queryFn: () => api.get<Notification[]>('/api/notifications?limit=8'),
    staleTime: 30_000,
    enabled: open,
  })
  const notifications = Array.isArray(listQ.data) ? listQ.data : []

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: [queryKeys.notifications] })
  }

  const markAllReadM = useMutation({
    mutationFn: () => api.post('/api/notifications/read-all'),
    onSuccess: invalidate,
  })

  const markReadM = useMutation({
    mutationFn: (id: string) => api.post(`/api/notifications/${id}/read`),
    onSuccess: invalidate,
  })

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        
        
        
        className="relative p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        aria-label="通知"
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unread > 0 && (
          
          
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[18px] h-[18px]
            px-1 text-xs font-bold text-white bg-red-500 rounded-full">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-lg border z-50"
          role="dialog"
          aria-label="通知列表"
          onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false) }}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b">
            <span className="text-sm font-semibold">通知</span>
            {unread > 0 && (
              <button
                onClick={() => markAllReadM.mutate()}
                disabled={markAllReadM.isPending}
                className="text-xs text-blue-600 hover:underline disabled:opacity-50
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              >全部已读</button>
            )}
          </div>
          <ul className="max-h-80 overflow-y-auto list-none p-0 m-0" data-slot="notification-list">
            {listQ.isPending ? (
              
              <li className="py-8 text-center text-sm text-gray-400" aria-live="polite">加载中…</li>
            ) : notifications.length === 0 ? (
              <li className="py-8 text-center text-sm text-gray-400">暂无通知</li>
            ) : notifications.map((n) => (
              <li key={n.id} className="border-b last:border-0">
                {/* P2-19：条目是可操作元素——button 语义（Tab 可达、Enter 可触发）， */}
                {/* 不再是 clickable div（键盘用户此前完全不可操作） */}
                <button
                  type="button"
                  onClick={() => { if (n.link) onNavigate?.(n.link); markReadM.mutate(n.id); setOpen(false) }}
                  className={cn(
                    'w-full text-left px-4 py-3 cursor-pointer hover:bg-gray-50 ' +
                      'focus-visible:outline-none focus-visible:bg-gray-50 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                    !n.read_at && 'bg-blue-50/50',
                  )}
                >
                  <span className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-gray-900">{n.title}</span>
                    {n.count > 1 && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full shrink-0">×{n.count}</span>
                    )}
                  </span>
                  {n.body && <span className="block mt-0.5 text-xs text-gray-500 line-clamp-2">{n.body}</span>}
                  <span className="block mt-1 text-[10px] text-gray-400">{formatDateTime(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
