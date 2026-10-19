
import { useEffect } from 'react';
import { Link, useLocation, useNavigate } from '../../router';
import type { ReactNode } from 'react';
import {
  Building2,
  CreditCard,
  KeyRound,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Webhook,
} from 'lucide-react';
import { PageLoading } from '../../components/Page';
import { SidebarUserMenu } from '../../components/SidebarUserMenu';
import type { UserMenuExtraItem } from '../../components/UserMenu';
import { Button } from '../../components/ui/button';
import { Separator } from '../../components/ui/separator';
import {
  Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbPage,
} from '../../components/ui/breadcrumb';
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarProvider, SidebarRail, SidebarTrigger,
} from '../../components/ui/sidebar';
import { useAuth } from '@ploykit/hooks';

interface AdminNavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const NAV: AdminNavItem[] = [
  {
    to: '/admin/overview',
    label: '概览',
    icon: <LayoutDashboard size={16} aria-hidden="true" />,
  },
  {
    to: '/admin/users',
    label: '用户',
    icon: <Users size={16} aria-hidden="true" />,
  },
  {
    to: '/admin/workspaces',
    label: '工作区',
    icon: <Building2 size={16} aria-hidden="true" />,
  },
  {
    to: '/admin/plans',
    label: '套餐',
    icon: <CreditCard size={16} aria-hidden="true" />,
  },
  {
    to: '/admin/orders',
    label: '订单',
    icon: <Receipt size={16} aria-hidden="true" />,
  },
  {
    to: '/admin/webhook-deliveries',
    label: 'Webhooks',
    icon: <Webhook size={16} aria-hidden="true" />,
  },

  {
    to: '/admin/sso',
    label: 'SSO',
    icon: <KeyRound size={16} aria-hidden="true" />,
  },
  {
    to: '/admin/audit',
    label: '审计',
    icon: <ScrollText size={16} aria-hidden="true" />,
  },

  {
    to: '/admin/settings',
    label: '系统',
    icon: <Settings size={16} aria-hidden="true" />,
  },
];

function isActive(pathname: string, item: AdminNavItem): boolean {
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

export interface AdminShellProps {
  children: ReactNode;

  productPath?: string;

  loginPath?: string;

  /** 用户面板的账户菜单项（与产品壳 AppShell 的 userMenuItems 同一份） */
  userMenuItems?: UserMenuExtraItem[];
}

export function AdminShell({
  children,
  productPath = '/app',
  loginPath = '/login',
  userMenuItems,
}: AdminShellProps) {
  const { user, loading } = useAuth();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();

  // 未登录重定向：旧实现用 react-router 的 <Navigate replace state>；
  // 适配层未导出 <Navigate>，改用 useNavigate 副作用等价表达
  // （replace 语义与 state.from 透传均保留）。
  const shouldRedirect = !loading && !user;
  useEffect(() => {
    if (!shouldRedirect) return;
    if (pathname === loginPath) return; // 已在登录页：防重复导航循环
    navigate({ to: loginPath, replace: true, state: { from: `${pathname}${search}` } });
  }, [shouldRedirect, loginPath, pathname, search, navigate]);

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <PageLoading />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const activeItem = NAV.find((item) => isActive(pathname, item));

  return (
    <SidebarProvider>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          {/* 品牌（管理台无工作区上下文，侧栏头不放 WorkspaceSwitcher） */}
          <div className="flex items-center gap-2 px-2 pb-1 pt-1 group-data-[collapsible=icon]:justify-center">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <ShieldCheck size={16} aria-hidden="true" />
            </span>
            <span className="text-sm font-semibold text-foreground group-data-[collapsible=icon]:hidden">
              管理控制台
            </span>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {NAV.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <SidebarMenuItem key={item.label}>
                      <SidebarMenuButton
                        isActive={active}
                        aria-current={active ? 'page' : undefined}
                        tooltip={item.label}
                        render={<Link to={item.to} />}
                      >
                        {item.icon}
                        <span className="truncate">{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <SidebarFooter>
          {/* 与产品壳一致：用户面板渲染产品传入的同一份账户菜单项，
              管理控制台/退出登录由 SidebarUserMenu 自带。 */}
          <SidebarUserMenu logoutRedirect={loginPath} items={userMenuItems} />
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset>
        {/* 顶栏规格与 AppShell 一致（h-16 / 折叠 h-12）；右侧保留返回产品逃生口 */}
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="data-[orientation=vertical]:h-4"
            />
            {activeItem && (
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbPage>{activeItem.label}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            )}
          </div>
          <div className="flex-1" />
        </header>
        <div className="flex-1 overflow-auto p-4 lg:p-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
