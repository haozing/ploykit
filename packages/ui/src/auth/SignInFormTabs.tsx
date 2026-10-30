import { Button } from '../components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Spinner } from '../components/ui/spinner'
import { SignInCodeErrors, SignInCodeField, SignInEmailField, SignInPasswordForm } from './sign-in-parts'
import { TurnstileWidget } from './TurnstileWidget'
import type { SignInFlow } from './useSignInFlow'

/**
 * 双 Tab 登录形态（验证码 / 密码平分权重）。
 *
 * **独立成模块是为了代码分割**：Base UI 的 Tabs 原语 + 组合件机制约 6.6KB
 * gzip，而只用邮箱先行或纯密码形态的产品不该付这笔字节。SignInForm 在
 * `flow === 'tabs'` 时才动态 import 本文件，所以不用 tabs 的产品，chunk 里
 * 根本不含 tabs。
 *
 * 何时还用 tabs：内部工具/老用户为主的场景，密码是常态且用户明确知道自己
 * 有密码。面向新访客的前台登录应优先 `email-first`——它少一个选择，首屏
 * 就一个输入框（业界主流形态）。
 */
export default function SignInFormTabs({ flow }: { flow: SignInFlow }) {
  return (
    <Tabs defaultValue="code">
      <TabsList className="w-full">
        <TabsTrigger value="code">{flow.kit.signInCodeTab}</TabsTrigger>
        <TabsTrigger value="password">{flow.kit.signInPasswordTab}</TabsTrigger>
      </TabsList>

      <TabsContent value="code">
        <form onSubmit={flow.handleCodeSubmit} className="space-y-4 pt-2">
          <SignInEmailField flow={flow} />
          <SignInCodeField flow={flow} />
          {/* Turnstile 只护发码（验证码 Tab 的发送/重发按钮），密码 Tab 不挂。 */}
          <TurnstileWidget
            ref={flow.turnstileRef}
            onToken={flow.setTurnstileToken}
            onExpire={flow.clearTurnstileToken}
            onError={(msg) => flow.setSendError(msg)}
          />
          <SignInCodeErrors flow={flow} />
          <Button type="submit" className="w-full" disabled={flow.loading || !flow.email || !flow.code}>
            {flow.loading ? (
              <>
                <Spinner aria-hidden="true" />
                {flow.kit.signInSubmitCode}
              </>
            ) : (
              flow.kit.signInSubmitCode
            )}
          </Button>
        </form>
      </TabsContent>

      <TabsContent value="password">
        <SignInPasswordForm flow={flow} />
      </TabsContent>
    </Tabs>
  )
}
