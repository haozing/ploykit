
import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router'
import { useLogin } from '@ploykit/hooks'
import { useApi } from '@ploykit/hooks'
import { useAuth } from '@ploykit/hooks'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { FormField } from '../components/FormField'
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
  
  onSuccess?: () => void
  
  title?: string
  description?: string
}

export function LoginPage({
  resetPath = '/forgot-password',
  registerPath = '/register',
  oauthProviders = [],
  enableFedLogin = false,
  onSuccess,
  title = '登录',
  description = '登录你的账号',
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
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm space-y-4 p-8 bg-white rounded-lg shadow">
        <div className="text-center">
          <h1 className="text-2xl font-bold">{title}</h1>
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        </div>

        <Tabs defaultValue="code">
          <TabsList className="w-full">
            <TabsTrigger value="code">验证码登录</TabsTrigger>
            <TabsTrigger value="password">密码登录</TabsTrigger>
          </TabsList>

          {/* 验证码模式（默认） */}
          <TabsContent value="code">
            <form onSubmit={handleCodeSubmit} className="space-y-4 pt-2">
              <div className="space-y-1">
                <label htmlFor="login-email" className="text-sm text-gray-600">邮箱</label>
                <input
                  id="login-email"
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" required autoComplete="email"
                  className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="login-code" className="text-sm text-gray-600">验证码</label>
                <div className="flex gap-2">
                  <input
                    id="login-code"
                    type="text" value={code} onChange={(e) => setCode(e.target.value)}
                    placeholder="6位数字" maxLength={6} required autoComplete="one-time-code"
                    className="flex-1 px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button
                    type="button" onClick={handleSendCode}
                    disabled={sending || cooldown > 0 || !email}
                    className="px-4 py-2 text-sm text-blue-600 border border-blue-300 rounded-md hover:bg-blue-50 disabled:opacity-50"
                  >
                    {cooldown > 0
                      ? `重发（${cooldown}s）`
                      : codeSent
                        ? '重新发送'
                        : sending
                          ? '发送中…'
                          : '发送'}
                  </button>
                </div>
              </div>
              {/* P3-29：错误 p 补 role="alert"（读屏即时播报） */}
              {sendError && <p role="alert" className="text-red-500 text-sm">{sendError}</p>}
              {codeError && <p role="alert" className="text-red-500 text-sm">{codeError}</p>}
              <button
                type="submit" disabled={loading || !email || !code}
                className="w-full py-2 px-4 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
              >
                {loading ? '登录中…' : '登录'}
              </button>
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
                <Input
                  id="login-pw-password" type="password" value={password} required
                  onChange={(e) => setPassword(e.target.value)} placeholder="输入密码"
                  autoComplete="current-password"
                />
              </FormField>
              {pwError && <p role="alert" className="text-red-500 text-sm">{pwError}</p>}
              <Button type="submit" className="w-full" disabled={pwLoading || !email || !password}>
                {pwLoading ? '登录中…' : '登录'}
              </Button>
            </form>
          </TabsContent>
        </Tabs>

        {oauthProviders.length > 0 && (
          <div className="space-y-2 pt-1" data-testid="oauth-providers">
            <div className="relative py-2 text-center">
              <span className="absolute inset-x-0 top-1/2 border-t border-gray-200" />
              <span className="relative z-10 bg-white px-2 text-xs text-gray-400">或使用以下方式登录</span>
            </div>
            {oauthProviders.map((p) => (
              <a
                key={p.id}
                href={'/auth/oauth/' + p.id + '/start'}
                className="block w-full py-2 px-4 text-center text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                使用 {p.label} 登录
              </a>
            ))}
          </div>
        )}

        {enableFedLogin && (
          <details className="pt-1" data-testid="fed-login">
            <summary className="text-sm text-gray-500 cursor-pointer select-none">企业登录</summary>
            <form method="get" action="/auth/fed/start" className="mt-2 space-y-2">
              <input
                type="text" name="workspace" placeholder="工作区标识（slug）" required
                className="w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                className="w-full py-2 px-4 bg-gray-800 text-white text-sm rounded-md hover:bg-gray-900"
              >
                通过企业 IdP 登录
              </button>
            </form>
          </details>
        )}

        <div className="flex items-center justify-between text-sm">
          <a href={resetPath} className="text-blue-600 hover:underline">
            忘记密码？
          </a>
          {registerPath && (
            <a href={registerPath} data-testid="register-link" className="text-blue-600 hover:underline">
              创建账号
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
