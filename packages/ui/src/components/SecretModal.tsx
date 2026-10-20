
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Checkbox } from './ui/checkbox'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './ui/input-group'
import { Spinner } from './ui/spinner'
import { useKitLabels } from '../labels/kit-labels'

export function SecretModal({ open, onOpenChange, secretName, secretValue, title }: {
  open: boolean
  /** 关闭回调。契约：用户勾选"我已保存"之前，本组件不会把 false 传进来——ESC、遮罩点击、关闭按钮均被拦截，调用方无需自行兜底。 */
  onOpenChange: (open: boolean) => void
  /** 密钥名称，用于默认标题「{secretName} 创建成功」。 */
  secretName: string
  /** 仅显示一次的密钥明文。传数组时逐项展示（沿用单值的只读 mono 样式），复制动作为单个「复制全部」按钮——写入剪贴板的是各项按顺序以 '\n' 连接的纯文本；「我已保存」门控语义不变。 */
  secretValue: string | string[]
  /** 可选标题，覆盖默认的「{secretName} 创建成功」——用于"重置/查看"等非创建成功场景。 */
  title?: string
}) {
  const L = useKitLabels()
  // 数组归一化：单值与 [单值] 走同一条渲染/复制路径；join('\n') 把复制目标统一成纯文本（单值 join 后仍是原字符串，行为不变）。
  const values = Array.isArray(secretValue) ? secretValue : [secretValue]
  // 状态重置的依赖取内容签名而非引用——父组件内联字面量数组每次渲染都是新引用，
  // 按引用比较会在用户勾选「我已保存」后被无谓重置 confirmed。
  const valueKey = values.join('\n')
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
  }, [open, valueKey])

  
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const copy = async () => {
    // 数组场景：以 '\n' 连接后一次性写入（纯文本回退口径）；单值 join 结果即原字符串。
    try {
      await navigator.clipboard.writeText(values.join('\n'))
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
            复制按钮沿用原 copied / copyFailed 双状态机文案，成功态图标 Copy→Check。
            数组值：逐项一行只读框（复用同一套样式），复制动作只保留一个「复制全部」——
            相比为每项配 reveal/copy，单按钮复用现有双状态机最简单、口径一致（'\n' 连接纯文本）。 */}
        {values.length === 1 ? (
          <InputGroup>
            <InputGroupInput
              readOnly
              value={values[0]}
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
        ) : (
          <div className="flex flex-col gap-2">
            {values.map((value, index) => (
              <InputGroup key={index}>
                <InputGroupInput
                  readOnly
                  value={value}
                  aria-label={`密钥 ${index + 1}（共 ${values.length} 项，只显示一次）`}
                  className="font-mono text-sm"
                />
              </InputGroup>
            ))}
            <InputGroupButton onClick={copy} className="self-start">
              {copied ? <CheckIcon /> : <CopyIcon />}
              {copied ? '已复制全部' : copyFailed ? '复制失败，请手动复制' : '复制全部'}
            </InputGroupButton>
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox checked={confirmed} onCheckedChange={setConfirmed} />
          我已将密钥保存到安全的地方
        </label>
        <DialogFooter>
          <Button onClick={() => onOpenChange(false)} disabled={!confirmed}>
            {confirmed ? L.confirmSaved : L.confirmPending}
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
