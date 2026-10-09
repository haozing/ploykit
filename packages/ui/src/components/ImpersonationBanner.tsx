
import { TriangleAlert } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { cn } from '../lib/utils'

export function ImpersonationBanner({ className }: { className?: string }) {
  const { user } = useAuth()
  if (!user?.impersonated_by) return null
  return (
    <div
      role="status"
      data-slot="impersonation-banner"
      className={cn(
        'flex w-full items-center justify-center gap-2 border-b px-4 py-2 text-sm font-medium',
        'border-destructive/30 bg-destructive/10 text-destructive',
        className,
      )}
    >
      <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
      <span>您正处于管理员模拟会话</span>
    </div>
  )
}
