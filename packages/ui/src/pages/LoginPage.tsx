
import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { useLogin } from '@ploykit/hooks'
import { useApi } from '@ploykit/hooks'
import { useAuth } from '@ploykit/hooks'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Button, buttonVariants } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { FormField } from '../components/FormField'
import { PasswordField } from '../components/PasswordField'
import { FieldSeparator } from '../components/ui/field'
import { Spinner } from '../components/ui/spinner'
import { AuthShell } from '../layouts/AuthShell'
import { apiErrorMessage } from '../lib/api-error'


export interface OAuthProviderOption {
  id: string
  label: string
}


const SEND_COOLDOWN_S = 60


export function loginRedirectTarget(from: unknown, fallback = '/app'): string {
  if (typeof from !== 'string') return fallback
  if (!from.startsWith('/') || from.startsWith('//')) return fallback
  return from
}

export interface LoginPageProps {

  resetPath?: string

  registerPath?: string

  oauthProviders?: OAuthProviderOption[]

  enableFedLogin?: boolean

  /**
   * 纯密码形态（企业内部工具）：隐藏验证码 Tab，页面直接是密码登录——
   * 不渲染 Tabs 结构，OAuth 槽位照常由 oauthProviders 控制（不传即无）。
   */
  passwordOnly?: boolean

  onSuccess?: () => void

  title?: string
  description?: string
}

export function LoginPage({
  resetPath = '/forgot-password',
  registerPath = '/register',
  oauthProviders = [],
  enableFedLogin = false,
  passwordOnly = false,
  onSuccess,
  title = '登录',
  description,
}: LoginPageProps) {
  const { submit, loading, error: codeError } = useLogin()
  const api = useApi()
  const { refresh } = useAuth()
  
  const from = loginRedirectTarget(
    (useLocation().state as { from?: unknown } | null)?.from,
  )

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)

  
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown((c) => c - 1), 1_000)
    return () => clearInterval(t)
  }, [cooldown])

  const [password, setPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)

  const succeed = onSuccess ?? (() => { window.location.href = from })

  const handleSendCode = async () => {
    if (!email || sending || cooldown > 0) return
    setSending(true)
    setSendError(null)
    try {
      await api.post('/auth/send-code', { email })
      setCodeSent(true)
      setCooldown(SEND_COOLDOWN_S)
    } catch (e) {
      
      setSendError(apiErrorMessage(e, '验证码发送失败，请稍后重试'))
    } finally {
      setSending(false)
    }
  }

  const handleCodeSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const result = await submit(email, code)
    if (result.ok) succeed()
  }

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setPwError(null)
    setPwLoading(true)
    try {
      await api.post('/auth/login', { email, password })
      await refresh()
      succeed()
    } catch (err) {
      
      setPwError(apiErrorMessage(err, '登录失败'))
    } finally {
      setPwLoading(false)
    }
  }

  return (
    <AuthShell>
      <div className="space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>

        {passwordOnly ? (
          <form onSubmit={handlePasswordSubmit} className="space-y-4 pt-2">
            <FormField label="邮箱" htmlFor="login-pw-email">
              <Input
                id="login-pw-email" type="email" value={email} required
                onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                autoComplete="email"
              />
            </FormField>
            <FormField label="密码" htmlFor="login-pw-password">
              <PasswordField
                id="login-pw-password" value={password} required
                onChange={(e) => setPassword(e.target.value)} placeholder="输入密码"
                autoComplete="current-password"
              />
            </FormField>
            {pwError && <p role="alert" className="text-destructive text-sm">{pwError}</p>}
            <Button type="submit" className="w-full" disabled={pwLoading || !email || !password}>
              {pwLoading ? (
                <>
                  <Spinner aria-hidden="true" />
                  登录
                </>
              ) : (
                '登录'
              )}
            </Button>
          </form>
        ) : (
        <Tabs defaultValue="code">
          <TabsList className="w-full">
            <TabsTrigger value="code">验证码登录</TabsTrigger>
            <TabsTrigger value="password">密码登录</TabsTrigger>
          </TabsList>

          {/* 验证码模式（默认） */}
          <TabsContent value="code">
            <form onSubmit={handleCodeSubmit} className="space-y-4 pt-2">
              <FormField label="邮箱" htmlFor="login-email">
                <Input
                  id="login-email"
                  type="email" value={email} required
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                  autoComplete="email"
                />
              </FormField>
              <FormField label="验证码" htmlFor="login-code">
                <div className="flex gap-2">
                  <Input
                    id="login-code"
                    type="text" value={code} required
                    onChange={(e) => setCode(e.target.value)} placeholder="6位数字"
                    maxLength={6} autoComplete="one-time-code" className="flex-1"
                  />
                  <Button
                    type="button" variant="outline" size="sm" onClick={handleSendCode}
                    disabled={sending || cooldown > 0 || !email}
                  >
                    {cooldown > 0
                      ? `重发（${cooldown}s）`
                      : codeSent
                        ? '重新发送'
                        : sending
                          ? '发送中…'
                          : '发送'}
                  </Button>
                </div>
              </FormField>
              {/* P3-29：错误 p 补 role="alert"（读屏即时播报） */}
              {sendError && <p role="alert" className="text-destructive text-sm">{sendError}</p>}
              {codeError && <p role="alert" className="text-destructive text-sm">{codeError}</p>}
              <Button type="submit" className="w-full" disabled={loading || !email || !code}>
                {loading ? (
                  <>
                    <Spinner aria-hidden="true" />
                    登录
                  </>
                ) : (
                  '登录'
                )}
              </Button>
            </form>
          </TabsContent>

          {/* 密码模式 */}
          <TabsContent value="password">
            <form onSubmit={handlePasswordSubmit} className="space-y-4 pt-2">
              <FormField label="邮箱" htmlFor="login-pw-email">
                <Input
                  id="login-pw-email" type="email" value={email} required
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                  autoComplete="email"
                />
              </FormField>
              <FormField label="密码" htmlFor="login-pw-password">
                <PasswordField
                  id="login-pw-password" value={password} required
                  onChange={(e) => setPassword(e.target.value)} placeholder="输入密码"
                  autoComplete="current-password"
                />
              </FormField>
              {pwError && <p role="alert" className="text-destructive text-sm">{pwError}</p>}
              <Button type="submit" className="w-full" disabled={pwLoading || !email || !password}>
                {pwLoading ? (
                  <>
                    <Spinner aria-hidden="true" />
                    登录
                  </>
                ) : (
                  '登录'
                )}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
        )}

        {oauthProviders.length > 0 && (
          <div className="space-y-2 pt-1" data-testid="oauth-providers">
            <FieldSeparator>或使用以下方式登录</FieldSeparator>
            {oauthProviders.map((p) => (
              <a
                key={p.id}
                href={'/auth/oauth/' + p.id + '/start'}
                className={buttonVariants({ variant: 'outline', className: 'w-full' })}
              >
                使用 {p.label} 登录
              </a>
            ))}
          </div>
        )}

        {enableFedLogin && (
          <details className="pt-1" data-testid="fed-login">
            <summary className="text-sm text-muted-foreground cursor-pointer select-none">企业登录</summary>
            <form method="get" action="/auth/fed/start" className="mt-2 space-y-2">
              <Input
                type="text" name="workspace" placeholder="工作区标识（slug）" required
              />
              <Button type="submit" className="w-full">
                通过企业 IdP 登录
              </Button>
            </form>
          </details>
        )}

        {(resetPath || registerPath) && (
          <div className="flex items-center justify-between text-sm">
            {resetPath && (
              <a href={resetPath} className="text-primary hover:underline">
                忘记密码？
              </a>
            )}
            {registerPath && (
              <a href={registerPath} data-testid="register-link" className="text-primary hover:underline">
                创建账号
              </a>
            )}
          </div>
        )}
      </div>
    </AuthShell>
  )
}
