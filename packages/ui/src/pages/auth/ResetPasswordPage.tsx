
import { useEffect, useState, type FormEvent } from 'react'
import { AuthShell } from '../../layouts/AuthShell'
import { FormField } from '../../components/FormField'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { usePasswordReset } from '../../hooks/usePasswordReset'
import { passwordSchema } from './RegisterPage'

export interface ResetPasswordPageProps {
  
  onDone?: string
}

const REDIRECT_DELAY_MS = 3000

export function ResetPasswordPage({ onDone }: ResetPasswordPageProps) {
  const { reset } = usePasswordReset()
  
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
      
      setConfirmError('两次输入的密码不一致')
      return
    }
    
    const pwCheck = passwordSchema.safeParse(password)
    if (!pwCheck.success) {
      setServerError(pwCheck.error.issues[0]?.message ?? '密码不符合要求')
      return
    }
    setLoading(true)
    try {
      await reset(email, token, password)
      setDone(true)
    } catch (err) {
      setServerError(err instanceof Error ? err.message : '重置失败，链接可能已失效')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">设置新密码</h1>
        </div>

        {done ? (
          <div className="space-y-2 text-center" data-testid="reset-done">
            <p className="text-sm text-emerald-600">密码已重置，全部旧会话已失效。</p>
            <p className="text-sm text-muted-foreground">
              {countdown > 0 ? `${countdown} 秒后跳转登录页…` : '正在跳转…'}
            </p>
          </div>
        ) : params === null ? (
          
          <p className="text-center text-sm text-muted-foreground">正在打开链接…</p>
        ) : !email || !token ? (
          <p className="text-center text-sm text-destructive" data-testid="reset-invalid">
            链接无效：缺少邮箱或令牌参数，请从邮件中的链接进入。
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">正在为 {email} 设置新密码</p>

            <FormField label="新密码" htmlFor="reset-new">
              <Input
                id="reset-new"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少 10 位，含三类字符"
                autoComplete="new-password"
                required
              />
            </FormField>

            <FormField
              label="确认新密码"
              error={confirmError ?? undefined}
              htmlFor="reset-confirm"
            >
              <Input
                id="reset-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="再输入一次"
                autoComplete="new-password"
                aria-invalid={confirmError ? true : undefined}
                required
              />
            </FormField>

            {serverError && (
              <p role="alert" className="text-sm text-destructive">
                {serverError}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={loading || !password || !confirm}>
              {loading ? '提交中…' : '重置密码'}
            </Button>
          </>
        )}
      </form>
    </AuthShell>
  )
}
