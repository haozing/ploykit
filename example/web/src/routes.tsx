
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  UserCircle,
  ShieldCheck as ShieldIcon,
  KeyRound,
  Bell,
  Building2,
  Users,
  ScrollText,
  Gauge,
  CreditCard,
  Webhook,
  CalendarClock,
} from 'lucide-react';
import { routeTable } from '@ploykit/runtime/routes';
import { reactRouterAssembler } from '@ploykit/runtime/router-react-router';
import { PloykitProvider, useAuth, useWorkspace, useSEO, useSiteConfig } from '@ploykit/hooks';
import {
  LoginPage,
  LandingPage,
  AppShell,
  PageError,
  AppProviders as PloykitAppProviders,
  WorkspaceSwitcher,
  ForgotPasswordPage,
  ResetPasswordPage,
  VerifyEmailPage,
  RegisterPage,
  InviteAcceptPage,
  ProfileSettingsPage,
  SecuritySettingsPage,
  TokensPage,
  NotificationPreferencesPage,
  MembersPage,
  RolePermissionsPage,
  WorkspaceGeneralPage,
  WorkspaceAuditPage,
  UsagePage,
  BillingSuccessPage,
  WebhooksPage,
  BillingPage,
  NotificationBell,
  SiteBannerLayer,
  SchedulesPage,
  AdminShell,
  OverviewPage,
  UsersPage,
  UserDetailPage,
  WorkspacesPage,
  WorkspaceDetailPage,
  OrdersPage,
  PlansPage,
  WebhookDeliveriesPage,
  AuditPage,
  SSOPage,
  AdminSettingsPage,
} from '@ploykit/ui';
import type {
  AppShellNavGroup,
  SettingsNavGroup,
  NotificationTypeMeta,
  UserMenuExtraItem,
} from '@ploykit/ui';
import type { OAuthProviderOption } from '@ploykit/ui';
import { api } from '@ploykit/client';
import { ShieldOff } from 'lucide-react';
import { Dashboard } from './pages/Dashboard';
import { RealtimePage } from './pages/RealtimePage';
import { BlogPost } from './pages/BlogPost';
import { setWsWorkspace } from './ws';





function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading, error, refresh } = useAuth();
  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-400">
        加载中…
      </div>
    );
  
  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md">
          <PageError
            message="无法连接服务器，请检查网络或稍后重试"
            onRetry={() => void refresh()}
          />
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}


function WsSync() {
  const { current } = useWorkspace();
  useEffect(() => {
    setWsWorkspace(current?.id ?? null);
  }, [current?.id]);
  return null;
}


function RequirePlatformAdmin({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  if (!user)
    return (
      <Navigate to="/login" state={{ from: location.pathname }} replace />
    );
  if (!user.is_platform_admin) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
        <ShieldOff size={32} className="text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold">需要平台管理员权限</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          当前账号无权访问管理控制台。如需管理平台数据，请联系平台管理员为你的账号开通权限。
        </p>
        <a
          href="/app"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          返回产品
        </a>
      </div>
    );
  }
  return <>{children}</>;
}


const PAGE_TITLES: Array<[RegExp, string]> = [
  [/^\/admin\/users\/./, '用户详情 · 管理控制台'],
  [/^\/admin\/users/, '用户 · 管理控制台'],
  [/^\/admin\/workspaces\/./, '工作区详情 · 管理控制台'],
  [/^\/admin\/workspaces/, '工作区 · 管理控制台'],
  [/^\/admin\/orders/, '订单 · 管理控制台'],
  [/^\/admin\/plans/, '套餐 · 管理控制台'],
  [/^\/admin\/webhook-deliveries/, 'Webhooks · 管理控制台'],
  [/^\/admin\/audit/, '审计 · 管理控制台'],
  [/^\/admin\/sso/, 'SSO · 管理控制台'],
  [/^\/admin\/settings/, '系统 · 管理控制台'],
  [/^\/admin\/overview/, '概览 · 管理控制台'],
  [/^\/admin/, '管理控制台'],
  [/^\/account\/profile/, '个人资料 · 账户设置'],
  [/^\/account\/security/, '安全 · 账户设置'],
  [/^\/account\/tokens/, '访问令牌 · 账户设置'],
  [/^\/account\/notifications/, '通知偏好 · 账户设置'],
  [/^\/account/, '账户设置'],
  [/^\/settings\/workspace\/general/, '概况 · 工作区设置'],
  [/^\/settings\/workspace\/members/, '成员 · 工作区设置'],
  [/^\/settings\/workspace\/audit/, '审计 · 工作区设置'],
  [/^\/settings\/workspace\/usage/, '用量 · 工作区设置'],
  [/^\/settings\/workspace\/billing/, '计费 · 工作区设置'],
  [/^\/settings\/workspace\/webhooks/, 'Webhooks · 工作区设置'],
  [/^\/settings\/workspace\/schedules/, '调度 · 工作区设置'],
  [/^\/settings/, '工作区设置'],
  [/^\/billing\/success/, '支付确认'],
  [/^\/app/, '概览 · MyProduct'],
  [/^\/dev\/realtime/, '实时连接（调试） · MyProduct'],
  [/^\/invitations/, '我的邀请 · MyProduct'],
  [/^\/login$/, '登录 · MyProduct'],
  [/^\/register$/, '创建账号 · MyProduct'],
  [/^\/forgot-password$/, '找回密码 · MyProduct'],
  [/^\/reset-password$/, '设置新密码 · MyProduct'],
  [/^\/verify-email$/, '邮箱验证 · MyProduct'],
];

function DocumentTitle() {
  const { pathname } = useLocation();
  useEffect(() => {
    
    
    const hit = PAGE_TITLES.find(([re]) => re.test(pathname));
    if (hit) document.title = hit[1];
  }, [pathname]);
  return null;
}


const OAUTH_LABELS: Record<string, string> = {
  github: 'GitHub',
  google: 'Google',
};

function Login() {
  const { data: cfg } = useSiteConfig();
  const oauthProviders: OAuthProviderOption[] = (
    cfg?.oauth_providers ?? []
  ).map((id) => ({
    id,
    label: OAUTH_LABELS[id] ?? id,
  }));
  return <LoginPage oauthProviders={oauthProviders} />;
}


export function Product() {
  useSEO({
    title: 'MyProduct — 让你的团队更高效',
    description:
      '一站式任务管理与团队协作工具。创建工作区、邀请团队成员、追踪任务进度。',
    canonical: '/',
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
    />
  );
}


const shellNav = [
  {
    path: '/app',
    label: '概览',
    icon: <LayoutDashboard size={17} aria-hidden="true" />,
  },
  // /dev/realtime（调试页）不进一级导航，仅经 URL 访问（routes 表 + PAGE_TITLES）。
];

const icon = (I: React.ComponentType<{ size?: number }>) => (
  <I size={16} aria-hidden="true" />
);


const accountNav: SettingsNavGroup[] = [
  {
    group: '账户',
    items: [
      { path: '/account/profile', label: '个人资料', icon: icon(UserCircle) },
      { path: '/account/security', label: '安全', icon: icon(ShieldIcon) },
      { path: '/account/tokens', label: '访问令牌', icon: icon(KeyRound) },
      { path: '/account/notifications', label: '通知偏好', icon: icon(Bell) },
    ],
  },
];


// 细粒度权限键（permKey）对齐 authz 权限目录：工作区上下文带 role_perms 时，
// 仅当生效权限集包含该键才显示；未带 role_perms 的旧上下文行为不变。
// SettingsNavItem 无 permKey 字段（类型定义在框架侧），此处就地放宽为
// AppShellNavGroup（AppShell 的 NavItem 承载 permKey；结构兼容 crumbOf 等用法）。
const workspaceNav: AppShellNavGroup[] = [
  {
    group: '工作区',
    items: [
      {
        path: '/settings/workspace/general',
        label: '概况',
        icon: icon(Building2),
        permKey: 'workspace:read',
      },
      {
        path: '/settings/workspace/members',
        label: '成员',
        icon: icon(Users),
        permKey: 'members:read',
      },
      {
        // owner 专属管理页：走粗粒度 perm，不走细粒度 permKey。
        path: '/settings/workspace/roles',
        label: '角色权限',
        icon: icon(ShieldIcon),
        perm: 'owner',
      },
      {
        path: '/settings/workspace/audit',
        label: '审计',
        icon: icon(ScrollText),
        permKey: 'audit:read',
      },
      {
        path: '/settings/workspace/usage',
        label: '用量',
        icon: icon(Gauge),
        permKey: 'usage:read',
      },
      {
        path: '/settings/workspace/billing',
        label: '计费',
        icon: icon(CreditCard),
        permKey: 'billing:read',
      },
      {
        path: '/settings/workspace/webhooks',
        label: 'Webhooks',
        icon: icon(Webhook),
        permKey: 'webhooks:read',
      },
      {
        path: '/settings/workspace/schedules',
        label: '调度',
        icon: icon(CalendarClock),
        permKey: 'schedules:manage',
      },
    ],
  },
];


// 用户面板条目（侧栏底部用户卡弹出）：账户五件套 + 计费入口。
const userPanelItems: UserMenuExtraItem[] = [
  { label: '个人资料', to: '/account/profile', icon: icon(UserCircle) },
  { label: '安全', to: '/account/security', icon: icon(ShieldIcon) },
  { label: '访问令牌', to: '/account/tokens', icon: icon(KeyRound) },
  { label: '通知偏好', to: '/account/notifications', icon: icon(Bell) },
  { label: '计费账单', to: '/settings/workspace/billing', icon: icon(CreditCard) },
];


function crumbOf(
  nav: SettingsNavGroup[],
  pathname: string,
): string | undefined {
  return nav
    .flatMap((g) => g.items)
    .find((it) => pathname === it.path || pathname.startsWith(it.path + '/'))
    ?.label;
}


function AccountLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <Shell breadcrumbTail={crumbOf(accountNav, pathname)}>{children}</Shell>;
}


function SettingsLayout({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  return <Shell breadcrumbTail={crumbOf(workspaceNav, pathname)}>{children}</Shell>;
}


function HeaderRight() {
  const navigate = useNavigate();
  return <NotificationBell onNavigate={(link) => navigate(link)} />;
}

function Shell({
  children,
  breadcrumbTail,
}: {
  children: React.ReactNode;
  breadcrumbTail?: string;
}) {
  return (
    <Protected>
      {/* 站点公告/维护条贴产品壳顶部（框架 SiteBannerLayer，自拉 /config）。外层
          h-svh 定高 + 把 AppShell 根（data-slot=sidebar-wrapper 的 min-h-svh）压回
          容器内——公告条出现时页面不整体溢出产生外层滚动条，仍由壳内 main 滚动。
          B8（ui-audit-10pages §二 G7.6）：面包屑窄屏收缩约束已回迁框架
          breadcrumb 原语（min-w-0 链 + 末级 truncate，反向条款），产品侧不再
          手写等价选择器；本容器仅保留 sidebar-wrapper 高度约束（公告条 h-svh
          布局所需，与面包屑无关）。 */}
      <div className="flex h-svh flex-col">
        <SiteBannerLayer />
        <div className="min-h-0 flex-1 [&_[data-slot=sidebar-wrapper]]:min-h-0 [&_[data-slot=sidebar-wrapper]]:h-full">
          <AppShell
            nav={shellNav}
            sidebarHeader={<WorkspaceSwitcher />}
            navGroups={workspaceNav}
            userMenu="sidebar-footer"
            userMenuItems={userPanelItems}
            headerRight={<HeaderRight />}
            breadcrumbTail={breadcrumbTail ?? null}
          >
            {children}
          </AppShell>
        </div>
      </div>
    </Protected>
  );
}


function Notifications() {
  const [types, setTypes] = useState<NotificationTypeMeta[] | undefined>(
    undefined,
  );
  const configQ = useSiteConfig();
  const emailChannelNote =
    configQ.data?.mail_mode === 'dev'
      ? '当前环境未接真实邮件发送（仅记录日志）；配置 SMTP 后此开关才会产生真实邮件'
      : undefined;
  useEffect(() => {
    let alive = true;
    api
      .get<{ items?: NotificationTypeMeta[] }>('/api/notification-types')
      .then((d) => {
        if (alive) setTypes(d?.items ?? []);
      })
      .catch(() => {
        /* 目录不可用：退回偏好行兜底 */
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <NotificationPreferencesPage
      types={types}
      emailChannelNote={emailChannelNote}
    />
  );
}





function AppPage() {
  return (
    <Shell breadcrumbTail="概览">
      <Dashboard />
    </Shell>
  );
}
function InvitationsPage() {
  return (
    <Shell>
      <InviteAcceptPage />
    </Shell>
  );
}
function RealtimeRoute() {
  return (
    <Shell breadcrumbTail="实时连接（调试）">
      <RealtimePage />
    </Shell>
  );
}
function BillingSuccessRoute() {
  return (
    <Shell>
      <BillingSuccessPage />
    </Shell>
  );
}


function AdminIndex() {
  return (
    <RequirePlatformAdmin>
      <Navigate to="/admin/overview" replace />
    </RequirePlatformAdmin>
  );
}
function AdminOverview() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <OverviewPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminUsers() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <UsersPage impersonatePath="/app" />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminUserDetail() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <UserDetailPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminWorkspaces() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <WorkspacesPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminWorkspaceDetail() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <WorkspaceDetailPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminOrders() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <OrdersPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminWebhookDeliveries() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <WebhookDeliveriesPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminAudit() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <AuditPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminPlans() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <PlansPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminSSO() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <SSOPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}
function AdminSettings() {
  return (
    <RequirePlatformAdmin>
      <AdminShell productPath="/app" loginPath="/login" userMenuItems={userPanelItems}>
        <AdminSettingsPage />
      </AdminShell>
    </RequirePlatformAdmin>
  );
}


function AccountIndex() {
  return <Navigate to="/account/profile" replace />;
}
function AccountProfile() {
  return (
    <AccountLayout>
      <ProfileSettingsPage />
    </AccountLayout>
  );
}
function AccountSecurity() {
  return (
    <AccountLayout>
      <SecuritySettingsPage />
    </AccountLayout>
  );
}
function AccountTokens() {
  return (
    <AccountLayout>
      <TokensPage />
    </AccountLayout>
  );
}
function AccountNotifications() {
  return (
    <AccountLayout>
      <Notifications />
    </AccountLayout>
  );
}

function SettingsIndex() {
  return <Navigate to="/settings/workspace/general" replace />;
}
function WorkspaceGeneral() {
  return (
    <SettingsLayout>
      <WorkspaceGeneralPage />
    </SettingsLayout>
  );
}
function WorkspaceMembers() {
  return (
    <SettingsLayout>
      <MembersPage />
    </SettingsLayout>
  );
}
function WorkspaceRoles() {
  return (
    <SettingsLayout>
      <RolePermissionsPage />
    </SettingsLayout>
  );
}
function WorkspaceAudit() {
  return (
    <SettingsLayout>
      <WorkspaceAuditPage />
    </SettingsLayout>
  );
}
function WorkspaceUsage() {
  return (
    <SettingsLayout>
      <UsagePage />
    </SettingsLayout>
  );
}
function WorkspaceBilling() {
  return (
    <SettingsLayout>
      <BillingPage />
    </SettingsLayout>
  );
}
function WorkspaceWebhooks() {
  return (
    <SettingsLayout>
      <WebhooksPage />
    </SettingsLayout>
  );
}
function WorkspaceSchedules() {
  return (
    <SettingsLayout>
      <SchedulesPage />
    </SettingsLayout>
  );
}

function CatchAll() {
  return <Navigate to="/" replace />;
}






export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <PloykitAppProviders>
      <WsSync />
      {/* B-orders-7：路由级标题（须在 Router 内——entry 双端把本组件挂在 Router 之下） */}
      <DocumentTitle />
      {children}
    </PloykitAppProviders>
  );
}





const routes = routeTable({
  '/': { component: Product, render: 'static' }, // 落地页：无 Loader → 构建期预渲染进 embed
  '/blog/:slug': { component: BlogPost, render: 'static' }, // 有 Loader → 运行期缓存渲染（数据决定型）
  '/login': { component: Login },
  '/register': { component: RegisterPage },
  '/forgot-password': { component: ForgotPasswordPage },
  '/reset-password': { component: ResetPasswordPage },
  '/verify-email': { component: VerifyEmailPage },
  '/app': { component: AppPage },
  '/invitations': { component: InvitationsPage },
  '/dev/realtime': { component: RealtimeRoute },
  '/admin': { component: AdminIndex },
  '/admin/overview': { component: AdminOverview },
  '/admin/users': { component: AdminUsers },
  '/admin/users/:id': { component: AdminUserDetail },
  '/admin/workspaces': { component: AdminWorkspaces },
  '/admin/workspaces/:id': { component: AdminWorkspaceDetail },
  '/admin/orders': { component: AdminOrders },
  '/admin/plans': { component: AdminPlans },
  '/admin/webhook-deliveries': { component: AdminWebhookDeliveries },
  '/admin/audit': { component: AdminAudit },
  '/admin/sso': { component: AdminSSO },
  '/admin/settings': { component: AdminSettings },
  '/account': { component: AccountIndex },
  '/account/profile': { component: AccountProfile },
  '/account/security': { component: AccountSecurity },
  '/account/tokens': { component: AccountTokens },
  '/account/notifications': { component: AccountNotifications },
  '/settings': { component: SettingsIndex },
  '/settings/workspace/general': { component: WorkspaceGeneral },
  '/settings/workspace/members': { component: WorkspaceMembers },
  '/settings/workspace/roles': { component: WorkspaceRoles },
  '/settings/workspace/audit': { component: WorkspaceAudit },
  '/settings/workspace/usage': { component: WorkspaceUsage },
  '/settings/workspace/billing': { component: WorkspaceBilling },
  '/settings/workspace/webhooks': { component: WorkspaceWebhooks },
  '/settings/workspace/schedules': { component: WorkspaceSchedules },
  '/billing/success': { component: BillingSuccessRoute },
  '/*': { component: CatchAll }, // 兜底回首页（与旧 App 的 path="*" 等价；'/*' 过 Go 投影校验）
}, reactRouterAssembler());

export default routes;
