
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'
import { Spinner } from './ui/spinner'

export function SecretModal({ open, onOpenChange, secretName, secretValue, title }: {
  open: boolean
  /** 关闭回调。契约：用户勾选"我已保存"之前，本组件不会把 false 传进来——ESC、遮罩点击、关闭按钮均被拦截，调用方无需自行兜底。 */
  onOpenChange: (open: boolean) => void
  /** 密钥名称，用于默认标题「{secretName} 创建成功」。 */
  secretName: string
  /** 仅显示一次的密钥明文。 */
  secretValue: string
  /** 可选标题，覆盖默认的「{secretName} 创建成功」——用于"重置/查看"等非创建成功场景。 */
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
    // 契约（见 props JSDoc）：确认勾选前 onOpenChange 不会收到 false——
    // ESC/遮罩/关闭按钮在此被统一拦截，防止密钥未保存即被关掉。
    <Dialog open={open} onOpenChange={(o) => confirmed && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title ?? `${secretName} 创建成功`}</DialogTitle>
          <DialogDescription>
            此密钥只显示一次，关闭后无法再次查看。请立即保存到安全的地方。
          </DialogDescription>
        </DialogHeader>
        {/* 密文经 InputGroupInput 只读展示（mono 字体，可框内滚动/选中复制）；
            复制按钮沿用原 copied / copyFailed 双状态机文案，成功态图标 Copy→Check。 */}
        <InputGroup>
          <InputGroupInput
            readOnly
            value={secretValue}
            aria-label="密钥（只显示一次）"
            className="font-mono text-sm"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton onClick={copy}>
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? '已复制' : copyFailed ? '复制失败，请手动复制' : '复制'}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={confirmed} onCheckedChange={setConfirmed} />
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

export function ImpactConfirmation({ open, onConfirm, onOpenChange, title, impacts, confirmText, danger, pending }: {
  open: boolean
  /** 点击确认按钮后回调；回调返回后组件会立即请求关闭。 */
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
  title: string
  /** 影响项列表。支持任意 ReactNode（可含链接/加粗等富文本）；key 按下标生成，注意项内容需自行保证可读。 */
  impacts: ReactNode[]
  confirmText?: string
  danger?: boolean
  /** 请求进行中：确认按钮 disabled 且文案前加 Spinner（confirmText 原样保留）；不传/false 时行为完全不变。 */
  pending?: boolean
}) {
  const [checked, setChecked] = useState(false)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>此操作将产生以下影响：</DialogDescription>
        </DialogHeader>
        {/* max-h + overflow：影响项过多时列表内部滚动，弹窗整体不被撑出视口 */}
        <ul className="max-h-48 space-y-1.5 overflow-y-auto">
          {impacts.map((impact, index) => (
            <li key={index} className="flex items-start gap-2 text-sm text-foreground">
              <span className="text-destructive mt-0.5">•</span> {impact}
            </li>
          ))}
        </ul>
        <label className="flex items-center gap-2 text-sm text-muted-foreground pt-2 border-t">
          <Checkbox checked={checked} onCheckedChange={setChecked} />
          我理解并接受以上影响
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            variant={danger ? 'destructive' : 'default'}
            disabled={!checked || pending}
            onClick={() => { onConfirm(); onOpenChange(false) }}
          >
            {pending && <Spinner aria-hidden="true" />}
            {confirmText ?? '确认执行'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
