/**
 * SignInForm —— 从 LoginPage 提取的无壳登录表单（#30）。
 *
 * 承载全部登录流逻辑（与原 LoginPage 逐行为一致）：
 *   - 验证码发送 + 60s 冷却倒计时
 *   - 验证码提交（useLogin().submit）
 *   - 密码提交（POST /auth/login + refresh()）
 *   - OAuth 按钮渲染 /auth/oauth/{id}/start
 *   - loginRedirectTarget 开放重定向守卫（默认回跳 /app，兜底可经
 *     loginRedirectTarget prop 覆盖——AdminSignInPage 传 '/admin'）
 *
 * 壳（AuthShell / Dialog）由消费方决定：LoginPage 套 AuthShell，
 * SignInModal 套 Dialog。成功后的跳转语义也由消费方经 onSuccess 决定——
 * 未传 onSuccess 时表单默认 `window.location.href = from`（软导航，历史行为）；
 * 弹层场景请用 SignInModal（默认整页硬跳转，见其组件注释）。
 */
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation } from '../router'
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
import { apiErrorMessage } from '../lib/api-error'
import { useKitLabels } from '../labels/kit-labels'


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

export interface SignInFormProps {

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

  /**
   * 回跳兜底目标（守卫 loginRedirectTarget 的 fallback，默认 '/app'）：
   * location.state.from 缺失或非法时落这里。管理端专用门传 '/admin'，
   * 消费方整页壳（LoginPage）一般不需要动它。
   */
  loginRedirectTarget?: string

  title?: string
  description?: string

  /**
   * 法律声明行（ReactNode）：传入即**整行替换**自动法律行
   * （termsUrl + privacyUrl 齐备时渲染的「登录即同意 服务条款 与 隐私政策」）。
   */
  legalNote?: ReactNode

  /** 服务条款链接；与 privacyUrl 同时设置才渲染自动法律行。 */
  termsUrl?: string

  /** 隐私政策链接；与 termsUrl 同时设置才渲染自动法律行。 */
  privacyUrl?: string

  /**
   * 表单形态：'tabs'（默认，验证码/密码双 Tab）| 'email-first'（邮箱先行：
   * 首屏只有邮箱 + 发送按钮，验证码输入框在发送成功后才出现——渐进披露）。
   */
  flow?: 'tabs' | 'email-first'

  /** 内部槽位：SignInModal 复用本表单时关闭自带标题（由 DialogTitle 承担）。 */
  showHeading?: boolean
}

export function SignInForm({
  resetPath = '/forgot-password',
  registerPath = '/register',
  oauthProviders = [],
  enableFedLogin = false,
  passwordOnly = false,
  onSuccess,
  loginRedirectTarget: redirectFallback,
  title = '登录',
  description,
  legalNote,
  termsUrl,
  privacyUrl,
  flow = 'tabs',
  showHeading = true,
}: SignInFormProps) {
  const kit = useKitLabels()
  const { submit, loading, error: codeError } = useLogin()
  const api = useApi()
  const { refresh } = useAuth()

  const from = loginRedirectTarget(
    (useLocation().state as { from?: unknown } | null)?.from,
    redirectFallback,
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

  // 发送按钮四态文案：冷却 > 已发送 > 发送中 > 初始。
  // 三处共用（tabs 验证码行内、email-first 首屏主按钮、email-first 行内重发），
  // 默认值与历史硬编码逐字一致。
  const sendButtonLabel =
    cooldown > 0
      ? kit.resendWithCooldown(cooldown)
      : codeSent
        ? '重新发送'
        : sending
          ? '发送中…'
          : kit.sendCode

  // 邮箱先行形态：发送前整个表单的提交动作就是发码（主按钮即发送按钮）。
  const handleEmailFirstPreSubmit = (e: FormEvent) => {
    e.preventDefault()
    void handleSendCode()
  }

  // 法律声明行：legalNote 传入即胜出；否则 termsUrl+privacyUrl 齐备时渲染自动行。
  const legal =
    legalNote ??
    (termsUrl && privacyUrl ? kit.signInLegalNote(termsUrl, privacyUrl) : null)

  return (
    <div className="space-y-4">
      {showHeading && (
        <div className="text-center">
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && (
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          )}
        </div>
      )}

      {passwordOnly ? (
        <form onSubmit={handlePasswordSubmit} className="space-y-4 pt-2">
          <FormField label={kit.signInEmailLabel} htmlFor="login-pw-email">
            <Input
              id="login-pw-email" type="email" value={email} required
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              autoComplete="email"
            />
          </FormField>
          <FormField label={kit.signInPasswordLabel} htmlFor="login-pw-password">
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
                {kit.signInSubmitPassword}
              </>
            ) : (
              kit.signInSubmitPassword
            )}
          </Button>
        </form>
      ) : flow === 'email-first' ? (
        /* 邮箱先行（渐进披露）：验证码输入框仅在发送成功后出现 */
        <form
          onSubmit={codeSent ? handleCodeSubmit : handleEmailFirstPreSubmit}
          className="space-y-4 pt-2"
        >
          <FormField label={kit.signInEmailLabel} htmlFor="login-email">
            <Input
              id="login-email"
              type="email" value={email} required
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
              autoComplete="email"
            />
          </FormField>
          {codeSent && (
            <FormField label={kit.signInCodeLabel} htmlFor="login-code">
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
                  {sendButtonLabel}
                </Button>
              </div>
            </FormField>
          )}
          {/* P3-29：错误 p 补 role="alert"（读屏即时播报） */}
          {sendError && <p role="alert" className="text-destructive text-sm">{sendError}</p>}
          {codeError && <p role="alert" className="text-destructive text-sm">{codeError}</p>}
          <Button
            type="submit" className="w-full"
            disabled={codeSent ? loading || !email || !code : sending || cooldown > 0 || !email}
          >
            {codeSent ? (
              loading ? (
                <>
                  <Spinner aria-hidden="true" />
                  {kit.signInSubmitCode}
                </>
              ) : (
                kit.signInSubmitCode
              )
            ) : (
              sending ? (
                <>
                  <Spinner aria-hidden="true" />
                  {sendButtonLabel}
                </>
              ) : (
                sendButtonLabel
              )
            )}
          </Button>
        </form>
      ) : (
        <Tabs defaultValue="code">
          <TabsList className="w-full">
            <TabsTrigger value="code">{kit.signInCodeTab}</TabsTrigger>
            <TabsTrigger value="password">{kit.signInPasswordTab}</TabsTrigger>
          </TabsList>

          {/* 验证码模式（默认） */}
          <TabsContent value="code">
            <form onSubmit={handleCodeSubmit} className="space-y-4 pt-2">
              <FormField label={kit.signInEmailLabel} htmlFor="login-email">
                <Input
                  id="login-email"
                  type="email" value={email} required
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                  autoComplete="email"
                />
              </FormField>
              <FormField label={kit.signInCodeLabel} htmlFor="login-code">
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
                    {sendButtonLabel}
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
                    {kit.signInSubmitCode}
                  </>
                ) : (
                  kit.signInSubmitCode
                )}
              </Button>
            </form>
          </TabsContent>

          {/* 密码模式 */}
          <TabsContent value="password">
            <form onSubmit={handlePasswordSubmit} className="space-y-4 pt-2">
              <FormField label={kit.signInEmailLabel} htmlFor="login-pw-email">
                <Input
                  id="login-pw-email" type="email" value={email} required
                  onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                  autoComplete="email"
                />
              </FormField>
              <FormField label={kit.signInPasswordLabel} htmlFor="login-pw-password">
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
                    {kit.signInSubmitPassword}
                  </>
                ) : (
                  kit.signInSubmitPassword
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

      {legal && (
        <p className="pt-1 text-center text-xs text-muted-foreground">{legal}</p>
      )}

      {(resetPath || registerPath) && (
        <div className="flex items-center justify-between text-sm">
          {resetPath && (
            <a href={resetPath} className="text-primary hover:underline">
              {kit.signInForgotPassword}
            </a>
          )}
          {registerPath && (
            <a href={registerPath} data-testid="register-link" className="text-primary hover:underline">
              {kit.signInCreateAccount}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
