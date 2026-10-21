import type { ReactNode } from 'react'
import { Button, buttonVariants } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { FormField } from '../components/FormField'
import { PasswordField } from '../components/PasswordField'
import { FieldSeparator } from '../components/ui/field'
import { Spinner } from '../components/ui/spinner'
import type { SignInFlow } from './useSignInFlow'

/**
 * 登录各形态共享的 UI 片段。
 *
 * 这里刻意不含 Tabs：它是唯一需要 Base UI 组合件原语的形态，独立成
 * SignInFormTabs 并由 SignInForm 按需加载。共享片段留在本文件，三种形态
 * （邮箱先行/纯密码/双 Tab）复用同一份，不会各自漂移。
 */

export interface OAuthProviderOption {
  id: string
  label: string
}

/**
 * 第三方登录块。位置在表单**之上**：业界惯例是把一键登录作为首选路径
 * （少打一次字、少一次验证码往返），邮箱表单作为"或"之后的备选。
 */
export function SignInOAuthBlock({ providers }: { providers: OAuthProviderOption[] }) {
  if (providers.length === 0) return null
  return (
    <div className="space-y-2" data-testid="oauth-providers">
      {providers.map((p) => (
        <a
          key={p.id}
          href={'/auth/oauth/' + p.id + '/start'}
          className={buttonVariants({ variant: 'outline', className: 'w-full' })}
        >
          使用 {p.label} 登录
        </a>
      ))}
    </div>
  )
}

/** 企业 IdP 登录（折叠）。 */
export function SignInFedLogin() {
  return (
    <details className="pt-1" data-testid="fed-login">
      <summary className="text-sm text-muted-foreground cursor-pointer select-none">企业登录</summary>
      <form method="get" action="/auth/fed/start" className="mt-2 space-y-2">
        <Input type="text" name="workspace" placeholder="工作区标识（slug）" required />
        <Button type="submit" className="w-full">
          通过企业 IdP 登录
        </Button>
      </form>
    </details>
  )
}

export function SignInLegal({ legal }: { legal: ReactNode }) {
  if (!legal) return null
  return <p className="pt-1 text-center text-xs text-muted-foreground">{legal}</p>
}

export function SignInFooterLinks({
  flow,
  resetPath,
  registerPath,
}: {
  flow: SignInFlow
  resetPath?: string
  registerPath?: string
}) {
  if (!resetPath && !registerPath) return null
  return (
    <div className="flex items-center justify-between text-sm">
      {resetPath && (
        <a href={resetPath} className="text-primary hover:underline">
          {flow.kit.signInForgotPassword}
        </a>
      )}
      {registerPath && (
        <a href={registerPath} data-testid="register-link" className="text-primary hover:underline">
          {flow.kit.signInCreateAccount}
        </a>
      )}
    </div>
  )
}

/**
 * 邮箱 + 密码表单。同时用于 `passwordOnly`（企业内部工具直接给密码）与
 * 邮箱先行形态的"使用密码登录"切换——同一份实现，行为不会分叉。
 */
export function SignInPasswordForm({ flow }: { flow: SignInFlow }) {
  return (
    <form onSubmit={flow.handlePasswordSubmit} className="space-y-4 pt-2">
      <FormField label={flow.kit.signInEmailLabel} htmlFor="login-pw-email">
        <Input
          id="login-pw-email" type="email" value={flow.email} required
          onChange={(e) => flow.setEmail(e.target.value)} placeholder="you@example.com"
          autoComplete="email"
        />
      </FormField>
      <FormField label={flow.kit.signInPasswordLabel} htmlFor="login-pw-password">
        <PasswordField
          id="login-pw-password" value={flow.password} required
          onChange={(e) => flow.setPassword(e.target.value)} placeholder="输入密码"
          autoComplete="current-password"
        />
      </FormField>
      {flow.pwError && <p role="alert" className="text-destructive text-sm">{flow.pwError}</p>}
      <Button
        type="submit"
        className="w-full"
        disabled={flow.pwLoading || !flow.email || !flow.password}
      >
        {flow.pwLoading ? (
          <>
            <Spinner aria-hidden="true" />
            {flow.kit.signInSubmitPassword}
          </>
        ) : (
          flow.kit.signInSubmitPassword
        )}
      </Button>
    </form>
  )
}

/** 验证码行内重发按钮（三种形态共用同一份禁用条件与文案）。 */
export function SignInResendButton({ flow }: { flow: SignInFlow }) {
  return (
    <Button
      type="button" variant="outline" size="sm" onClick={() => void flow.handleSendCode()}
      disabled={flow.sending || flow.cooldown > 0 || !flow.email}
    >
      {flow.sendButtonLabel}
    </Button>
  )
}

/** 验证码字段（输入框 + 行内重发）。 */
export function SignInCodeField({ flow }: { flow: SignInFlow }) {
  return (
    <FormField label={flow.kit.signInCodeLabel} htmlFor="login-code">
      <div className="flex gap-2">
        <Input
          id="login-code" type="text" value={flow.code} required
          onChange={(e) => flow.setCode(e.target.value)} placeholder="6位数字"
          maxLength={6} autoComplete="one-time-code" className="flex-1"
        />
        <SignInResendButton flow={flow} />
      </div>
    </FormField>
  )
}

/**
 * 两种验证码错误（发送失败 / 提交失败）。
 * role="alert" 是 P3-29 的要求——读屏要即时播报。
 */
export function SignInCodeErrors({ flow }: { flow: SignInFlow }) {
  return (
    <>
      {flow.sendError && <p role="alert" className="text-destructive text-sm">{flow.sendError}</p>}
      {flow.codeError && <p role="alert" className="text-destructive text-sm">{flow.codeError}</p>}
    </>
  )
}

/**
 * 邮箱字段。id 由调用方给：tabs 与 email-first 同时存在于 DOM 时（不存在的
 * 情况，但保险）不共用 id；`login-email` 是历史契约，测试与自动填充依赖它。
 */
export function SignInEmailField({ flow, id = 'login-email' }: { flow: SignInFlow; id?: string }) {
  return (
    <FormField label={flow.kit.signInEmailLabel} htmlFor={id}>
      <Input
        id={id}
        type="email" value={flow.email} required
        onChange={(e) => flow.setEmail(e.target.value)} placeholder="you@example.com"
        autoComplete="email"
      />
    </FormField>
  )
}

/** 表单间的"或"分隔线。 */
export function SignInOr({ children }: { children: ReactNode }) {
  return <FieldSeparator>{children}</FieldSeparator>
}
