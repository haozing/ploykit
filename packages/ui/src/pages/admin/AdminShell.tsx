
import { Link, Navigate, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  Building2,
  KeyRound,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Users,
  Webhook,
} from 'lucide-react';
import { buttonVariants } from '../../components/ui/Button';
import { UserMenu } from '../../components/UserMenu';
import { useAuth } from '../../hooks/useAuth';
import { cn } from '../../lib/utils';

interface AdminNavItem {
  to: string;
  label: string;
  icon: ReactNode;
  
  hash?: boolean;
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
    to: '/admin/overview#analytics',
    label: '分析',
    icon: <Activity size={16} aria-hidden="true" />,
    hash: true,
  },
  
  {
    to: '/admin/settings',
    label: '系统',
    icon: <Settings size={16} aria-hidden="true" />,
  },
];

function isActive(pathname: string, hash: string, item: AdminNavItem): boolean {
  if (item.hash) return pathname === '/admin/overview' && hash === '#analytics';
  if (item.to === '/admin/overview')
    return pathname === '/admin/overview' && hash !== '#analytics';
  return pathname === item.to || pathname.startsWith(item.to + '/');
}

function renderNav(
  pathname: string,
  hash: string,
  className: string,
) {
  return NAV.map((item) => {
    const active = isActive(pathname, hash, item);
    return (
      <Link
        key={item.label}
        to={item.to}
        aria-current={active ? 'page' : undefined}
        className={cn(
          buttonVariants({ variant: 'ghost' }),
          className,
          active && 'bg-muted',
        )}
      >
        {item.icon}
        {item.label}
      </Link>
    );
  });
}

export interface AdminShellProps {
  children: ReactNode;
  
  productPath?: string;
  
  loginPath?: string;
}

export function AdminShell({
  children,
  productPath = '/app',
  loginPath = '/login',
}: AdminShellProps) {
  const { user, loading } = useAuth();
  const { pathname, hash, search } = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-svh items-center justify-center text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }
  
  if (!user) {
    return (
      <Navigate to={loginPath} state={{ from: `${pathname}${search}` }} replace />
    );
  }

  return (
    <div className="flex h-svh flex-col bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b px-4 lg:px-6">
        <Link
          to="/admin/overview"
          className="flex items-center gap-2 text-sm font-semibold text-foreground"
        >
          <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck size={16} aria-hidden="true" />
          </span>
          管理控制台
        </Link>
        <div className="flex items-center gap-2">
          <Link
            to={productPath}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'sm' }),
              'text-muted-foreground',
            )}
          >
            <ArrowLeft size={15} aria-hidden="true" /> 返回产品
          </Link>
          <UserMenu />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {/* 窄屏：紧凑 chips 横向导航（B9/X2——不再 w-full 撑满一屏，多项可见） */}
        <nav
          aria-label="管理控制台导航"
          className="flex gap-1 overflow-x-auto border-b px-3 py-2 md:hidden"
        >
          {renderNav(
            pathname,
            hash,
            'shrink-0 justify-start whitespace-nowrap px-3',
          )}
        </nav>

        <div className="flex min-h-0 flex-1">
          {/* 宽屏：左侧固定节导航 */}
          <aside className="hidden w-56 shrink-0 border-r md:block">
            <nav aria-label="管理控制台导航" className="space-y-1 p-3">
              {renderNav(pathname, hash, 'w-full justify-start')}
            </nav>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-6xl p-4 lg:p-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
