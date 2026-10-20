/**
 * AdminSignInPage —— 管理端专用登录门（#31）：把「管理端登录分离」recipe
 * 打包成一行 props 的页组件。
 *
 * Recipe（全部由现有 SignInForm props 拼出，本组件不新增登录逻辑）：
 *   - passwordOnly：纯密码形态，无验证码 Tab（管理端不发消费验证码）；
 *   - 不给 registerPath（传空串压掉 SignInForm 的 '/register' 默认值）：
 *     「创建账号」入口消失——管理员账号是提权制（is_platform_admin），
 *     不走自助注册；
 *   - resetPath 按需：默认不给（管理端密码重置通常走带外流程），
 *     传入才渲染「忘记密码？」；
 *   - sober 文案：默认「管理控制台 / 仅限授权人员」，无营销 chrome、
 *     无 OAuth、无企业登录槽；
 *   - 成功后整页硬跳转（#24 教训，同 SignInModal 的既定默认）：
 *     深链 state.from 合法则回深链，否则落 adminPath（默认 '/admin'）。
 *     产品侧把 AdminShell 的 loginPath 指到本路由（如 '/admin/login'）即完成接线。
 *
 * 身份体系不分：同一用户表、同一 session、is_platform_admin 提权制不变——
 * 分的只是门脸与路由（真正的安全实质是 2FA 与短会话，见 docs/ROADMAP.md
 * 管理端 2FA 强制条目；本页是策略的落点）。
 */
import { SignInForm, loginRedirectTarget } from '../../auth/SignInForm'
import { hardNavigate } from '../../auth/hard-navigate'
import { useLocation } from '../../router'

export interface AdminSignInPageProps {
  /** 登录成功后的兜底落点（深链 state.from 缺失/非法时）。默认 '/admin'。 */
  adminPath?: string

  /** 「忘记密码？」链接；默认不渲染（管理端重置多走带外流程），传入才显示。 */
  resetPath?: string

  /** 门头标题。默认「管理控制台」。 */
  title?: string

  /** 门头副标题。默认「仅限授权人员」。 */
  description?: string
}

export function AdminSignInPage({
  adminPath = '/admin',
  resetPath,
  title = '管理控制台',
  description = '仅限授权人员',
}: AdminSignInPageProps) {
  // 回跳目标与软导航同一守卫：AdminShell 未登录重定向带来的 state.from
  // （如 '/admin/users'）合法则原样回跳；直访问口落 adminPath。
  const from = loginRedirectTarget(
    (useLocation().state as { from?: unknown } | null)?.from,
    adminPath,
  )

  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        <SignInForm
          passwordOnly
          registerPath=""
          resetPath={resetPath ?? ''}
          onSuccess={() => hardNavigate(from)}
          title={title}
          description={description}
        />
      </div>
    </div>
  )
}
