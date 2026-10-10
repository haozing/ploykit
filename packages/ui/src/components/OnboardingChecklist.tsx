
import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../lib/utils'
import { Progress, ProgressLabel, ProgressValue } from './ui/progress'
import { Button } from './ui/Button'
import { useAuth } from '@ploykit/hooks'

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

function defaultItems(hasWorkspaces: boolean): OnboardingItem[] {
  return [
    { key: 'create-workspace', label: '创建第一个工作区', done: hasWorkspaces },
  ]
}

export function OnboardingChecklist({
  items, storageKey = DISMISS_KEY, title = '开始使用',
}: OnboardingChecklistProps = {}) {
  const { user, workspaces } = useAuth()
  
  
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(storageKey) === '1')
    } catch {
      /* localStorage 不可用（隐私模式等）按未关闭处理——effect 期兜底，非渲染期吞异常 */
    }
  }, [storageKey])

  
  const list = items ?? (user ? defaultItems(workspaces.length > 0) : [])
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
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {allDone ? '全部完成，开始你的旅程吧！' : `已完成 ${doneCount}/${list.length} 项`}
          </p>
        </div>
        <Button variant="ghost" size="iconSm" aria-label="关闭引导清单" onClick={dismiss}>
          <X />
        </Button>
      </div>

      <Progress value={pct} className="mt-3">
        <ProgressLabel>{allDone ? '完成' : '进度'}</ProgressLabel>
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
