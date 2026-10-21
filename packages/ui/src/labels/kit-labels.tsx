import { createContext, useContext, useMemo, type ReactNode } from 'react'

/**
 * kit 级文案覆盖（KitLabelsProvider）——机制级注入，不引入 i18n 框架。
 *
 * 接口刻意保持**扁平**（每个键都是 string 或函数叶子）：因此
 * `{ ...DEFAULT_KIT_LABELS, ...labels }` 的一次浅展开就是完整深合并；
 * 函数值键（workspaceCreatedToast / paginationTotal）整体替换，不做拼接。
 * 所有键可选——传部分键，其余落回内置中文默认值。
 *
 * 解析顺序（高 → 低）：
 *   组件级 `labels` prop → 最近的 KitLabelsProvider 值 → DEFAULT_KIT_LABELS。
 * 嵌套 Provider 时，内层在外层已解析值之上再做覆盖（未覆盖的键继承外层）。
 */
export interface KitLabels {
  // ---- WorkspaceSwitcher ----
  /** 触发按钮 aria-label（默认「切换工作区」）。 */
  workspaceSwitcherAria?: string
  /** 无当前工作区时触发按钮的占位文案（默认「选择工作区」）。 */
  workspacePickerPlaceholder?: string
  /** 下拉菜单分组标题（默认「工作区」）。 */
  workspaceGroupLabel?: string
  /** 「新建工作区」菜单项（默认「新建工作区」）。 */
  createWorkspace?: string
  /** 创建面板输入框 placeholder（默认「工作区名称」）。 */
  workspaceNamePlaceholder?: string
  /** 创建面板输入框 aria-label（默认「新工作区名称」）。 */
  newWorkspaceNameAria?: string
  /** 创建按钮进行中文案（默认「创建中…」）。 */
  creating?: string
  /** 创建按钮文案（默认「创建」）。 */
  create?: string
  /** 取消按钮文案（默认「取消」）。 */
  cancel?: string
  /** 创建失败的兜底错误文案（默认「创建工作区失败，请稍后重试」）。 */
  createErrorFallback?: string
  /** 创建成功 toast；函数值键，参数为工作区名（默认 `工作区「name」已创建`）。 */
  workspaceCreatedToast?: (name: string) => string
  /** 配额已满指引文案 · 链接前段（默认「已达当前工作区数上限，可在」）。 */
  quotaGuidancePrefix?: string
  /** 配额已满指引 · 链接文字（默认「设置→计费」）。 */
  quotaGuidanceLinkText?: string
  /** 配额已满指引文案 · 链接后段（默认「查看套餐与配额」）。 */
  quotaGuidanceSuffix?: string
  /** 配额已满指引的计费页地址（默认 /settings/workspace/billing；组件的 billingHref prop 优先级更高）。 */
  quotaBillingHref?: string

  // ---- DataTable ----
  /** 分页统计行；函数值键（默认 `共 t 条 · 第 p/pages 页`）。 */
  paginationTotal?: (total: number, page: number, pages: number) => string
  /** 分页栏加载中文案（默认「加载中…」）。 */
  paginationLoading?: string
  /** 上一页按钮（默认「上一页」）。 */
  previousPage?: string
  /** 下一页按钮（默认「下一页」）。 */
  nextPage?: string
  /** 翻页后空页（stale page）的提示文案（默认「本页没有数据，可返回上一页」）。 */
  emptyState?: string
  /** 每页条数选择器的 aria-label（默认「每页条数」）。 */
  pageSizeAria?: string
  /** 每页条数选项；函数值键（默认 `${n} 条/页`）。 */
  pageSizeOption?: (n: number) => string

  // ---- SearchSelect（可搜索单选下拉）----
  /** 触发按钮无值占位（默认「请选择」）。 */
  searchSelectPlaceholder?: string
  /** 弹层内搜索框占位（默认「搜索…」）。 */
  searchSelectSearchPlaceholder?: string
  /** 无匹配项文案（默认「无匹配项」）。 */
  searchSelectEmpty?: string
  /** 清除已选按钮 aria-label（默认「清除选择」）。 */
  searchSelectClear?: string

  // ---- DatePicker ----
  /** 空值占位（默认「选择日期」）。 */
  datePickerPlaceholder?: string
  /** 清除按钮 aria-label（默认「清除日期」）。 */
  datePickerClear?: string

  // ---- SecretModal ----
  /** 勾选确认后的关闭按钮（默认「我已保存」）。 */
  confirmSaved?: string
  /** 未勾选时的关闭按钮（默认「请先确认已保存」，禁用态）。 */
  confirmPending?: string

  // ---- UserMenu / SidebarUserMenu（吸收原 UserMenuLabels，字段同名同义）----
  /** 账户设置菜单项（默认「账户设置」）。 */
  accountSettings?: string
  /** 退出登录菜单项（默认「退出登录」）。 */
  logout?: string
  /** 触发按钮 aria-label（默认「用户菜单」）。 */
  userMenuAria?: string
  /** logout 抛错时的 toast（默认「退出登录失败，请稍后在登录页重试」）。 */
  logoutFailedToast?: string

  // ---- Page（三态件：PageLoading / PageEmpty / PageError）----
  /** PageLoading 默认文案（默认「加载中…」；orkome 采纳报告 #3——双语产品
   *  直接用 kit 三态件时曾露中文）。 */
  pageLoading?: string
  /** PageEmpty 默认文案（默认「暂无数据」）。 */
  pageEmpty?: string
  /** PageError 重试按钮文案（默认「重试」）。 */
  pageRetry?: string

  // ---- SignInForm / SignInModal（登录表单 / 登录弹层）----
  /** 邮箱字段 label（默认「邮箱」）。 */
  signInEmailLabel?: string
  /** 验证码字段 label（默认「验证码」）。 */
  signInCodeLabel?: string
  /** 密码字段 label（默认「密码」）。 */
  signInPasswordLabel?: string
  /** 发送验证码按钮初始文案（默认「发送」；「发送中…」「重新发送」两态为组件内置文案）。 */
  sendCode?: string
  /** 冷却期按钮文案；函数值键（默认 `重发（${seconds}s）`）。 */
  resendWithCooldown?: (seconds: number) => string
  /** 验证码登录 Tab（默认「验证码登录」）。 */
  signInCodeTab?: string
  /** 密码登录 Tab（默认「密码登录」）。 */
  signInPasswordTab?: string
  /** 验证码模式提交按钮（默认「登录」）。 */
  signInSubmitCode?: string
  /** 密码模式提交按钮（默认「登录」）。 */
  signInSubmitPassword?: string
  /** 忘记密码链接（默认「忘记密码？」）。 */
  signInForgotPassword?: string
  /** 创建账号链接（默认「创建账号」）。 */
  signInCreateAccount?: string
  /** termsUrl+privacyUrl 齐备时自动渲染的法律行；函数值键，返回 ReactNode
   *  （默认「登录即同意 服务条款 与 隐私政策」链接行）。SignInForm 的 legalNote prop 优先于本键。 */
  signInLegalNote?: (termsUrl: string, privacyUrl: string) => ReactNode
}

/** 内置默认文案：与历史硬编码逐字一致——不挂 Provider 的消费方零变化。 */
export const DEFAULT_KIT_LABELS = {
  workspaceSwitcherAria: '切换工作区',
  workspacePickerPlaceholder: '选择工作区',
  workspaceGroupLabel: '工作区',
  createWorkspace: '新建工作区',
  workspaceNamePlaceholder: '工作区名称',
  newWorkspaceNameAria: '新工作区名称',
  creating: '创建中…',
  create: '创建',
  cancel: '取消',
  createErrorFallback: '创建工作区失败，请稍后重试',
  workspaceCreatedToast: (name: string) => `工作区「${name}」已创建`,
  quotaGuidancePrefix: '已达当前工作区数上限，可在',
  quotaGuidanceLinkText: '设置→计费',
  quotaGuidanceSuffix: '查看套餐与配额',
  quotaBillingHref: '/settings/workspace/billing',

  paginationTotal: (total: number, page: number, pages: number) => `共 ${total} 条 · 第 ${page}/${pages} 页`,
  paginationLoading: '加载中…',
  previousPage: '上一页',
  nextPage: '下一页',
  emptyState: '本页没有数据，可返回上一页',
  pageSizeAria: '每页条数',
  pageSizeOption: (n: number) => `${n} 条/页`,

  searchSelectPlaceholder: '请选择',
  searchSelectSearchPlaceholder: '搜索…',
  searchSelectEmpty: '无匹配项',
  searchSelectClear: '清除选择',

  datePickerPlaceholder: '选择日期',
  datePickerClear: '清除日期',

  confirmSaved: '我已保存',
  confirmPending: '请先确认已保存',

  accountSettings: '账户设置',
  logout: '退出登录',
  userMenuAria: '用户菜单',
  logoutFailedToast: '退出登录失败，请稍后在登录页重试',

  pageLoading: '加载中…',
  pageEmpty: '暂无数据',
  pageRetry: '重试',

  signInEmailLabel: '邮箱',
  signInCodeLabel: '验证码',
  signInPasswordLabel: '密码',
  sendCode: '发送',
  resendWithCooldown: (seconds: number) => `重发（${seconds}s）`,
  signInCodeTab: '验证码登录',
  signInPasswordTab: '密码登录',
  signInSubmitCode: '登录',
  signInSubmitPassword: '登录',
  signInForgotPassword: '忘记密码？',
  signInCreateAccount: '创建账号',
  signInLegalNote: (termsUrl: string, privacyUrl: string) => (
    <>
      登录即同意{' '}
      <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">服务条款</a>
      {' '}与{' '}
      <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">隐私政策</a>
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
