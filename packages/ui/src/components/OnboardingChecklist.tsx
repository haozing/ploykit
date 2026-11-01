
import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Progress, ProgressLabel, ProgressValue } from './ui/progress'
import { Button } from './ui/button'
import { useAuth } from '@ploykit/hooks'
import { useT } from '../i18n'

export interface OnboardingItem {
  key: string
  label: string
  done: boolean
  onClick?: () => void
}

export interface OnboardingChecklistProps {
  
  items?: OnboardingItem[]
  
  storageKey?: string
  title?: string
}

const DISMISS_KEY = 'pk_onboarding_dismissed'

// 默认条目文案走字典（g9：ui.onboarding.*）——由调用方（组件渲染期）传入 t。
function defaultItems(hasWorkspaces: boolean, translate: (key: string) => string): OnboardingItem[] {
  return [
    { key: 'create-workspace', label: translate('ui.onboarding.createWorkspace'), done: hasWorkspaces },
  ]
}

export function OnboardingChecklist({
  items, storageKey = DISMISS_KEY, title,
}: OnboardingChecklistProps = {}) {
  const t = useT() // 默认标题/进度/aria 文案走字典，title prop 优先
  const { user, workspaces } = useAuth()
  
  
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1')
    } catch {
      /* localStorage 不可用（隐私模式等）按未关闭处理——effect 期兜底，非渲染期吞异常 */
    }
  }, [storageKey])

  
  const list = items ?? (user ? defaultItems(workspaces.length > 0, t) : [])
  if (!user || dismissed || list.length === 0) return null

  const doneCount = list.filter((i) => i.done).length
  const pct = Math.round((doneCount / list.length) * 100)
  const allDone = doneCount === list.length

  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      /* 隐私模式等场景忽略持久化失败 */
    }
    setDismissed(true)
  }

  return (
    <section className="w-full rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title ?? t('ui.onboarding.defaultTitle')}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {allDone ? t('ui.onboarding.allDone') : t('ui.onboarding.progressCount', { done: doneCount, total: list.length })}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={t('ui.onboarding.dismissAria')} onClick={dismiss}>
          <X />
        </Button>
      </div>

      <Progress value={pct} className="mt-3">
        <ProgressLabel>{allDone ? t('ui.onboarding.complete') : t('ui.onboarding.progress')}</ProgressLabel>
        <ProgressValue />
      </Progress>

      <ul className="mt-4 space-y-2">
        {list.map((item) => (
          <li key={item.key}>
            <button
              type="button"
              onClick={item.done ? undefined : item.onClick}
              disabled={item.done}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                item.done
                  ? 'border-transparent bg-muted/50 text-muted-foreground'
                  : 'border-border hover:bg-accent hover:text-accent-foreground',
                !item.done && !item.onClick && 'cursor-default',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border text-xs',
                  item.done ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                )}
              >
                {item.done ? '✓' : ''}
              </span>
              <span className={cn(item.done && 'line-through')}>{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
