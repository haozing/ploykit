
import { useEffect, useState, type FormEvent } from 'react'
import { AuthShell } from '../../layouts/AuthShell'
import { FormField } from '../../components/FormField'
import { PasswordField } from '../../components/PasswordField'
import { Button } from '../../components/ui/button'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Spinner } from '../../components/ui/spinner'
import { usePasswordReset } from '@ploykit/hooks'
import { passwordSchema } from '../../lib/password-schema'
import { useT } from '../../i18n'

export interface ResetPasswordPageProps {
  
  onDone?: string
  
  /** 页面标题（i18n 覆盖点，走查 #5）。 */
  title?: string
  
  /** 成功态文案（i18n 覆盖点）。 */
  successHint?: string
}

const REDIRECT_DELAY_MS = 3000

export function ResetPasswordPage({
  onDone,
  title,
  successHint,
}: ResetPasswordPageProps) {
  const { reset } = usePasswordReset()
  const t = useT() // i18n（B 方案）：默认标题/成功文案走字典，title/successHint prop 优先
  const pageTitle = title ?? t('auth.reset.title')
  const successHintText = successHint ?? t('auth.reset.successHint')
  
  const [params, setParams] = useState<URLSearchParams | null>(null)
  const email = params?.get('email') ?? ''
  const token = params?.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [countdown, setCountdown] = useState(REDIRECT_DELAY_MS / 1000)
  
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)

  useEffect(() => {
    setParams(new URLSearchParams(window.location.search))
  }, [])

  useEffect(() => {
    if (!done) return
    
    try {
      window.history.replaceState(null, '', window.location.pathname)
    } catch {
      /* replaceState 不可用（极端沙箱）时忽略——令牌已失效，仅剩地址残留 */
    }
    const tick = setInterval(() => setCountdown((c) => c - 1), 1000)
    const jump = setTimeout(() => {
      window.location.href = onDone ?? '/login'
    }, REDIRECT_DELAY_MS)
    return () => {
      clearInterval(tick)
      clearTimeout(jump)
    }
  }, [done, onDone])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setConfirmError(null)
    setServerError(null)
    if (!password || !confirm) return
    if (password !== confirm) {

      setConfirmError(t('auth.reset.mismatch'))
      return
    }

    const pwCheck = passwordSchema.safeParse(password)
    if (!pwCheck.success) {
      setServerError(pwCheck.error.issues[0]?.message ?? t('auth.reset.weak'))
      return
    }
    setLoading(true)
    try {
      await reset(email, token, password)
      setDone(true)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t('auth.reset.failed'))
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

        {done ? (
          <div className="space-y-2 text-center" data-testid="reset-done">
            <p className="text-sm text-(--success)">{successHintText}</p>
            <p className="text-sm text-muted-foreground">
              {countdown > 0 ? t('auth.reset.redirectIn', { seconds: countdown }) : t('auth.reset.redirecting')}
            </p>
          </div>
        ) : params === null ? (

          <p className="text-center text-sm text-muted-foreground">{t('auth.reset.opening')}</p>
        ) : !email || !token ? (
          <Alert variant="destructive" data-testid="reset-invalid">
            <AlertDescription>
              {t('auth.reset.invalidLink')}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t('auth.reset.settingFor', { email })}</p>

            <FormField label={t('auth.reset.newLabel')} htmlFor="reset-new">
              <PasswordField
                id="reset-new"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.reset.newPlaceholder')}
                autoComplete="new-password"
                required
              />
            </FormField>

            <FormField
              label={t('auth.reset.confirmLabel')}
              error={confirmError ?? undefined}
              htmlFor="reset-confirm"
            >
              <PasswordField
                id="reset-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={t('auth.reset.confirmPlaceholder')}
                autoComplete="new-password"
                required
              />
            </FormField>

            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading || !password || !confirm}>
              {loading ? (
                <>
                  <Spinner aria-hidden="true" />
                  {t('auth.reset.submitting')}
                </>
              ) : (
                t('auth.reset.submit')
              )}
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  )
}
