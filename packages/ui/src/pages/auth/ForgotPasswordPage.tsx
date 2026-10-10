
import { useState, type FormEvent } from 'react'
import { AuthShell } from '../../layouts/AuthShell'
import { FormField } from '../../components/FormField'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { usePasswordReset } from '@ploykit/hooks'

export interface ForgotPasswordPageProps {
  
  title?: string
  
  sentHint?: string
  
  backPath?: string
}

export function ForgotPasswordPage({
  title = '找回密码',
  sentHint = '如果该邮箱存在，重置链接已发送，请查收邮箱。',
  backPath = '/login',
}: ForgotPasswordPageProps) {
  const { requestReset } = usePasswordReset()
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
      await requestReset(email)
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthShell>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        </div>

        {sent ? (
          <p className="text-sm text-muted-foreground" data-testid="sent-hint">
            {sentHint}
          </p>
        ) : (
          <>
            <FormField label="邮箱" error={error ?? undefined} htmlFor="forgot-email">
              <Input
                id="forgot-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
              />
            </FormField>

            <Button type="submit" className="w-full" disabled={loading || !email}>
              {loading ? '发送中…' : '发送重置链接'}
            </Button>
          </>
        )}

        <a
          href={backPath}
          className="block text-center text-sm text-primary underline-offset-4 hover:underline"
        >
          返回登录
        </a>
      </form>
    </AuthShell>
  )
}
