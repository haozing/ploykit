/**
 * Cloudflare Turnstile 前端 widget（人机验证）。
 *
 * 挂载条件：公开 /config 下发非空 `turnstile_site_key`（管理台配置或
 * TURNSTILE_SITE_KEY env）。没配置的产品本组件 render null、不注入任何
 * 脚本——这是框架兼容底线：不启用 Turnstile 的 ploykit 产品零感知。
 *
 * 用法（auth 表单三处：注册 / 找回密码 / 登录验证码发码）：
 *
 *   const turnstileRef = useRef<TurnstileWidgetHandle>(null)
 *   const [token, setToken] = useState<string | null>(null)
 *   <TurnstileWidget ref={turnstileRef} onToken={setToken}
 *                    onExpire={() => setToken(null)} />
 *   // 提交按钮在「site key 非空 && token 为空」期间禁用；
 *   // 请求走 lib/turnstile 的 postTurnstileProtected（X-Turnstile-Token 头）。
 *
 * token 生命周期：300s 有效且**一次性**（服务端 siteverify 消费即作废），
 * 表单提交失败后必须 `turnstileRef.current?.reset()` 重取新挑战，不能复用
 * 旧 token 重试。
 *
 * 脚本加载：api.js 走 DOM 注入 + `document.getElementById` 占位去重
 * （example/web GA4 bootGA4 同款模式），模块级 promise 闸门保证 React 19
 * StrictMode 双挂载与 SPA 路由往返只注入一个 `<script>`。加载失败（网络
 * 错误 / CSP 拦截）会作废闸门、移除残尸节点并经 onError 上抛；下一次挂载
 * （重进路由、刷新页面）自然重试。
 *
 * window.turnstile 的类型用本文件内的 `declare global` 声明合并：仓库没有
 * 全局 window 扩展的 .d.ts 惯例（GA4 的 gtag 也是产品侧局部处理），官方
 * api.js 注入的第三方全局能不扩散就不扩散，声明跟着唯一消费方走。
 */
import { useEffect, useImperativeHandle, useRef, type Ref } from 'react'
import { useSiteConfig } from '@ploykit/hooks'
import { turnstileSiteKey } from '../lib/turnstile'

const SCRIPT_ID = 'ploykit-turnstile-api'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

/** 官方 api.js 显式 render 的参数面（只声明本组件用到的子集）。 */
export interface TurnstileRenderOptions {
  sitekey: string
  theme?: 'light' | 'dark' | 'auto'
  size?: 'normal' | 'compact' | 'flexible'
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: (errorCode: string) => void
  'timeout-callback'?: () => void
}

/** challenges.cloudflare.com/turnstile/v0/api.js 注入的全局对象。 */
export interface TurnstileApi {
  render(container: HTMLElement | string, options: TurnstileRenderOptions): string
  reset(widgetId?: string): void
  remove(widgetId?: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

// 模块级单次加载闸门：null = 尚未注入或上次失败已作废。
let scriptPromise: Promise<void> | null = null

function loadTurnstileApi(): Promise<void> {
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      scriptPromise = null
      reject(new Error('Turnstile 仅可在浏览器环境加载'))
      return
    }
    // 已就绪（同一页面会话内二次挂载）直接过闸。
    if (window.turnstile) return resolve()
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (!script) {
      script = document.createElement('script')
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.async = true
      document.head.appendChild(script)
    }
    script.addEventListener(
      'load',
      () => {
        if (window.turnstile) resolve()
        else {
          scriptPromise = null
          reject(new Error('Turnstile 脚本已加载但 window.turnstile 缺失'))
        }
      },
      { once: true },
    )
    script.addEventListener(
      'error',
      () => {
        // 失败即作废闸门并移除残尸节点，下一次挂载重新注入（自然重试）。
        scriptPromise = null
        document.getElementById(SCRIPT_ID)?.remove()
        reject(new Error('Turnstile 脚本加载失败（网络错误或 CSP 拦截）'))
      },
      { once: true },
    )
  })
  return scriptPromise
}

/** 测试隔离用：清掉模块级闸门与占位节点（client 包 __resetApiForTests 同款惯例）。 */
export function __resetTurnstileForTests(): void {
  scriptPromise = null
  document.getElementById(SCRIPT_ID)?.remove()
}

export interface TurnstileWidgetHandle {
  /**
   * 重置挑战：丢弃当前（可能已消费/已过期的）token 重新出题。
   * 表单提交失败后必须调用——token 一次性，旧值不可复用。
   */
  reset: () => void
}

export interface TurnstileWidgetProps {
  /** 拿到新 token（挑战通过）时回调。 */
  onToken: (token: string) => void
  /** token 过期（300s）时回调，消费方应把本地 token 置空。 */
  onExpire?: () => void
  /** 脚本加载 / 挑战出错时回调（错误信息为中文，可直接进表单错误位）。 */
  onError?: (message: string) => void
  /** 透传官方 theme 参数，默认 'auto'。 */
  theme?: 'light' | 'dark' | 'auto'
  /** 透传官方 size 参数，默认 'normal'。 */
  size?: 'normal' | 'compact' | 'flexible'
  /** React 19：ref 作为普通 prop 传入（仓库无 forwardRef 惯例）。 */
  ref?: Ref<TurnstileWidgetHandle>
}

export function TurnstileWidget({
  onToken,
  onExpire,
  onError,
  theme = 'auto',
  size = 'normal',
  ref,
}: TurnstileWidgetProps) {
  const { data: siteCfg } = useSiteConfig()
  const siteKey = turnstileSiteKey(siteCfg)

  const containerRef = useRef<HTMLDivElement>(null)
  const widgetIdRef = useRef<string | null>(null)

  // 回调走 ref 转发：父组件每次渲染传入新闭包（常见：setToken 包装）不应
  // 触发 widget 销毁重建（remove + render 会打断进行中的挑战）。
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire
  const onErrorRef = useRef(onError)
  onErrorRef.current = onError

  useEffect(() => {
    if (!siteKey) return
    let cancelled = false
    loadTurnstileApi().then(
      () => {
        if (cancelled) return
        const el = containerRef.current
        const turnstile = window.turnstile
        if (!el || !turnstile) return
        widgetIdRef.current = turnstile.render(el, {
          sitekey: siteKey,
          theme,
          size,
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onExpireRef.current?.(),
          'error-callback': (code) => onErrorRef.current?.(`人机验证异常（${code}），请重试`),
          'timeout-callback': () => onExpireRef.current?.(),
        })
      },
      (err: unknown) => {
        if (cancelled) return
        onErrorRef.current?.(err instanceof Error ? err.message : 'Turnstile 脚本加载失败')
      },
    )
    return () => {
      cancelled = true
      const id = widgetIdRef.current
      widgetIdRef.current = null
      if (id !== null && window.turnstile) {
        try {
          window.turnstile.remove(id)
        } catch {
          // 卸载竞态下 widget 可能已被官方脚本自行移除，忽略。
        }
      }
    }
  }, [siteKey, theme, size])

  useImperativeHandle(
    ref,
    () => ({
      reset: () => {
        const id = widgetIdRef.current
        if (id !== null && window.turnstile) {
          try {
            window.turnstile.reset(id)
          } catch {
            // 挑战尚未渲染完成时 reset 落空，忽略。
          }
        }
      },
    }),
    [],
  )

  // 未配置 site key：render null，零 DOM、零脚本注入。
  if (!siteKey) return null
  return <div ref={containerRef} data-testid="turnstile-widget" />
}
