
import type { ReactNode } from 'react'
import { cn } from '../lib/utils'
import {
  Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent,
} from './ui/card'

export interface SettingsCardProps {
  title: ReactNode
  description?: ReactNode
  
  cta?: ReactNode
  
  danger?: boolean
  
  bodyClassName?: string
  children: ReactNode
}

export function SettingsCard({
  title, description, cta, danger, bodyClassName, children,
}: SettingsCardProps) {
  return (
    <Card className="my-4 w-full max-w-4xl text-left" size="sm">
      <CardHeader>
        {/* G7.1：分块卡标题升 h2（PageHeader h1 之下的文档大纲层级），
            经 card.tsx CardTitle 的 as 多态，样式/props 不变。 */}
        <CardTitle as="h2" className={cn(danger && 'text-destructive')}>{title}</CardTitle>
        {description && (
          <CardDescription className={cn(danger && 'text-destructive/80')}>
            {description}
          </CardDescription>
        )}
        {cta && <CardAction>{cta}</CardAction>}
      </CardHeader>
      <CardContent className={cn('text-left', bodyClassName)}>{children}</CardContent>
    </Card>
  )
}
