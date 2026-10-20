
import { type ReactNode } from 'react'
import { Inbox, TriangleAlert } from 'lucide-react'
import { cn } from '../lib/utils'
import { Button } from './ui/button'
import { Spinner } from './ui/spinner'
import { useKitLabels } from '../labels/kit-labels'
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from './ui/empty'



export function PageHeader({ title, description, actions, leading, titleClassName }: {
  title: string; description?: string; actions?: ReactNode
  /** 标题行起始处的插槽（如返回箭头/徽标），渲染在 h1 之前并与标题水平居中对齐。 */
  leading?: ReactNode
  /** 追加到 h1 的 class（orkome 采纳报告 #4：长名称 truncate、归档态淡化等
   *  消费方既有行为的迁移缝）。内置 min-w-0 保证 truncate 在 flex 行内生效。 */
  titleClassName?: string
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      {/* leading 与 h1 同处标题行（items-center 对齐）；不传 leading 时结构退化为原有的单列布局。 */}
      <div className="min-w-0">
        <div className="flex items-center gap-3">
          {leading}
          <h1 className={cn('min-w-0 truncate text-2xl font-bold text-foreground', titleClassName)} title={title}>{title}</h1>
        </div>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  )
}

export function PageLoading({ label }: { label?: string }) {
  const L = useKitLabels()
  const text = label ?? L.pageLoading
  return (
    <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
      <Spinner className="size-6 text-primary" />
      <span className="ml-3 text-sm text-muted-foreground">{text}</span>
    </div>
  )
}

export function PageEmpty({ label, hint }: { label?: string; hint?: string }) {
  const L = useKitLabels()
  const text = label ?? L.pageEmpty
  return (
    <Empty className="py-8">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Inbox aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>{text}</EmptyTitle>
        {hint && <EmptyDescription>{hint}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  )
}

export function PageError({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  const L = useKitLabels()
  return (
    <Empty className="py-8" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="bg-destructive/10 text-destructive">
          <TriangleAlert aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle className="text-destructive">{message}</EmptyTitle>
        {onRetry && (
          <EmptyContent>
            <Button variant="outline" onClick={onRetry}>{retryLabel ?? L.pageRetry}</Button>
          </EmptyContent>
        )}
      </EmptyHeader>
    </Empty>
  )
}
