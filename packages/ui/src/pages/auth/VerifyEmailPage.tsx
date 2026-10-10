
import { useEffect, useRef, useState } from 'react'
import { api } from '@ploykit/client'
import { AuthShell } from '../../layouts/AuthShell'
import { buttonVariants } from '../../components/ui/button'
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from '../../components/ui/empty'
import { MailCheck, LoaderCircle, CircleX } from 'lucide-react'

type VerifyState = 'verifying' | 'ok' | 'failed'

export function VerifyEmailPage() {
  const [state, setState] = useState<VerifyState>('verifying')
  const [message, setMessage] = useState<string | null>(null)
  
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true

    const params = new URLSearchParams(window.location.search)
    const email = params.get('email') ?? ''
    const token = params.get('token') ?? ''
    if (!email || !token) {
      setState('failed')
      setMessage('链接无效：缺少邮箱或令牌参数')
      return
    }
    api
      .post('/auth/verify-email', { email, token })
      .then(() => {
        
        try {
          window.history.replaceState(null, '', window.location.pathname)
        } catch {
          /* replaceState 不可用时忽略——令牌已失效 */
        }
        setState('ok')
      })
      .catch((err: unknown) => {
        setState('failed')
        setMessage(err instanceof Error ? err.message : '验证失败，链接可能已失效')
      })
  }, [])

  return (
    <AuthShell>
      <Empty className="border-none p-0">
        <EmptyHeader>
          <EmptyMedia variant="icon" data-testid="verify-state">
            {state === 'ok' && <MailCheck className="text-(--success)" aria-hidden="true" />}
            {state === 'verifying' && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {state === 'failed' && <CircleX className="text-destructive" aria-hidden="true" />}
          </EmptyMedia>
          <EmptyTitle>
            {state === 'ok' ? '邮箱验证成功' : state === 'failed' ? '验证失败' : '正在验证…'}
          </EmptyTitle>
          <EmptyDescription>
            {state === 'ok'
              ? '感谢确认，现在可以正常登录了。'
              : state === 'failed'
                ? (message ?? '验证失败')
                : '请稍候，正在校验邮件链接…'}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <a href="/login" className={buttonVariants({ variant: 'outline' })}>
            返回登录
          </a>
        </EmptyContent>
      </Empty>
    </AuthShell>
  )
}
