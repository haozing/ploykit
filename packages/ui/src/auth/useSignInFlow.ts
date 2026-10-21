import { useEffect, useState, type FormEvent } from 'react'
import { useLocation } from '../router'
import { useLogin } from '@ploykit/hooks'
import { useApi } from '@ploykit/hooks'
import { useAuth } from '@ploykit/hooks'
import { apiErrorMessage } from '../lib/api-error'
import { useKitLabels } from '../labels/kit-labels'

/**
 * 登录表单的全部状态与行为（不含任何 JSX）。
 *
 * 抽出来的理由是代码分割：登录有三种形态（邮箱先行 / 纯密码 / 双 Tab），
 * 双 Tab 需要 Base UI 的 Tabs 原语（约 6.6KB gzip）。把逻辑留在这一个 hook
 * 里，三个渲染器各自只 import 自己需要的 UI——不用 tabs 的形态就不会把它
 * 带进 chunk。
 *
 * 行为与原 SignInForm 内联实现逐行一致：验证码发送 + 60s 冷却、验证码提交
 * （useLogin().submit）、密码提交（POST /auth/login + refresh()）、以及
 * loginRedirectTarget 的开放重定向守卫。
 */

export const SEND_COOLDOWN_S = 60

// 控制字符（含 TAB/LF/CR）：URL 解析器会在解析前剥掉它们，`/\t/evil.com` 因此
// 变成 `//evil.com`。
const urlControlChars = /[\u0000-\u001f\u007f]/;

/**
 * 回跳目标守卫：只接受站内绝对路径。
 *
 * 为什么不能只查前缀 `//`：浏览器的 URL 解析把**反斜杠当成 `/`**（WHATWG URL
 * 规范的 "special" scheme 规则），所以 `/\evil.com` 与 `//evil.com` 解析结果
 * 完全相同 —— 都是 `https://evil.com/`。同理控制字符会被剥离，`/\t/evil.com`
 * 也变成外站。两种写法都能绕过朴素的前缀守卫，构成开放重定向。
 *
 * 判定方式改为**用解析器本身作准**：以站内基准解析，看结果是否仍与基准同源。
 * 这比列举危险字符更稳——以后 URL 解析规则再怎么变，比较的仍是它自己的结果。
 */
export function loginRedirectTarget(from: unknown, fallback = '/app'): string {
  if (typeof from !== 'string' || from === '') return fallback
  if (!from.startsWith('/')) return fallback
  // 先挡住控制字符与反斜杠：不是为解析器兜底，而是这类输入从来没有正当用途，
  // 放行只会让"看起来是站内路径"的字符串悄悄变成外站。
  if (urlControlChars.test(from) || from.includes('\\')) return fallback
  if (from.startsWith('//')) return fallback
  try {
    // 以配置的站点为基准解析；结果必须与基准同源，否则视为外站。
    const base = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : 'http://localhost'
    const resolved = new URL(from, base)
    if (resolved.origin !== new URL(base).origin) return fallback
    return resolved.pathname + resolved.search + resolved.hash || fallback
  } catch {
    return fallback
  }
}

export interface UseSignInFlowOptions {
  onSuccess?: () => void
  /** 回跳兜底目标（location.state.from 缺失或非法时使用）。 */
  loginRedirectTarget?: string
}

export function useSignInFlow({ onSuccess, loginRedirectTarget: redirectFallback }: UseSignInFlowOptions) {
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

  // 发送按钮四态文案：冷却 > 已发送 > 发送中 > 初始。三处共用（tabs 验证码
  // 行内、email-first 首屏主按钮、email-first 行内重发），默认值与历史硬编码
  // 逐字一致。
  const sendButtonLabel =
    cooldown > 0
      ? kit.resendWithCooldown(cooldown)
      : codeSent
        ? '重新发送'
        : sending
          ? '发送中…'
          : kit.sendCode

  return {
    kit,
    from,
    email, setEmail,
    code, setCode,
    codeSent, setCodeSent,
    sending, sendError, cooldown,
    loading, codeError,
    password, setPassword,
    pwLoading, pwError,
    handleSendCode,
    handleCodeSubmit,
    handlePasswordSubmit,
    sendButtonLabel,
  }
}

export type SignInFlow = ReturnType<typeof useSignInFlow>
