
import { TriangleAlert } from 'lucide-react'
import { cn } from '../lib/utils'

export interface SiteBannerProps {
  
  text?: string
  
  kind?: 'info' | 'warn'
  className?: string
}

export function SiteBanner({ text, kind = 'info', className }: SiteBannerProps) {
  if (!text || !text.trim()) return null
  const warn = kind === 'warn'
  return (
    <div
      role="status"
      data-slot="site-banner"
      className={cn(
        'flex w-full items-center justify-center gap-2 border-b px-4 py-2 text-sm',
        warn
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'border-primary/25 bg-primary/10 text-primary',
        className,
      )}
    >
      {warn && <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 whitespace-pre-wrap text-balance">{text}</span>
    </div>
  )
}
