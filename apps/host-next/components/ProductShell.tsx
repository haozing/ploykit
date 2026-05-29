import type { ReactNode } from 'react';
import type { ModuleHostSession } from '@/lib/module-runtime';
import { getCurrentHostSession } from '@host/lib/auth';
import { readHostMessageValue } from '@host/lib/host-i18n';
import type { SupportedLanguage } from '@host/lib/i18n';
import { getHostCapabilitiesForSession, type HostCapability } from '@host/lib/rbac';
import {
  DataTable,
  EmptyState as UiEmptyState,
  FormField as UiFormField,
  StatCard as UiStatCard,
} from '@host/components/ui';
import { AppFrame } from '@host/components/layout/AppFrame';
import { PageShell } from '@host/components/layout/PageShell';
import type { NavGroup, NavIconKey } from '@host/components/layout/types';
import { SiteFrame } from '@host/components/site/SiteFrame';
import { defaultAdminNavItems, resolveAdminNavItems } from '@host/lib/admin-console-nav';
import { resolvePublicNavigation } from '@host/lib/site-navigation';

export interface ProductNavItem {
  href: string;
  label: string;
  detail?: string;
  icon?: NavIconKey;
  group?: string;
  source?: 'host' | 'module';
  requires?: {
    capabilities?: readonly HostCapability[];
    moduleId?: string;
    note?: string;
  };
}

interface ShellScopeCopy {
  label: string;
  detail: string;
}

interface ShellDashboardGroupsCopy {
  workspace: string;
  account: string;
  work: string;
}

interface ShellUserNamesCopy {
  admin: string;
  user: string;
}

interface AuthShellExperienceCopy {
  heroTitle: string;
  heroHighlight: string;
  heroBody: string;
  principles: Array<{
    title: string;
    body: string;
  }>;
}

export const siteNav: readonly ProductNavItem[] = [
  { href: '/', label: '首页' },
  { href: '/about', label: '关于' },
  { href: '/pricing', label: '价格' },
  { href: '/contact', label: '联系' },
];

export const dashboardNav: readonly ProductNavItem[] = [
  { href: '/dashboard', label: '概览' },
  { href: '/dashboard/workspaces', label: '工作区' },
  { href: '/dashboard/profile', label: '个人资料' },
  { href: '/dashboard/billing', label: '账单' },
  { href: '/dashboard/orders', label: '订单' },
  { href: '/dashboard/credit-history', label: '点数记录' },
  { href: '/dashboard/files', label: '文件' },
  { href: '/dashboard/notifications', label: '通知' },
  { href: '/dashboard/settings/notifications', label: '通知设置' },
  { href: '/dashboard/tasks', label: '任务中心' },
];

function getDashboardNav(lang: SupportedLanguage): readonly ProductNavItem[] {
  return readHostMessageValue<readonly ProductNavItem[]>(lang, 'shell.dashboardNav');
}

function dashboardNavGroups(lang: SupportedLanguage): readonly NavGroup[] {
  const nav = getDashboardNav(lang);
  const groups = readHostMessageValue<ShellDashboardGroupsCopy>(lang, 'shell.dashboardGroups');
  return [
    {
      id: 'workspace',
      label: groups.workspace,
      items: nav
        .filter((item) => ['/dashboard', '/dashboard/workspaces'].includes(item.href))
        .map(toNavItem),
    },
    {
      id: 'account',
      label: groups.account,
      items: nav
        .filter((item) =>
          [
            '/dashboard/profile',
            '/dashboard/billing',
            '/dashboard/orders',
            '/dashboard/credit-history',
          ].includes(item.href)
        )
        .map(toNavItem),
    },
    {
      id: 'work',
      label: groups.work,
      items: nav
        .filter((item) =>
          [
            '/dashboard/files',
            '/dashboard/notifications',
            '/dashboard/settings/notifications',
            '/dashboard/tasks',
          ].includes(item.href)
        )
        .map(toNavItem),
    },
  ];
}

function adminNavGroups(nav: readonly ProductNavItem[]): readonly NavGroup[] {
  return groupedNavItems(nav).map(([group, items]) => ({
    id: group.toLowerCase().replace(/\s+/g, '-'),
    label: group,
    items: items.map(toNavItem),
  }));
}

function toNavItem(item: ProductNavItem) {
  return {
    href: item.href,
    label: item.label,
    detail: item.detail,
    icon: item.icon,
  };
}

export const adminNav: readonly ProductNavItem[] = defaultAdminNavItems;

async function getAdminNav(
  lang: SupportedLanguage,
  session: ModuleHostSession
): Promise<readonly ProductNavItem[]> {
  return resolveAdminNavItems(lang, session);
}

function groupedNavItems(items: readonly ProductNavItem[]): Array<[string, ProductNavItem[]]> {
  const groups = new Map<string, ProductNavItem[]>();
  for (const item of items) {
    const group = item.group ?? 'Navigation';
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  return Array.from(groups.entries());
}

function canSeeNavItem(item: ProductNavItem, capabilities: readonly HostCapability[]): boolean {
  const requiredCapabilities = item.requires?.capabilities ?? [];
  return requiredCapabilities.every((capability) => capabilities.includes(capability));
}

function filterAdminNavForSession(
  nav: readonly ProductNavItem[],
  session: ModuleHostSession
): readonly ProductNavItem[] {
  const capabilities = getHostCapabilitiesForSession(session);
  return nav.filter((item) => canSeeNavItem(item, capabilities));
}

function getShellUserName(lang: SupportedLanguage, role?: string) {
  const names = readHostMessageValue<ShellUserNamesCopy>(lang, 'shell.userNames');
  if (role === 'admin') {
    return names.admin;
  }
  return names.user;
}

function AdminPageShell({
  lang,
  title,
  subtitle,
  nav,
  actions,
  user,
  children,
}: {
  lang: SupportedLanguage;
  title: string;
  subtitle: string;
  nav: readonly ProductNavItem[];
  actions?: ReactNode;
  user?: {
    name: string;
    email?: string;
  };
  children: ReactNode;
}) {
  return (
    <AppFrame
      area="admin"
      lang={lang}
      navGroups={adminNavGroups(nav)}
      scope={readHostMessageValue<ShellScopeCopy>(lang, 'shell.adminScope')}
      user={user}
    >
      <PageShell title={title} description={subtitle} wide actions={actions}>
        {children}
      </PageShell>
    </AppFrame>
  );
}

export async function SiteShell({
  lang,
  children,
}: {
  lang: SupportedLanguage;
  children: ReactNode;
}) {
  const { headerItems, footerItems } = await resolvePublicNavigation(lang);
  return (
    <SiteFrame lang={lang} navItems={headerItems} footerItems={footerItems}>
      {children}
    </SiteFrame>
  );
}

export function AuthShell({
  lang,
  title,
  subtitle,
  children,
}: {
  lang: SupportedLanguage;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const copy = readHostMessageValue<AuthShellExperienceCopy>(lang, 'auth.shellExperience');

  return (
    <SiteFrame lang={lang}>
      <main className="relative overflow-hidden border-b border-admin-border bg-[radial-gradient(circle_at_14%_18%,rgba(37,99,235,0.13),transparent_30%),radial-gradient(circle_at_88%_14%,rgba(56,189,248,0.13),transparent_26%),linear-gradient(180deg,var(--admin-surface),var(--admin-bg))] text-admin-text">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-admin-primary/20 to-transparent"
          aria-hidden
        />
        <section className="relative z-10 mx-auto grid w-full max-w-7xl gap-10 px-4 py-12 sm:px-6 lg:min-h-[calc(100vh-13rem)] lg:grid-cols-[minmax(0,0.92fr)_minmax(380px,0.62fr)] lg:items-center lg:px-8 lg:py-16">
          <div className="max-w-2xl">
            <h1 className="max-w-3xl text-[2.5rem] font-semibold leading-[1.05] tracking-[-0.02em] text-admin-text sm:text-5xl lg:text-[3.75rem]">
              {copy.heroTitle} <span className="whitespace-nowrap">{copy.heroHighlight}</span>
            </h1>
            <p className="mt-5 max-w-2xl text-base leading-8 text-admin-text-muted sm:text-lg">
              {copy.heroBody}
            </p>
            <div className="mt-8 grid gap-4 border-l border-admin-border pl-5">
              {copy.principles.map((item) => (
                <div key={item.title}>
                  <strong className="text-sm font-semibold text-admin-text">{item.title}</strong>
                  <p className="mt-1 text-sm leading-6 text-admin-text-muted">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
          <section className="flex min-h-[430px] w-full flex-col rounded-admin-lg border border-admin-border bg-admin-surface/94 p-5 shadow-admin-card backdrop-blur sm:min-h-[460px] sm:p-7 lg:min-h-[530px]">
            <div className="mb-6">
              <h2 className="text-3xl font-semibold tracking-[-0.02em] text-admin-text">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-admin-text-muted">{subtitle}</p>
            </div>
            <div className="flex flex-1 flex-col justify-between gap-6">{children}</div>
          </section>
        </section>
      </main>
    </SiteFrame>
  );
}

export async function WorkspaceShell({
  lang,
  title,
  subtitle,
  nav = dashboardNav,
  actions,
  children,
}: {
  lang: SupportedLanguage;
  title: string;
  subtitle: string;
  nav?: readonly ProductNavItem[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  const session = await getCurrentHostSession();

  if (nav === adminNav) {
    const filteredNav = filterAdminNavForSession(await getAdminNav(lang, session), session);
    return (
      <AdminPageShell
        lang={lang}
        title={title}
        subtitle={subtitle}
        nav={filteredNav}
        actions={actions}
        user={
          session.user
            ? {
                name: getShellUserName(lang, session.user.role),
                email: session.user.email,
              }
            : undefined
        }
      >
        {children}
      </AdminPageShell>
    );
  }

  return (
    <AppFrame
      area="dashboard"
      lang={lang}
      navGroups={
        nav === dashboardNav
          ? dashboardNavGroups(lang)
          : [
              {
                id: 'tools',
                label: readHostMessageValue<string>(lang, 'shell.toolsGroup'),
                items: nav.map(toNavItem),
              },
            ]
      }
      scope={readHostMessageValue<ShellScopeCopy>(lang, 'shell.workspaceScope')}
      user={
        session.user
          ? {
              name: getShellUserName(lang, session.user.role),
              email: session.user.email,
            }
          : undefined
      }
    >
      <PageShell title={title} description={subtitle} actions={actions} wide>
        {children}
      </PageShell>
    </AppFrame>
  );
}

export const StatCard = UiStatCard;
export const MetricCard = UiStatCard;

export const FormField = UiFormField;

export function PlaceholderTable({
  columns,
  rows,
}: {
  columns: readonly string[];
  rows: readonly (readonly ReactNode[])[];
}) {
  return <DataTable columns={columns} rows={rows} />;
}

export const EmptyState = UiEmptyState;
