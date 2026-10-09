
import { useEffect, useRef, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog'
import { Button } from './ui/Button'

export function SecretModal({ open, onOpenChange, secretName, secretValue, title }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  secretName: string
  secretValue: string
  
  title?: string
}) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  
  
  useEffect(() => {
    setCopied(false)
    setCopyFailed(false)
    setConfirmed(false)
    if (copyTimer.current) {
      clearTimeout(copyTimer.current)
      copyTimer.current = null
    }
  }, [open, secretValue])

  
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const copy = async () => {
    
    
    try {
      await navigator.clipboard.writeText(secretValue)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => {
      setCopied(false)
      setCopyFailed(false)
    }, 2000)
  }

  return (
    <Dialog open={open} onOpenChange={(o) => confirmed && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? `${secretName} 创建成功`}</DialogTitle>
          <DialogDescription>
            此密钥只显示一次，关闭后无法再次查看。请立即保存到安全的地方。
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-foreground/5 rounded font-mono text-sm break-all">
            {secretValue}
          </code>
          <Button variant="outline" size="sm" onClick={copy}>
            {copied ? '已复制' : copyFailed ? '复制失败，请手动复制' : '复制'}
          </Button>
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="rounded border-input"
          />
          我已将密钥保存到安全的地方
        </label>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={!confirmed}>
            {confirmed ? '我已保存' : '请先确认已保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ImpactConfirmation({ open, onConfirm, onOpenChange, title, impacts, confirmText, danger }: {
  open: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  title: string
  impacts: string[]
  confirmText?: string
  danger?: boolean
}) {
  const [checked, setChecked] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>此操作将产生以下影响：</DialogDescription>
        </DialogHeader>
        <ul className="space-y-1.5">
          {impacts.map((impact) => (
            <li key={impact} className="flex items-start gap-2 text-sm text-foreground">
              <span className="text-destructive mt-0.5">•</span> {impact}
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="rounded border-input"
          />
          我理解并接受以上影响
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            disabled={!checked}
            onClick={() => { onConfirm(); onOpenChange(false) }}
          >
            {confirmText ?? '确认执行'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
