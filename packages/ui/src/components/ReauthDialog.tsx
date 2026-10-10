import { useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useApi } from '@ploykit/hooks'
import { isApiError } from '@ploykit/client'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from './ui/dialog'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { toast } from './toast'

/**
 * Step-up（sudo mode）两段式协议的第二段（ADR 0011）：敏感操作被
 * 403 E_REAUTH_REQUIRED 拒绝后，弹本对话框验证密码（POST
 * /auth/confirm-password），成功后自动重试原请求。
 *
 * 用法：页面捕获 isApiError(err, 'E_REAUTH_REQUIRED') 时，把"重试动作"
 * （通常是 mutation.mutateAsync 绑定原参数）交给 retry，打开对话框即可。
 */
export interface ReauthDialogProps {
  open: boolean
  /** 被挑战的原动作；确认成功后重新执行一次。为 null 时对话框只确认不重试。 */
  retry: (() => Promise<unknown>) | null
  onClose: () => void
}

export function ReauthDialog({ open, retry, onClose }: ReauthDialogProps) {
  const api = useApi()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    if (!password || busy) return
    setBusy(true)
    setError('')
    try {
      await api.post('/auth/confirm-password', { password })
      if (retry) await retry()
      toast.success('已验证，操作已重试')
      setPassword('')
      onClose()
    } catch (err) {
      if (isApiError(err, 'E_UNAUTHENTICATED')) {
        setError('密码不正确，请重试')
        return
      }
      toast.error('操作失败，请稍后重试')
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose() }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4" />
            需要验证密码
          </DialogTitle>
          <DialogDescription>
            这是敏感操作，需要确认密码后自动重试。密码确认在一段时间内有效。
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-1"
          onSubmit={(e) => { e.preventDefault(); void confirm() }}
        >
          <Input
            type="password"
            autoFocus
            autoComplete="current-password"
            aria-label="当前密码"
            placeholder="当前密码"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button type="submit" disabled={!password || busy}>
              {busy ? '验证中…' : '验证并继续'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
