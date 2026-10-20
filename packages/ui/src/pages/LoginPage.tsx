/**
 * LoginPage —— AuthShell 壳 + SignInForm（#30 起为薄壳）。
 *
 * 全部登录流逻辑（冷却/提交/OAuth/回跳守卫/文案）已提取到
 * auth/SignInForm：本页只负责 AuthShell 包装与 prop 透传，
 * 既有 prop 语义逐项不变（含 loginRedirectTarget 默认 /app）。
 * 需要弹层形态（成功后整页硬跳转，#24）请用 auth/SignInModal。
 */
import { AuthShell } from '../layouts/AuthShell'
import { SignInForm, loginRedirectTarget, type SignInFormProps } from '../auth/SignInForm'

export type { OAuthProviderOption } from '../auth/SignInForm'

export interface LoginPageProps extends SignInFormProps {}

export { loginRedirectTarget }

export function LoginPage(props: LoginPageProps) {
  return (
    <AuthShell>
      <SignInForm {...props} />
    </AuthShell>
  )
}
