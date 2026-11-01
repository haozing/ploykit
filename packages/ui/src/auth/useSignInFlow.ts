import { createElement, Fragment, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useLocation } from '../router'
import { useLogin } from '@ploykit/hooks'
import { useApi } from '@ploykit/hooks'
import { useAuth } from '@ploykit/hooks'
import { useSiteConfig } from '@ploykit/hooks'
import { apiErrorMessage } from '../lib/api-error'
import { postTurnstileProtected, turnstileSiteKey } from '../lib/turnstile'
import { DEFAULT_KIT_LABELS, useKitLabels, type KitLabels } from '../labels/kit-labels'
import { useT } from '../i18n'
import type { TurnstileWidgetHandle } from './TurnstileWidget'

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

/** kit-labels 的 signIn 系键在 i18n 字典（g7 分片）里的对应键。 */
const SIGNIN_I18N_KEYS = {
  signInEmailLabel: 'auth.signIn.emailLabel',
  signInCodeLabel: 'auth.signIn.codeLabel',
  signInPasswordLabel: 'auth.signIn.passwordLabel',
  sendCode: 'auth.signIn.sendCode',
  signInCodeTab: 'auth.signIn.codeTab',
  signInPasswordTab: 'auth.signIn.passwordTab',
  signInSubmitCode: 'auth.signIn.submit',
  signInSubmitPassword: 'auth.signIn.submit',
  signInForgotPassword: 'auth.signIn.forgot',
  signInCreateAccount: 'auth.signIn.createAccount',
} as const

/**
 * signIn 系 kit-labels 的字典解析（i18n B 方案，g7 分片）：
 *
 * - 宿主**显式**经 KitLabelsProvider / labels prop 覆盖的值照旧生效——判据是
 *   与 DEFAULT_KIT_LABELS 不同（string 值比较 / 函数引用比较；无 Provider 时
 *   useKitLabels 返回的就是 DEFAULT 本尊，函数键引用相同）。
 * - 未覆盖的键不再用内置中文默认值，改走 t() 字典（默认 EN，zh 可选）。
 *   kit-labels.tsx 本体不动（g10 分片同款裁定：其余组件的 kit 键不受影响）。
 */
export function resolveSignInKitLabels(rawKit: Required<KitLabels>, t: (key: string, vars?: Record<string, string | number>) => string): Required<KitLabels> {
  const out: Required<KitLabels> = { ...rawKit }
  for (const key of Object.keys(SIGNIN_I18N_KEYS) as (keyof typeof SIGNIN_I18N_KEYS)[]) {
    if (out[key] !== DEFAULT_KIT_LABELS[key]) continue
    out[key] = t(SIGNIN_I18N_KEYS[key])
  }
  if (out.resendWithCooldown === DEFAULT_KIT_LABELS.resendWithCooldown) {
    out.resendWithCooldown = (seconds: number) => t('auth.signIn.resendIn', { seconds })
  }
  if (out.signInLegalNote === DEFAULT_KIT_LABELS.signInLegalNote) {
    out.signInLegalNote = (termsUrl: string, privacyUrl: string) =>
      createElement(
        Fragment,
        null,
        t('auth.signIn.legalIntro'), ' ',
        createElement('a', { href: termsUrl, target: '_blank', rel: 'noopener noreferrer', className: 'text-primary hover:underline' }, t('auth.signIn.legalTerms')),
        ' ', t('auth.signIn.legalAnd'), ' ',
        createElement('a', { href: privacyUrl, target: '_blank', rel: 'noopener noreferrer', className: 'text-primary hover:underline' }, t('auth.signIn.legalPrivacy')),
      )
  }
  return out
}

export function useSignInFlow({ onSuccess, loginRedirectTarget: redirectFallback }: UseSignInFlowOptions) {
  const rawKit = useKitLabels()
  const t = useT()
  // kit 覆盖优先、其余走字典（见 resolveSignInKitLabels 注释）。
  const kit = useMemo(() => resolveSignInKitLabels(rawKit, t), [rawKit, t])
  const { submit, loading, error: codeError } = useLogin()
  const api = useApi()
  const { refresh } = useAuth()

  // Turnstile：/auth/send-code 是邮件成本端点，/config 带回非空 site key 时
  // 要求 token（未配置的产品零感知）。验证码提交（/auth/verify-code）与密码
  // 登录（/auth/login）不挂——服务端不校验，不加摩擦。widget 实例与 token
  // 状态放在 flow 里：三种形态渲染器（email-first / tabs / modal 复用）经
  // flow 对象统一拿到 ref 与回调，不用各自再接一份。
  const { data: siteCfg } = useSiteConfig()
  const turnstileRequired = turnstileSiteKey(siteCfg) !== null
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const turnstileRef = useRef<TurnstileWidgetHandle>(null)

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
    // Turnstile 启用时没拿到 token 不发（按钮本身也被禁用，这里是行为兜底）。
    if (turnstileRequired && !turnstileToken) return
    setSending(true)
    setSendError(null)
    try {
      await postTurnstileProtected('/auth/send-code', { email }, turnstileToken)
      setCodeSent(true)
      setCooldown(SEND_COOLDOWN_S)
      // token 一次性：发码成功即被服务端消费。冷却后重发需要新挑战，
      // 现在就清掉旧值并重置 widget（而非等到重发失败）。
      if (turnstileRequired) {
        setTurnstileToken(null)
        turnstileRef.current?.reset()
      }
    } catch (e) {
      setSendError(apiErrorMessage(e, t('auth.signIn.sendCodeFailed')))
      if (turnstileRequired) {
        setTurnstileToken(null)
        turnstileRef.current?.reset()
      }
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
      setPwError(apiErrorMessage(err, t('auth.signIn.signInFailed')))
    } finally {
      setPwLoading(false)
    }
  }

  // 发送按钮四态文案：冷却 > 已发送 > 发送中 > 初始。三处共用（tabs 验证码
  // 行内、email-first 首屏主按钮、email-first 行内重发）；冷却/初始两态经
  // 解析后的 kit（宿主覆盖优先，否则走 g7 字典）。
  const sendButtonLabel =
    cooldown > 0
      ? kit.resendWithCooldown(cooldown)
      : codeSent
        ? t('auth.signIn.resend')
        : sending
          ? t('auth.signIn.sending')
          : kit.sendCode

  return {
    kit,
    from,
    email, setEmail,
    code, setCode,
    codeSent, setCodeSent,
    sending, sendError, setSendError, cooldown,
    loading, codeError,
    password, setPassword,
    pwLoading, pwError,
    handleSendCode,
    handleCodeSubmit,
    handlePasswordSubmit,
    sendButtonLabel,
    turnstileRequired,
    turnstileToken,
    turnstileRef,
    setTurnstileToken,
    clearTurnstileToken: () => setTurnstileToken(null),
  }
}

export type SignInFlow = ReturnType<typeof useSignInFlow>
