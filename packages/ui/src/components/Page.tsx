
import { type ReactNode } from 'react'
import { Inbox, TriangleAlert } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from './ui/empty'



export function PageHeader({ title, description, actions }: {
  title: string; description?: string; actions?: ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}

export function PageLoading({ label = '加载中…' }: { label?: string }) {
  
  
  return (
    <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-primary" />
      <span className="ml-3 text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

export function PageEmpty({ label = '暂无数据', hint }: { label?: string; hint?: string }) {
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{label}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  )
}

export function PageError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Empty className="py-8" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
          <TriangleAlert aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-destructive">{message}</EmptyTitle>
        {onRetry && (
          <EmptyContent>
            <Button variant="outline" onClick={onRetry}>重试</Button>
          </EmptyContent>
        )}
      </EmptyHeader>
    </Empty>
  )
}
