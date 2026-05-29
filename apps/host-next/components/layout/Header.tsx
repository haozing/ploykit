import Link from 'next/link';
import { Bell, CircleDot, Search } from 'lucide-react';
import { AdminGlobalSearch } from '@host/components/admin/search/AdminGlobalSearch';
import { ThemeToggle } from '@host/components/theme/ThemeToggle';
import { cn } from '@host/components/ui/cn';
import { createHostTranslator, readHostMessageValue } from '@host/lib/host-i18n';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { HeaderScope, HeaderUser } from './types';
import { HeaderLanguageSwitch } from './HeaderLanguageSwitch';
import { HeaderUserMenu, type HeaderUserMenuLabels } from './HeaderUserMenu';

interface HeaderLanguageSwitchLabels {
  label: string;
  targetShort: string;
}

export function Header({
  lang,
  area,
  scope,
  user,
  className,
}: {
  lang: SupportedLanguage;
  area: 'admin' | 'dashboard';
  scope?: HeaderScope;
  user?: HeaderUser;
  className?: string;
}) {
  const t = createHostTranslator(lang, 'shell.header');
  const languageSwitchLabels = readHostMessageValue<HeaderLanguageSwitchLabels>(
    lang,
    'shell.languageSwitch'
  );
  const userMenuLabels = readHostMessageValue<HeaderUserMenuLabels>(lang, 'shell.userMenu');
  const searchPath = localizedPath(lang, area === 'admin' ? '/admin/search' : '/dashboard');
  const areaLabel = area === 'admin' ? t('adminArea') : t('workspaceArea');
  const searchLabel = t('search');
  const notificationLabel = t('notifications');
  const searchPlaceholder = t('searchPlaceholder');

  return (
    <header
      className={cn(
        'sticky top-0 z-20 flex min-h-16 items-center gap-2 border-b border-admin-border bg-admin-surface/95 px-4 backdrop-blur sm:gap-3 sm:px-5',
        className
      )}
    >
      <span className="sr-only">{scope?.label ?? area}</span>
      <div className="flex min-w-0 items-center gap-2 lg:hidden">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-admin-md bg-slate-950 text-xs font-bold text-white dark:bg-slate-100 dark:text-slate-950">
          P
        </span>
        <span className="truncate text-sm font-semibold text-admin-text">
          {areaLabel}
        </span>
      </div>
      <div className="hidden min-w-0 flex-1 items-center gap-2 xl:flex">
        {scope ? (
          <div className="inline-flex items-center gap-2 rounded-admin-md border border-admin-border bg-admin-surface-muted px-3 py-1.5 text-xs text-admin-text-muted">
            <CircleDot className="h-3.5 w-3.5 text-admin-success" aria-hidden />
            <span className="font-semibold text-admin-text">{scope.label}</span>
            {scope.detail ? <span>{scope.detail}</span> : null}
          </div>
        ) : null}
      </div>
      {area === 'admin' ? (
        <AdminGlobalSearch lang={lang} searchPath={searchPath} />
      ) : (
        <form
          action={searchPath}
          className="hidden h-10 w-full max-w-sm items-center gap-2 rounded-admin-md border border-admin-border bg-admin-bg px-3 text-sm text-admin-text-muted shadow-sm shadow-slate-950/5 lg:flex xl:max-w-md 2xl:max-w-lg"
        >
          <Search className="h-4 w-4 shrink-0" aria-hidden />
          <input
            name="q"
            type="search"
            placeholder={searchPlaceholder}
            className="min-w-0 flex-1 bg-transparent text-sm text-admin-text outline-none placeholder:text-admin-text-subtle"
          />
        </form>
      )}
      <div className="ml-auto flex min-w-0 shrink-0 items-center justify-end gap-1 sm:gap-2">
        {area === 'dashboard' ? (
          <Link
            href={searchPath}
            className="inline-flex h-9 w-9 items-center justify-center rounded-admin-md text-admin-text-muted hover:bg-admin-surface-muted hover:text-admin-text lg:hidden"
            aria-label={searchLabel}
          >
            <Search className="h-4 w-4" aria-hidden />
          </Link>
        ) : null}
        <Link
          href={localizedPath(lang, '/dashboard/notifications')}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-admin-md text-admin-text-muted hover:bg-admin-surface-muted hover:text-admin-text"
          aria-label={notificationLabel}
        >
          <Bell className="h-4 w-4" aria-hidden />
          <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full bg-admin-danger" aria-hidden />
        </Link>
        <HeaderLanguageSwitch
          lang={lang}
          label={languageSwitchLabels.label}
          targetShort={languageSwitchLabels.targetShort}
        />
        <ThemeToggle />
        {user ? <HeaderUserMenu lang={lang} user={user} labels={userMenuLabels} /> : null}
      </div>
    </header>
  );
}
