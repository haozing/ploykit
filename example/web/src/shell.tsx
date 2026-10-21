import { type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from '@tanstack/react-router';
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
import { useAuth } from '@ploykit/hooks';
import {
  AppShell,
  PageError,
  WorkspaceSwitcher,
  NotificationBell,
  SiteBannerLayer,
} from '@ploykit/ui';
import type {
  AppShellNavGroup,
  SettingsNavGroup,
  UserMenuExtraItem,
} from '@ploykit/ui';
import { ShieldOff } from 'lucide-react';

/**
 * 产品壳层：鉴权门、侧栏导航。
 *
 * 独立成模块的理由是代码分割：路由表要能懒加载各页面的包装组件，而这些
 * 包装组件都依赖本文件的 Shell / 鉴权门。壳留在入口（每个登录后页面都要
 * 它），页面包装在各自的 chunk 里，依赖方向是 chunk → 壳，不会反向成环。
 *
 * 根级 Provider（PloykitProvider/QueryClient/Toaster）与页面标题在
 * providers.tsx——那部分连公开页都要，本文件只有登录后页面才下载得到。
 */

export function Protected({ children }: { children: ReactNode }) {
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

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <div className="min-h-svh items-center justify-center flex text-sm text-muted-foreground">
        加载中…
      </div>
    );
  if (!user)
    return (
      // TanStack 的 history state 不接受任意对象键（ParsedHistoryState 是
      // 受 Record 约束的更新器），产品里只用 from 记来源页。
      <Navigate to="/login" state={{ from: location.pathname } as never} replace />
    );
  if (!user.is_platform_admin) {
    return (
      <div className="min-h-svh flex flex-col items-center justify-center gap-4 p-6 text-center">
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

// 统一设置导航（IA 收敛）：账户组（个人级）+ 工作区组（团队级）同处一个侧栏。
// 类型取 AppShellNavGroup[] 而非 SettingsNavGroup[]：workspaceNav 的 NavItem 带
// permKey，而框架的 SettingsNavItem 没有该字段（SettingsShell 也只认 perm）。本产品壳
// 走 AppShell.navGroups，其 isNavVisible 同时执行 perm 与 permKey 门控；spread 不裁剪
// 字段，accountNav 的普通项与 workspaceNav 的 permKey 项语义都原样保留。
const settingsNav: AppShellNavGroup[] = [...accountNav, ...workspaceNav];

// 用户面板条目（侧栏底部用户卡弹出）：仅账户四件套；工作区计费入口统一收敛到
// 设置侧栏的「工作区」组，不再做跨作用域跳转（也避免绕过该组的权限过滤）。
export const userPanelItems: UserMenuExtraItem[] = [
  { label: '个人资料', to: '/account/profile', icon: icon(UserCircle) },
  { label: '安全', to: '/account/security', icon: icon(ShieldIcon) },
  { label: '访问令牌', to: '/account/tokens', icon: icon(KeyRound) },
  { label: '通知偏好', to: '/account/notifications', icon: icon(Bell) },
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

export function AccountLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Shell breadcrumbTail={crumbOf(settingsNav, pathname)} navGroups={settingsNav}>
      {children}
    </Shell>
  );
}

export function SettingsLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Shell breadcrumbTail={crumbOf(settingsNav, pathname)} navGroups={settingsNav}>
      {children}
    </Shell>
  );
}

function HeaderRight() {
  // TanStack 的 navigate 返回 promise；NotificationBell 只要“跳过去”这一副作用，
  // void 掉即可（导航失败会走 router 自身的错误通道）。
  const navigate = useNavigate();
  return <NotificationBell onNavigate={(link) => void navigate({ to: link })} />;
}

export function Shell({
  children,
  breadcrumbTail,
  navGroups = workspaceNav,
}: {
  children: ReactNode;
  breadcrumbTail?: string;
  /** 设置区（/account、/settings）传统一导航 settingsNav；产品页默认只保留工作区组。 */
  navGroups?: AppShellNavGroup[];
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
            navGroups={navGroups}
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
