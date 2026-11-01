import { TriangleAlert } from 'lucide-react'
import { useAuthSafe } from '../lib/useAuthSafe'
import { cn } from '../lib/utils'
import { useT } from '../i18n'

export function ImpersonationBanner({ className, label }: { className?: string; label?: string }) {
  const t = useT() // 默认横幅文案走字典（g9：ui.impersonation.*），label prop 优先
  // Provider-safe：无 AuthContext 时渲染空（AppShell 不强制宿主包 PloykitProvider）。
  const auth = useAuthSafe()
  if (!auth || !auth.user?.impersonated_by) return null
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
      <span>{label ?? t('ui.impersonation.banner')}</span>
    </div>
  )
}
