'use client';

import Link from 'next/link';
import { ChevronDown, LogOut, UserRound, Bell } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@host/components/ui/cn';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { HeaderUser } from './types';

export interface HeaderUserMenuLabels {
  profile: string;
  notifications: string;
  logout: string;
  menu: string;
}

export function HeaderUserMenu({
  lang,
  user,
  labels,
}: {
  lang: SupportedLanguage;
  user: HeaderUser;
  labels: HeaderUserMenuLabels;
}) {
  const [open, setOpen] = useState(false);
  const initials = user.name.slice(0, 2).toUpperCase();

  return (
    <div className="relative inline-flex min-w-0 items-center">
      <button
        type="button"
        className={cn(
          'inline-flex min-w-0 items-center gap-2 rounded-admin-md px-2 py-1 text-sm transition',
          'hover:bg-admin-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-admin-primary',
          open && 'bg-admin-surface-muted'
        )}
        aria-label={labels.menu}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-admin-primary text-xs font-semibold text-white dark:text-slate-950">
          {initials}
        </span>
        <span className="hidden min-w-0 text-left sm:block">
          <span className="block max-w-40 truncate text-xs font-semibold text-admin-text">{user.name}</span>
          {user.email ? (
            <span className="block max-w-44 truncate text-[11px] text-admin-text-muted">{user.email}</span>
          ) : null}
        </span>
        <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-admin-text-subtle sm:block" aria-hidden />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-admin-md border border-admin-border bg-admin-surface p-1 shadow-admin-popover"
        >
          <Link
            href={localizedPath(lang, '/dashboard/profile')}
            role="menuitem"
            className="flex min-h-9 items-center gap-2 rounded-admin-md px-2 text-sm font-medium text-admin-text-muted transition hover:bg-admin-surface-muted hover:text-admin-text"
            onClick={() => setOpen(false)}
          >
            <UserRound className="h-4 w-4" aria-hidden />
            {labels.profile}
          </Link>
          <Link
            href={localizedPath(lang, '/dashboard/notifications')}
            role="menuitem"
            className="flex min-h-9 items-center gap-2 rounded-admin-md px-2 text-sm font-medium text-admin-text-muted transition hover:bg-admin-surface-muted hover:text-admin-text"
            onClick={() => setOpen(false)}
          >
            <Bell className="h-4 w-4" aria-hidden />
            {labels.notifications}
          </Link>
          <form action="/api/auth/logout" method="post">
            <input type="hidden" name="next" value={localizedPath(lang, '/login')} />
            <button
              type="submit"
              role="menuitem"
              className="flex min-h-9 w-full items-center gap-2 rounded-admin-md px-2 text-left text-sm font-medium text-admin-danger transition hover:bg-admin-danger/10"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              {labels.logout}
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
