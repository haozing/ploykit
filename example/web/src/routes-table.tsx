import { useSEO } from '@ploykit/hooks';
import { Navigate } from '@tanstack/react-router';
import { routeTable, type RouteSpec } from '@ploykit/runtime/routes';
import { tanstackAssembler } from '@ploykit/runtime/router-tanstack';
import { lazyPage } from '@ploykit/runtime';
import { LandingPage } from '@ploykit/ui';
import { BlogPost } from './pages/BlogPost';
import { About, Docs, Pricing } from './pages/StaticPages';
import { AppProviders } from './providers';

/**
 * 路由表的单一真源（工厂）。
 *
 * 为什么是工厂而不是一个常量：`/login` 与 `/register` 需要在两个入口上取不同的
 * 形状，而这是构建约束，不是偏好——
 *
 *   - **服务端入口**（entry-server → esbuild → QuickJS 沙箱）必须**同步导入**
 *     这两个页面组件，并把路由标成 `render: 'static'`。沙箱同步调用
 *     renderToString，从不 pump promise；写成懒加载，产物是 Suspense 占位符
 *     `<!--$!-->`，等于空页面（构建期断言 A2′ 会拦；A2 只看空输出，看不见它）。
 *   - **客户端入口**（entry-client → Vite）必须**懒加载**它们，否则它们连同
 *     zod/react-hook-form 一起进入首包，让每条无关路由（尤其博客页）都替它们
 *     付字节。
 *
 * 两条入口本来就是两个独立 bundle，所以这个差异可以成立。用工厂而不是两份
 * 路由表，是为了让剩下 36 条路由只有一处声明——两份表的漂移是必然事故，参数
 * 化把它变成构造上不可能。
 */
export interface AuthRouteSpecs {
  /** `/login` 的完整规格：服务端传同步组件 + render:'static'，客户端传懒组件。 */
  login: RouteSpec
  /** `/register` 的完整规格，同上。 */
  register: RouteSpec
}

/**
 * 两条 auth 路由的 pageId 锚点（`displayName` 属性，不是函数名）。
 *
 * 为什么不能靠函数名：本文件的 `RegisterPage` 与 @ploykit/ui 导出的同名函数
 * 会一起进 SSR bundle，esbuild 会把其中一个改名（实测 `RegisterPage2`），
 * pageId 随之从 `register-page` 漂成 `register-page2`——而**服务端**产出的
 * pageId 会写进 props 脚本的 `data-page-id`，客户端懒页面却仍按
 * `lazyPage('RegisterPage')` 推导，两侧对不上，水合兜底静默失效。
 * `displayName` 是属性赋值，压缩器不改它；锚点常量化在此处，两个入口共用
 * 同一份定义，想漂移都没有第二个地方可改。
 */
const AUTH_PAGE_NAMES = { login: 'Login', register: 'RegisterPage' } as const;

function withStableName(name: string, spec: RouteSpec): RouteSpec {
  const c = spec.component as typeof spec.component & { displayName?: string };
  if (!c.displayName) c.displayName = name;
  return spec;
}

/**
 * 路由真源。
 *
 * 加载策略按「谁需要这段代码」划分：
 *
 * 1. 首包（本文件同步导入）：只有落地页与博客页——它们是 render: 'static'，
 *    必须在 SSR 沙箱里同步可用（见第 3 条）。落地页另外标了
 *    `hydrate: 'none'`：整页只有声明式内容与 <Link>（服务端渲染成 <a href>），
 *    水合换不到任何东西，所以这一页零 JS。
 * 2. 懒加载（lazyPage）：其余全部页面。按条线成组——公开面（登录/注册/找回/
 *    重置/验证）、/app 区、账户+工作区设置区、平台管理台。组内页面互相跳转
 *    极频繁（侧栏就是为此设计的），逐页拆只会让每次点击多一次往返；而注册页
 *    单独成块，因为只有它背着 zod 全量。
 * 3. 静态渲染页（`render: 'static'`，必须同步导入）：renderx 在 SSR 沙箱里
 *    同步调用 renderToString，不会等待动态 import 的 promise，懒加载的
 *    static 页会渲染出挂起占位符（构建期断言 A2′ 会拦下来）。
 */

const AppGroup = lazyPage('AppPage', () =>
  import('./routes-app').then((m) => ({ default: m.AppPage })),
);
const Invitations = lazyPage('InvitationsPage', () =>
  import('./routes-app').then((m) => ({ default: m.InvitationsPage })),
);
const BillingSuccess = lazyPage('BillingSuccessRoute', () =>
  import('./routes-app').then((m) => ({ default: m.BillingSuccessRoute })),
);

const ForgotPassword = lazyPage('ForgotPasswordPage', () =>
  import('./routes-auth-misc').then((m) => ({ default: m.ForgotPassword })),
);
const ResetPassword = lazyPage('ResetPasswordPage', () =>
  import('./routes-auth-misc').then((m) => ({ default: m.ResetPassword })),
);
const VerifyEmail = lazyPage('VerifyEmailPage', () =>
  import('./routes-auth-misc').then((m) => ({ default: m.VerifyEmail })),
);

const SettingsGroup = {
  Account: lazyPage('AccountProfile', () =>
    import('./routes-settings').then((m) => ({ default: m.AccountProfile })),
  ),
  AccountSecurity: lazyPage('AccountSecurity', () =>
    import('./routes-settings').then((m) => ({ default: m.AccountSecurity })),
  ),
  AccountTokens: lazyPage('AccountTokens', () =>
    import('./routes-settings').then((m) => ({ default: m.AccountTokens })),
  ),
  AccountNotifications: lazyPage('AccountNotifications', () =>
    import('./routes-settings').then((m) => ({ default: m.AccountNotifications })),
  ),
  WorkspaceGeneral: lazyPage('WorkspaceGeneral', () =>
    import('./routes-settings').then((m) => ({ default: m.WorkspaceGeneral })),
  ),
  WorkspaceMembers: lazyPage('WorkspaceMembers', () =>
    import('./routes-settings').then((m) => ({ default: m.WorkspaceMembers })),
  ),
  WorkspaceRoles: lazyPage('WorkspaceRoles', () =>
    import('./routes-settings').then((m) => ({ default: m.WorkspaceRoles })),
  ),
  WorkspaceAudit: lazyPage('WorkspaceAudit', () =>
    import('./routes-settings').then((m) => ({ default: m.WorkspaceAudit })),
  ),
  WorkspaceUsage: lazyPage('WorkspaceUsage', () =>
    import('./routes-settings').then((m) => ({ default: m.WorkspaceUsage })),
  ),
  WorkspaceBilling: lazyPage('WorkspaceBilling', () =>
    import('./routes-settings').then((m) => ({ default: m.WorkspaceBilling })),
  ),
  WorkspaceWebhooks: lazyPage('WorkspaceWebhooks', () =>
    import('./routes-settings').then((m) => ({ default: m.WorkspaceWebhooks })),
  ),
  WorkspaceSchedules: lazyPage('WorkspaceSchedules', () =>
    import('./routes-settings').then((m) => ({ default: m.WorkspaceSchedules })),
  ),
};

const AdminGroup = {
  Index: lazyPage('AdminIndex', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminIndex })),
  ),
  Overview: lazyPage('AdminOverview', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminOverview })),
  ),
  Users: lazyPage('AdminUsers', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminUsers })),
  ),
  UserDetail: lazyPage('AdminUserDetail', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminUserDetail })),
  ),
  Workspaces: lazyPage('AdminWorkspaces', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminWorkspaces })),
  ),
  WorkspaceDetail: lazyPage('AdminWorkspaceDetail', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminWorkspaceDetail })),
  ),
  Orders: lazyPage('AdminOrders', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminOrders })),
  ),
  Plans: lazyPage('AdminPlans', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminPlans })),
  ),
  WebhookDeliveries: lazyPage('AdminWebhookDeliveries', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminWebhookDeliveries })),
  ),
  Audit: lazyPage('AdminAudit', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminAudit })),
  ),
  SSO: lazyPage('AdminSSO', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminSSO })),
  ),
  Settings: lazyPage('AdminSettings', () =>
    import('./routes-admin').then((m) => ({ default: m.AdminSettings })),
  ),
};

const AccountIndex = lazyPage('AccountIndex', () =>
  import('./routes-settings').then((m) => ({ default: m.AccountIndex })),
);
const SettingsIndex = lazyPage('SettingsIndex', () =>
  import('./routes-settings').then((m) => ({ default: m.SettingsIndex })),
);

const Realtime = lazyPage('RealtimeRoute', () =>
  import('./routes-app').then((m) => ({ default: m.RealtimeRoute })),
);

// 兜底：未知路径回首页。同步实现——它渲染在任何页面之前，走懒加载只会
// 让 404 多等一次网络往返。
function CatchAll() {
  return <Navigate to="/" replace />;
}

export function Product() {
  useSEO({
    title: 'MyProduct — 让你的团队更高效',
    description:
      '一站式任务管理与团队协作工具。创建工作区、邀请团队成员、追踪任务进度。',
    canonical: '/',
    ogSiteName: 'MyProduct',
    ogLocale: 'zh_CN',
  });
  return (
    <LandingPage
      brand="MyProduct"
      tagline="让你的团队更高效"
      description="一站式任务管理与团队协作工具。创建工作区、邀请团队成员、追踪任务进度。"
      features={[
        {
          icon: '📋',
          title: '任务管理',
          desc: '创建、分配、追踪任务，支持优先级和截止日期',
        },
        {
          icon: '👥',
          title: '团队协作',
          desc: '邀请成员加入工作区，支持邮箱邀请或加入码',
        },
        {
          icon: '📊',
          title: '数据洞察',
          desc: '查看任务完成率、团队活跃度、使用量统计',
        },
      ]}
      plans={[
        {
          name: '免费版',
          price: '¥0',
          period: '/月',
          recommended: true,
          cta: '免费开始',
          features: [
            '1 个工作区',
            '最多 5 名成员',
            '每月 50 个任务',
            '社区支持',
          ],
        },
        {
          name: '专业版',
          price: '¥99',
          period: '/月',
          cta: '联系我们',
          features: ['无限工作区', '无限成员', '无限任务', '优先支持'],
        },
      ]}
      navLinks={[
        { to: '/pricing', label: '定价' },
        { to: '/docs', label: '文档' },
        { to: '/about', label: '关于' },
      ]}
    />
  );
}

export function buildRouteTable(auth: AuthRouteSpecs) {
  return routeTable(
  {
    // 落地页：无 Loader → 构建期预渲染进 embed。GA4 全站统计（2026-10-27）
    // 放弃零 JS：信标是浏览器侧 JS，不水合就没有统计。判据取舍记档见
    // pages/StaticPages.tsx 顶部注释——统计诉求在此页组压过了零 JS 诉求。
    '/': { component: Product, render: 'static' },
    // 内容面：纯声明式页面，原本零 JS（hydrate: 'none'）；GA4 全站统计批
    // （2026-10-27）翻回默认水合——预渲染不变，只是不再跳过水合。
    '/pricing': { component: Pricing, render: 'static' },
    '/docs': { component: Docs, render: 'static' },
    '/about': { component: About, render: 'static' },
    // 有 Loader → 运行期缓存渲染（数据决定型）；「收藏」按钮需要水合，保持
    // 同步导入（static 页不能在沙箱里等 promise）。
    '/blog/:slug': { component: BlogPost, render: 'static' },

    // 公开面：登录与注册预渲染（见上方 import 处的取舍说明）；其余低频公开页
    // 各自成块。
    '/login': withStableName(AUTH_PAGE_NAMES.login, auth.login),
    '/register': withStableName(AUTH_PAGE_NAMES.register, auth.register),
    '/forgot-password': { component: ForgotPassword },
    '/reset-password': { component: ResetPassword },
    '/verify-email': { component: VerifyEmail },

    // 登录后：按功能区懒加载（见文件头注释）。
    '/app': { component: AppGroup },
    '/dev/realtime': { component: Realtime },
    '/invitations': { component: Invitations },
    '/billing/success': { component: BillingSuccess },

    '/account': { component: AccountIndex },
    '/account/profile': { component: SettingsGroup.Account },
    '/account/security': { component: SettingsGroup.AccountSecurity },
    '/account/tokens': { component: SettingsGroup.AccountTokens },
    '/account/notifications': { component: SettingsGroup.AccountNotifications },

    '/settings': { component: SettingsIndex },
    '/settings/workspace/general': { component: SettingsGroup.WorkspaceGeneral },
    '/settings/workspace/members': { component: SettingsGroup.WorkspaceMembers },
    '/settings/workspace/roles': { component: SettingsGroup.WorkspaceRoles },
    '/settings/workspace/audit': { component: SettingsGroup.WorkspaceAudit },
    '/settings/workspace/usage': { component: SettingsGroup.WorkspaceUsage },
    '/settings/workspace/billing': { component: SettingsGroup.WorkspaceBilling },
    '/settings/workspace/webhooks': { component: SettingsGroup.WorkspaceWebhooks },
    '/settings/workspace/schedules': { component: SettingsGroup.WorkspaceSchedules },

    '/admin': { component: AdminGroup.Index },
    '/admin/overview': { component: AdminGroup.Overview },
    '/admin/users': { component: AdminGroup.Users },
    '/admin/users/:id': { component: AdminGroup.UserDetail },
    '/admin/workspaces': { component: AdminGroup.Workspaces },
    '/admin/workspaces/:id': { component: AdminGroup.WorkspaceDetail },
    '/admin/orders': { component: AdminGroup.Orders },
    '/admin/plans': { component: AdminGroup.Plans },
    '/admin/webhook-deliveries': { component: AdminGroup.WebhookDeliveries },
    '/admin/audit': { component: AdminGroup.Audit },
    '/admin/sso': { component: AdminGroup.SSO },
    '/admin/settings': { component: AdminGroup.Settings },

    '/*': { component: CatchAll }, // 兜底回首页（'/*' 过 Go 投影校验）
  },
  tanstackAssembler({
    // Product 全局 Provider 组合（含 useLocation 的 DocumentTitle）必须活在
    // router context 之内：TanStack 的 RouterProvider 由 assembler 在渲染期
    // 挂载，产品侧拿不到它的外层，所以经 InnerWrap 从内侧包。SSR 沙箱与水合
    // 首帧都走这条路径（PloykitProvider 的 auth 拉取在 useEffect 里，同步渲染
    // 不触发网络；Toaster 渲染空壳 section）。
    wrapInRouter: (children) => <AppProviders>{children}</AppProviders>,
  }),
);
}
