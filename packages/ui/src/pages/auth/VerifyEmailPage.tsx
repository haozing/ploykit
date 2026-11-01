
import { useEffect, useRef, useState } from 'react'
import { api } from '@ploykit/client'
import { AuthShell } from '../../layouts/AuthShell'
import { buttonVariants } from '../../components/ui/button'
import {
  Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription, EmptyContent,
} from '../../components/ui/empty'
import { MailCheck, LoaderCircle, CircleX } from 'lucide-react'
import { useT } from '../../i18n'

type VerifyState = 'verifying' | 'ok' | 'failed'

export interface VerifyEmailPageProps {
  /** 三态标题（i18n 覆盖点，走查 #5）：成功 / 失败 / 验证中。 */
  titles?: { ok?: string; failed?: string; verifying?: string }
}

export function VerifyEmailPage({ titles }: VerifyEmailPageProps) {
  const t = useT() // i18n（B 方案）：三态标题/说明走字典，titles prop 优先
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
      setMessage(t('auth.verify.invalidLink'))
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
        setMessage(err instanceof Error ? err.message : t('auth.verify.failedLink'))
      })
    // t 随语言变化，但 fired ref 保证只发一次请求（换语言不重发）。
  }, [t])

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
            {state === 'ok'
              ? titles?.ok ?? t('auth.verify.okTitle')
              : state === 'failed'
                ? titles?.failed ?? t('auth.verify.failedTitle')
                : titles?.verifying ?? t('auth.verify.verifyingTitle')}
          </EmptyTitle>
          <EmptyDescription>
            {state === 'ok'
              ? t('auth.verify.okDesc')
              : state === 'failed'
                ? (message ?? t('auth.verify.failedFallback'))
                : t('auth.verify.verifyingDesc')}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <a href="/login" className={buttonVariants({ variant: 'outline' })}>
            {t('auth.verify.backToLogin')}
          </a>
        </EmptyContent>
      </Empty>
    </AuthShell>
  )
}
