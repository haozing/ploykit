
import { useRef, useState, type FormEvent } from 'react'
import { AuthShell } from '../../layouts/AuthShell'
import { FormField } from '../../components/FormField'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Spinner } from '../../components/ui/spinner'
import { TurnstileWidget, type TurnstileWidgetHandle } from '../../auth/TurnstileWidget'
import { useSiteConfig } from '@ploykit/hooks'
import { apiErrorMessage } from '../../lib/api-error'
import { postTurnstileProtected, turnstileSiteKey } from '../../lib/turnstile'
import { useT } from '../../i18n'

export interface ForgotPasswordPageProps {

  title?: string

  sentHint?: string

  backPath?: string
}

export function ForgotPasswordPage({
  title,
  sentHint,
  backPath = '/login',
}: ForgotPasswordPageProps) {
  const t = useT() // i18n（B 方案）：默认标题/提示走字典，title/sentHint prop 优先
  const pageTitle = title ?? t('auth.forgot.title')
  const sentHintText = sentHint ?? t('auth.forgot.sentHint')
  const { data: siteCfg } = useSiteConfig()
  // Turnstile：/auth/forgot-password 是邮件成本端点，/config 带回非空
  // site key 时挂 widget 并要求 token（未配置的产品零感知，行为不变）。
  // 这里不再走 usePasswordReset().requestReset——它不支持自定义请求头，
  // 改经 lib/turnstile 的 postTurnstileProtected（同一 apiFetch plumbing）。
  const turnstileRequired = turnstileSiteKey(siteCfg) !== null
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileWidgetHandle>(null)
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!email) return
    setError(null)
    setLoading(true)
    try {
      await postTurnstileProtected('/auth/forgot-password', { email }, turnstileToken)
      setSent(true)
    } catch (err) {
      setError(apiErrorMessage(err, t('auth.forgot.sendFailed')))
      // token 一次性：失败（含 400 E_TURNSTILE）后重置出题，不复用旧值。
      if (turnstileRequired) {
        setTurnstileToken(null)
        turnstileRef.current?.reset()
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{pageTitle}</h1>
        </div>

        {sent ? (
          <Alert data-testid="sent-hint">
            <AlertDescription>{sentHintText}</AlertDescription>
          </Alert>
        ) : (
          <>
            <FormField label={t('auth.forgot.emailLabel')} error={error ?? undefined} htmlFor="forgot-email">
              <Input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </FormField>

            <TurnstileWidget
              ref={turnstileRef}
              onToken={setTurnstileToken}
              onExpire={() => setTurnstileToken(null)}
              onError={(msg) => setError(msg)}
            />

            <Button
              type="submit"
              className="w-full"
              disabled={loading || !email || (turnstileRequired && !turnstileToken)}
            >
              {loading ? (
                <>
                  <Spinner aria-hidden="true" />
                  {t('auth.forgot.sending')}
                </>
              ) : (
                t('auth.forgot.submit')
              )}
            </Button>
          </>
        )}

        <a
          href={backPath}
          className="block text-center text-sm text-primary underline-offset-4 hover:underline"
        >
          {t('auth.forgot.backToLogin')}
        </a>
      </form>
    </AuthShell>
  )
}
