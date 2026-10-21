/**
 * SignInModal —— 登录弹层（#30）：Dialog 壳 + 内嵌 SignInForm。
 *
 * ⚠️ 成功后默认**整页硬跳转**（#24 的教训）：页内登录曾留下陈旧 CSRF 状态，
 * 客户端 self-heal（单飞 + reload 兜底）是保险丝，不是许可证——弹层登录的
 * 既定默认是成功即 `window.location.assign(回跳目标)` 整页导航，绝不复用
 * 页内软跳转。只有在消费方显式传入 `onSuccess` 时才尊重其软处理（此时
 * CSRF 自愈由 @ploykit/hooks 客户端层兜底）。
 *
 * 交互：X 关闭 / Esc / 点击遮罩关闭，均回调 onOpenChange(false)；
 * 焦点圈禁与层叠由 kit Dialog（@base-ui/react）原语提供。
 */
import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { SignInForm, loginRedirectTarget, type OAuthProviderOption } from './SignInForm'
import { hardNavigate } from './hard-navigate'
import { useLocation } from '../router'

export interface SignInModalProps {

  resetPath?: string

  registerPath?: string

  oauthProviders?: OAuthProviderOption[]

  enableFedLogin?: boolean

  /** 纯密码形态（语义同 SignInForm）。 */
  passwordOnly?: boolean

  /**
   * 成功回调。**不传 = 默认整页硬跳转**到回跳目标（location.state.from，
   * 守卫同 loginRedirectTarget，缺省 /app）；传入则完全接管成功语义，
   * 组件不做任何导航。
   */
  onSuccess?: () => void

  /** 弹层标题（默认「登录」；同时作为 DialogTitle 供读屏定位）。 */
  title?: string

  /** 弹层副标题。 */
  description?: string

  /** 法律声明行（语义同 SignInForm.legalNote：传入即替换自动法律行）。 */
  legalNote?: ReactNode

  /** 服务条款链接（与 privacyUrl 齐备时渲染自动法律行）。 */
  termsUrl?: string

  /** 隐私政策链接（与 termsUrl 齐备时渲染自动法律行）。 */
  privacyUrl?: string

  /** 表单形态（语义同 SignInForm.flow）：'tabs' | 'email-first'。 */
  flow?: 'tabs' | 'email-first'

  open: boolean

  onOpenChange: (open: boolean) => void

  /** DialogContent 宽度档位（默认 'sm'，历史弹层视觉）。 */
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

export function SignInModal({
  resetPath,
  registerPath,
  oauthProviders = [],
  enableFedLogin = false,
  passwordOnly = false,
  onSuccess,
  title = '登录',
  description,
  legalNote,
  termsUrl,
  privacyUrl,
  flow = 'email-first',
  open,
  onOpenChange,
  size = 'sm',
}: SignInModalProps) {
  // 整页硬跳转的目标：与软导航同一守卫（仅站内相对路径）。
  // 注意这里独立取 location.state——不能复用表单内部的软跳转 succeed。
  const from = loginRedirectTarget(
    (useLocation().state as { from?: unknown } | null)?.from,
  )

  // onSuccess 未传：成功 → 整页硬跳转（#24）；onOpenChange(false) 无需回调——
  // 页面即将整体卸载。传入：成功语义完全归消费方，组件零导航。
  const handleSuccess = onSuccess ?? (() => { hardNavigate(from) })

  return (
    <Dialog
      open={open}
      // 归一化为 (open: boolean) => void：base-ui 原语会附带 eventDetails 第二参
      onOpenChange={(o) => onOpenChange(o)}
    >
      <DialogContent size={size}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <SignInForm
          resetPath={resetPath}
          registerPath={registerPath}
          oauthProviders={oauthProviders}
          enableFedLogin={enableFedLogin}
          passwordOnly={passwordOnly}
          onSuccess={handleSuccess}
          title={title}
          description={description}
          legalNote={legalNote}
          termsUrl={termsUrl}
          privacyUrl={privacyUrl}
          flow={flow}
          showHeading={false}
        />
      </DialogContent>
    </Dialog>
  )
}
