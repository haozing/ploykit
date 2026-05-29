'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';
import {
  Activity,
  BadgeDollarSign,
  BarChart3,
  Cable,
  CircleDollarSign,
  CreditCard,
  FileText,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  Package,
  Search,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Users,
} from 'lucide-react';
import { cn } from '@host/components/ui/cn';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { AppFrameLabels } from './AppFrame';
import type { NavGroup, NavIconKey } from './types';

const navIcons: Record<
  NavIconKey,
  ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
> = {
  activity: Activity,
  badgeDollarSign: BadgeDollarSign,
  barChart3: BarChart3,
  cable: Cable,
  circleDollarSign: CircleDollarSign,
  creditCard: CreditCard,
  fileText: FileText,
  folderOpen: FolderOpen,
  gauge: Gauge,
  layoutDashboard: LayoutDashboard,
  package: Package,
  search: Search,
  settings: Settings,
  shieldCheck: ShieldCheck,
  squareTerminal: SquareTerminal,
  users: Users,
};

function isActivePath(currentPath: string, href: string): boolean {
  const normalizedCurrent = currentPath.replace(/\/$/, '') || '/';
  const normalizedHref = href.replace(/\/$/, '') || '/';
  if (normalizedCurrent === normalizedHref) {
    return true;
  }
  if (normalizedHref.endsWith('/admin') || normalizedHref.endsWith('/dashboard')) {
    return false;
  }
  return normalizedCurrent.startsWith(`${normalizedHref}/`);
}

export function Sidebar({
  lang,
  groups,
  activePath,
  label,
  labels,
}: {
  lang: SupportedLanguage;
  groups: readonly NavGroup[];
  activePath?: string;
  label?: string;
  labels: AppFrameLabels;
}) {
  const pathname = usePathname();
  const currentPath = activePath ?? pathname;

  return (
    <aside className="hidden h-screen w-[248px] shrink-0 border-r border-admin-border bg-admin-surface px-3 py-4 lg:sticky lg:top-0 lg:flex lg:flex-col">
      <div className="mb-5 flex items-center gap-3 px-3">
        <span className="relative grid h-9 w-9 place-items-center rounded-admin-md bg-slate-950 text-xs font-bold text-white shadow-sm dark:bg-slate-100 dark:text-slate-950">
          P
          <span
            className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-admin-primary"
            aria-hidden
          />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-[15px] font-semibold leading-5 text-admin-text">
            {labels.brandName}
          </strong>
          <small className="block truncate text-xs leading-4 text-admin-text-muted">
            {labels.platformLabel}
          </small>
        </span>
      </div>
      <nav
        aria-label={label ?? labels.navigation}
        className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1 [scrollbar-width:thin]"
      >
        {groups.map((group) => (
          <section key={group.id} className="space-y-2">
            <h2 className="px-3 text-[11px] font-semibold tracking-normal text-admin-text-subtle">
              {group.label}
            </h2>
            <div className="space-y-1">
              {group.items.map((item) => {
                const href = item.localized === false ? item.href : localizedPath(lang, item.href);
                const active = isActivePath(currentPath, href);
                const Icon = item.icon ? navIcons[item.icon] : undefined;
                return (
                  <Link
                    key={item.href}
                    href={href}
                    className={cn(
                      'relative flex min-h-9 items-center gap-3 rounded-admin-md px-3 py-2 text-sm font-medium text-admin-text-muted transition duration-150',
                      'hover:bg-admin-surface-muted hover:text-admin-text',
                      active &&
                        'bg-admin-primary-soft text-admin-primary shadow-sm shadow-blue-950/5 ring-1 ring-admin-primary/10 hover:bg-admin-primary-soft hover:text-admin-primary'
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    {active ? (
                      <span
                        className="absolute left-0 top-2 h-6 w-0.5 rounded-full bg-admin-primary"
                        aria-hidden
                      />
                    ) : null}
                    {Icon ? (
                      <span
                        className={cn(
                          'grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-500 transition dark:text-slate-400',
                          active && 'bg-admin-surface text-admin-primary'
                        )}
                        aria-hidden
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                    ) : null}
                    <span className="min-w-0 flex-1 leading-5">
                      <span className="block truncate">{item.label}</span>
                    </span>
                    {item.badge ? (
                      <span className="rounded-full bg-admin-surface-muted px-2 py-0.5 text-xs text-admin-text-muted">
                        {item.badge}
                      </span>
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
      <div className="mt-4 px-3 text-xs leading-5 text-admin-text-muted">
        <span className="block">{labels.platformFullName}</span>
        <span className="block">{labels.version}</span>
      </div>
    </aside>
  );
}
