/**
 * SignInForm —— 无壳登录表单（#30）。三种形态：
 *
 * - `email-first`（默认，前台推荐）：首屏只有邮箱 + 一个主按钮，发送成功后
 *   验证码框才出现（渐进披露）。密码通过下方「使用密码登录」切换，不占首屏
 *   权重。业界主流形态（Google/Linear/Vercel 一类），因为它把首屏的选择
 *   从「验证码还是密码」降成一个输入框。
 * - `passwordOnly`（企业内部工具）：直接给邮箱 + 密码，无验证码。
 * - `tabs`（老形态，验证码/密码平分权重）：**按需加载**——Base UI 的 Tabs
 *   原语整块约 4.9KB gzip（实测产物），不用它的形态不付这笔字节。
 *
 * 逻辑全部在 useSignInFlow（状态/发送冷却/两种提交/回跳守卫），本文件只做
 * 布局。壳（AuthShell / Dialog）由消费方决定：LoginPage 套 AuthShell，
 * SignInModal 套 Dialog。成功后的跳转语义由 onSuccess 决定——未传时默认
 * `window.location.href = from`；弹层场景用 SignInModal（默认整页硬跳）。
 *
 * **约束**：`flow='tabs'` 与 `render: 'static'` 不兼容。tabs 子模块是动态
 * import，renderx 在 QuickJS 沙箱里同步渲染、从不 pump promise，懒加载的
 * 分支会渲染成 Suspense 占位符 `<!--$!-->`（非空文档，靠断言 A2′ 构建期拦下）。需要预渲染
 * 的登录页用 email-first（默认值）或 passwordOnly。
 */
import { Suspense, lazy, useState, type ReactNode } from 'react'
import { Button } from '../components/ui/button'
import { Spinner } from '../components/ui/spinner'
import { TurnstileWidget } from './TurnstileWidget'
import {
  SignInCodeErrors,
  SignInCodeField,
  SignInEmailField,
  SignInFedLogin,
  SignInFooterLinks,
  SignInLegal,
  SignInOAuthBlock,
  SignInOr,
  SignInPasswordForm,
  type OAuthProviderOption,
} from './sign-in-parts'
import { useSignInFlow, type SignInFlow } from './useSignInFlow'

// 只在 flow === 'tabs' 时下载。不用 tabs 的产品，chunk 里不含它的实现。
const SignInFormTabs = lazy(() => import('./SignInFormTabs'))

export type { OAuthProviderOption } from './sign-in-parts'
export { loginRedirectTarget, SEND_COOLDOWN_S } from './useSignInFlow'

export interface SignInFormProps {
  resetPath?: string
  registerPath?: string
  oauthProviders?: OAuthProviderOption[]
  enableFedLogin?: boolean

  /**
   * 自定义第三方登录区（ReactNode）：非空时**整块替换**默认的
   * SignInOAuthBlock（oauthProviders 数组渲染的「使用 X 登录」按钮）与
   * 其后的「或使用邮箱」分隔行——品牌化入口（官方 G/GitHub mark、英文
   * 文案、自定义样式）由消费方自带，分隔行自己渲染。未传 = 现行为。
   * shuijing 第二次出现该需求（登录页 2026-10-16 手工抑制 + 弹层
   * 2026-10-31），第二次出现即框架缝的信号。
   */
  renderOAuth?: ReactNode

  /** 纯密码形态（企业内部工具）：直接给邮箱 + 密码，不渲染验证码与 Tab。 */
  passwordOnly?: boolean

  onSuccess?: () => void

  /**
   * 回跳兜底目标（location.state.from 缺失或非法时使用）。管理端专用门传
   * '/admin'；消费方整页壳（LoginPage）一般不需要动它。
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
   * 表单形态。默认 `'email-first'`（见文件头说明）。
   * `'tabs'` 会额外加载一个子 chunk，且不能用于 `render: 'static'` 页面。
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
  renderOAuth,
  passwordOnly = false,
  onSuccess,
  loginRedirectTarget: redirectFallback,
  title = '登录',
  description,
  legalNote,
  termsUrl,
  privacyUrl,
  flow = 'email-first',
  showHeading = true,
}: SignInFormProps) {
  const signIn = useSignInFlow({ onSuccess, loginRedirectTarget: redirectFallback })
  const kit = signIn.kit
  // email-first 里「使用密码登录」把它切到密码表单（可逆，不占首屏权重）。
  const [passwordMode, setPasswordMode] = useState(false)

  // 法律声明行：legalNote 传入即胜出；否则 termsUrl+privacyUrl 齐备时渲染自动行。
  const legal =
    legalNote ??
    (termsUrl && privacyUrl ? kit.signInLegalNote(termsUrl, privacyUrl) : null)

  // 邮箱先行：发送前整个表单的提交动作就是发码（主按钮即发送按钮）。
  const handleEmailFirstPreSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void signIn.handleSendCode()
  }

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

      {/* 第三方登录在表单之上：一键登录是首选路径，邮箱表单是备选。
          renderOAuth 非空时整块替换默认 OAuth 区（含分隔行）。 */}
      {renderOAuth ?? (
        <>
          <SignInOAuthBlock providers={oauthProviders} />
          {oauthProviders.length > 0 && !passwordOnly && !passwordMode && (
            <SignInOr>或使用邮箱</SignInOr>
          )}
        </>
      )}

      {passwordOnly ? (
        <SignInPasswordForm flow={signIn} />
      ) : flow === 'tabs' ? (
        <Suspense fallback={<SignInTabsFallback flow={signIn} />}>
          <SignInFormTabs flow={signIn} />
        </Suspense>
      ) : passwordMode ? (
        <>
          <SignInPasswordForm flow={signIn} />
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setPasswordMode(false)}
          >
            改用验证码登录
          </button>
        </>
      ) : (
        <>
          <form
            onSubmit={signIn.codeSent ? signIn.handleCodeSubmit : handleEmailFirstPreSubmit}
            className="space-y-4"
          >
            <SignInEmailField flow={signIn} />
            {signIn.codeSent && <SignInCodeField flow={signIn} />}
            {/* Turnstile 只护发码（邮件成本端点）：验证码提交/密码登录不挂。 */}
            {!signIn.codeSent && (
              <TurnstileWidget
                ref={signIn.turnstileRef}
                onToken={signIn.setTurnstileToken}
                onExpire={signIn.clearTurnstileToken}
                onError={(msg) => signIn.setSendError(msg)}
              />
            )}
            <SignInCodeErrors flow={signIn} />
            <Button
              type="submit"
              className="w-full"
              disabled={
                signIn.codeSent
                  ? signIn.loading || !signIn.email || !signIn.code
                  : signIn.sending ||
                    signIn.cooldown > 0 ||
                    !signIn.email ||
                    (signIn.turnstileRequired && !signIn.turnstileToken)
              }
            >
              {signIn.codeSent ? (
                signIn.loading ? (
                  <>
                    <Spinner aria-hidden="true" />
                    {kit.signInSubmitCode}
                  </>
                ) : (
                  kit.signInSubmitCode
                )
              ) : signIn.sending ? (
                <>
                  <Spinner aria-hidden="true" />
                  {signIn.sendButtonLabel}
                </>
              ) : (
                signIn.sendButtonLabel
              )}
            </Button>
          </form>
          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setPasswordMode(true)}
          >
            使用密码登录
          </button>
        </>
      )}

      {enableFedLogin && <SignInFedLogin />}
      <SignInLegal legal={legal} />
      <SignInFooterLinks flow={signIn} resetPath={resetPath} registerPath={registerPath} />
    </div>
  )
}

/**
 * tabs 子 chunk 下载期间的占位。只在 flow='tabs' 的客户端首帧出现；预渲染
 * 页面不会走到这里（tabs 与 render:'static' 不兼容，见文件头）。
 */
function SignInTabsFallback({ flow }: { flow: SignInFlow }) {
  return (
    <div className="space-y-4 pt-2" aria-busy="true">
      <div className="h-9 w-full rounded-lg bg-muted" />
      <SignInEmailField flow={flow} />
      <div className="h-9 w-full rounded-lg bg-muted" />
    </div>
  )
}
