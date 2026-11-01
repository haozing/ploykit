import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * kit 级文案覆盖（KitLabelsProvider）——机制级注入，不引入 i18n 框架。
 *
 * 接口刻意保持**扁平**（每个键都是 string 或函数叶子）：因此
 * `{ ...DEFAULT_KIT_LABELS, ...labels }` 的一次浅展开就是完整深合并；
 * 函数值键（workspaceCreatedToast / paginationTotal）整体替换，不做拼接。
 * 所有键可选——传部分键，其余落回内置英文默认值（B 方案默认语言 en；
 * zh 产品经 labels prop / KitLabelsProvider 把文案覆盖回中文）。
 *
 * 解析顺序（高 → 低）：
 *   组件级 `labels` prop → 最近的 KitLabelsProvider 值 → DEFAULT_KIT_LABELS。
 * 嵌套 Provider 时，内层在外层已解析值之上再做覆盖（未覆盖的键继承外层）。
 */
export interface KitLabels {
  // ---- WorkspaceSwitcher ----
  /** 触发按钮 aria-label（默认 "Switch workspace"）。 */
  workspaceSwitcherAria?: string
  /** 无当前工作区时触发按钮的占位文案（默认 "Select workspace"）。 */
  workspacePickerPlaceholder?: string
  /** 下拉菜单分组标题（默认 "Workspaces"）。 */
  workspaceGroupLabel?: string
  /** 「新建工作区」菜单项（默认 "New workspace"）。 */
  createWorkspace?: string
  /** 创建面板输入框 placeholder（默认 "Workspace name"）。 */
  workspaceNamePlaceholder?: string
  /** 创建面板输入框 aria-label（默认 "New workspace name"）。 */
  newWorkspaceNameAria?: string
  /** 创建按钮进行中文案（默认 "Creating…"）。 */
  creating?: string
  /** 创建按钮文案（默认 "Create"）。 */
  create?: string
  /** 取消按钮文案（默认 "Cancel"）。 */
  cancel?: string
  /** 创建失败的兜底错误文案（默认 "Failed to create workspace. Please try again later"）。 */
  createErrorFallback?: string
  /** 创建成功 toast；函数值键，参数为工作区名（默认 `Workspace "${name}" created`）。 */
  workspaceCreatedToast?: (name: string) => string
  /** 配额已满指引文案 · 链接前段（默认 "You've reached the workspace limit. Go to "）。 */
  quotaGuidancePrefix?: string
  /** 配额已满指引 · 链接文字（默认 "Settings → Billing"）。 */
  quotaGuidanceLinkText?: string
  /** 配额已满指引文案 · 链接后段（默认 " to view plans and quotas"）。 */
  quotaGuidanceSuffix?: string
  /** 配额已满指引的计费页地址（默认 /settings/workspace/billing；组件的 billingHref prop 优先级更高）。 */
  quotaBillingHref?: string

  // ---- DataTable ----
  /** 分页统计行；函数值键（默认 `${total} items · page ${page} of ${pages}`）。 */
  paginationTotal?: (total: number, page: number, pages: number) => string
  /** 分页栏加载中文案（默认 "Loading…"）。 */
  paginationLoading?: string
  /** 上一页按钮（默认 "Previous page"）。 */
  previousPage?: string
  /** 下一页按钮（默认 "Next page"）。 */
  nextPage?: string
  /** 翻页后空页（stale page）的提示文案（默认 "No data on this page. Go back to the previous page"）。 */
  emptyState?: string
  /** 每页条数选择器的 aria-label（默认 "Rows per page"）。 */
  pageSizeAria?: string
  /** 每页条数选项；函数值键（默认 `${n} per page`）。 */
  pageSizeOption?: (n: number) => string

  // ---- SearchSelect（可搜索单选下拉）----
  /** 触发按钮无值占位（默认 "Select…"）。 */
  searchSelectPlaceholder?: string
  /** 弹层内搜索框占位（默认 "Search…"）。 */
  searchSelectSearchPlaceholder?: string
  /** 无匹配项文案（默认 "No matches"）。 */
  searchSelectEmpty?: string
  /** 清除已选按钮 aria-label（默认 "Clear selection"）。 */
  searchSelectClear?: string

  // ---- DatePicker ----
  /** 空值占位（默认 "Pick a date"）。 */
  datePickerPlaceholder?: string
  /** 清除按钮 aria-label（默认 "Clear date"）。 */
  datePickerClear?: string

  // ---- SecretModal ----
  /** 勾选确认后的关闭按钮（默认 "I saved it"）。 */
  confirmSaved?: string
  /** 未勾选时的关闭按钮（默认 "Confirm you saved it first"，禁用态）。 */
  confirmPending?: string

  // ---- UserMenu / SidebarUserMenu（吸收原 UserMenuLabels，字段同名同义）----
  /** 账户设置菜单项（默认 "Account settings"）。 */
  accountSettings?: string
  /** 退出登录菜单项（默认 "Sign out"）。 */
  logout?: string
  /** 触发按钮 aria-label（默认 "User menu"）。 */
  userMenuAria?: string
  /** logout 抛错时的 toast（默认 "Failed to sign out. Please try again on the sign-in page later"）。 */
  logoutFailedToast?: string

  // ---- Page（三态件：PageLoading / PageEmpty / PageError）----
  /** PageLoading 默认文案（默认 "Loading…"；orkome 采纳报告 #3——双语产品
   *  直接用 kit 三态件时曾露中文）。 */
  pageLoading?: string
  /** PageEmpty 默认文案（默认 "No data yet"）。 */
  pageEmpty?: string
  /** PageError 重试按钮文案（默认 "Retry"）。 */
  pageRetry?: string

  // ---- SignInForm / SignInModal（登录表单 / 登录弹层）----
  /** 邮箱字段 label（默认 "Email"）。 */
  signInEmailLabel?: string
  /** 验证码字段 label（默认 "Verification code"）。 */
  signInCodeLabel?: string
  /** 密码字段 label（默认 "Password"）。 */
  signInPasswordLabel?: string
  /** 发送验证码按钮初始文案（默认 "Send"；"Sending…"/"Resend" 两态为组件内置文案）。 */
  sendCode?: string
  /** 冷却期按钮文案；函数值键（默认 `Resend (${seconds}s)`）。 */
  resendWithCooldown?: (seconds: number) => string
  /** 验证码登录 Tab（默认 "Verification code"）。 */
  signInCodeTab?: string
  /** 密码登录 Tab（默认 "Password"）。 */
  signInPasswordTab?: string
  /** 验证码模式提交按钮（默认 "Sign in"）。 */
  signInSubmitCode?: string
  /** 密码模式提交按钮（默认 "Sign in"）。 */
  signInSubmitPassword?: string
  /** 忘记密码链接（默认 "Forgot password?"）。 */
  signInForgotPassword?: string
  /** 创建账号链接（默认 "Create account"）。 */
  signInCreateAccount?: string
  /** termsUrl+privacyUrl 齐备时自动渲染的法律行；函数值键，返回 ReactNode
   *  （默认 "By signing in, you agree to the Terms of Service and Privacy Policy" 链接行）。
   *  SignInForm 的 legalNote prop 优先于本键。 */
  signInLegalNote?: (termsUrl: string, privacyUrl: string) => ReactNode
}

/** 内置默认文案（B 方案默认语言 en 的英文直字）。刻意不接 i18n 字典——本
 *  模块是"产品覆盖机制"，保持纯粹；zh 产品用 labels prop / KitLabelsProvider
 *  把需要的键覆盖回中文（或任意语言）。 */
export const DEFAULT_KIT_LABELS = {
  workspaceSwitcherAria: 'Switch workspace',
  workspacePickerPlaceholder: 'Select workspace',
  workspaceGroupLabel: 'Workspaces',
  createWorkspace: 'New workspace',
  workspaceNamePlaceholder: 'Workspace name',
  newWorkspaceNameAria: 'New workspace name',
  creating: 'Creating…',
  create: 'Create',
  cancel: 'Cancel',
  createErrorFallback: 'Failed to create workspace. Please try again later',
  workspaceCreatedToast: (name: string) => `Workspace "${name}" created`,
  quotaGuidancePrefix: "You've reached the workspace limit. Go to ",
  quotaGuidanceLinkText: 'Settings → Billing',
  quotaGuidanceSuffix: ' to view plans and quotas',
  quotaBillingHref: '/settings/workspace/billing',

  paginationTotal: (total: number, page: number, pages: number) => `${total} items · page ${page} of ${pages}`,
  paginationLoading: 'Loading…',
  previousPage: 'Previous page',
  nextPage: 'Next page',
  emptyState: 'No data on this page. Go back to the previous page',
  pageSizeAria: 'Rows per page',
  pageSizeOption: (n: number) => `${n} per page`,

  searchSelectPlaceholder: 'Select…',
  searchSelectSearchPlaceholder: 'Search…',
  searchSelectEmpty: 'No matches',
  searchSelectClear: 'Clear selection',

  datePickerPlaceholder: 'Pick a date',
  datePickerClear: 'Clear date',

  confirmSaved: 'I saved it',
  confirmPending: 'Confirm you saved it first',

  accountSettings: 'Account settings',
  logout: 'Sign out',
  userMenuAria: 'User menu',
  logoutFailedToast: 'Failed to sign out. Please try again on the sign-in page later',

  pageLoading: 'Loading…',
  pageEmpty: 'No data yet',
  pageRetry: 'Retry',

  signInEmailLabel: 'Email',
  signInCodeLabel: 'Verification code',
  signInPasswordLabel: 'Password',
  sendCode: 'Send',
  resendWithCooldown: (seconds: number) => `Resend (${seconds}s)`,
  signInCodeTab: 'Verification code',
  signInPasswordTab: 'Password',
  signInSubmitCode: 'Sign in',
  signInSubmitPassword: 'Sign in',
  signInForgotPassword: 'Forgot password?',
  signInCreateAccount: 'Create account',
  signInLegalNote: (termsUrl: string, privacyUrl: string) => (
    <>
      By signing in, you agree to the{' '}
      <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Terms of Service</a>
      {' '}and{' '}
      <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Privacy Policy</a>
    </>
  ),
} satisfies Required<KitLabels>

const KitLabelsContext = createContext<Required<KitLabels> | null>(null)

/** 逐键覆盖：跳过 undefined（显式传 undefined 不清掉下层值，等价旧 `??` 回退）。
 *  接口扁平 + 函数值键整体替换 → 无需深合并。供 Provider 与 UserMenu 系
 *  prop>provider 合并共用，保证两处语义一致。 */
export function applyKitLabelOverrides(base: Required<KitLabels>, labels: KitLabels | undefined): Required<KitLabels> {
  if (!labels) return base
  const out = { ...base }
  for (const key of Object.keys(labels) as (keyof KitLabels)[]) {
    const value = labels[key]
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  return out
}

/**
 * kit 级文案 Provider：一个 labels 对象覆盖全部接入组件
 * （WorkspaceSwitcher / DataTable / SecretModal / UserMenu / SidebarUserMenu /
 * Page 三态件）。组件级 `labels` prop（如 UserMenu 的 UserMenuLabels）优先级
 * 仍高于本 Provider。
 *
 * `labels` 传部分键即可，其余键落回默认值；嵌套 Provider 时内层基于外层的
 * 已解析值做覆盖（未覆盖键继承外层，而非重置回默认）。
 */
export function KitLabelsProvider({ labels, children }: {
  labels?: KitLabels
  children: ReactNode
}) {
  const parent = useContext(KitLabelsContext)
  const value = useMemo(
    () => applyKitLabelOverrides(parent ?? DEFAULT_KIT_LABELS, labels),
    [parent, labels],
  )
  return <KitLabelsContext.Provider value={value}>{children}</KitLabelsContext.Provider>
}

/** 读取解析后的全套 kit 文案：未挂 Provider 时返回内置默认值（Provider-safe）。 */
export function useKitLabels(): Required<KitLabels> {
  return useContext(KitLabelsContext) ?? DEFAULT_KIT_LABELS
}
