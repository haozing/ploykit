import Link from 'next/link';
import { ThemeToggle } from '@host/components/theme/ThemeToggle';
import { HeaderLanguageSwitch } from '@host/components/layout/HeaderLanguageSwitch';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { createHostTranslator } from '@host/lib/host-i18n';
import { getProductBrandPresentation } from '@host/lib/presentation/seo-presentation';
import type { NavItem } from '@host/components/layout/types';

export function PublicNav({ lang, items }: { lang: SupportedLanguage; items: readonly NavItem[] }) {
  const t = createHostTranslator(lang, 'site.nav');
  const languageSwitchText = createHostTranslator(lang, 'shell.languageSwitch');
  const brand = getProductBrandPresentation(lang);
  const mark = brand.logoMark ?? '/brand/mark.png';

  const renderItems = (keyPrefix: string) =>
    items.map((item) => (
      <Link
        key={`${keyPrefix}-${item.href}`}
        href={localizedPath(lang, item.href)}
        className="whitespace-nowrap rounded-admin-md px-3 py-2 text-sm font-medium text-admin-text-muted transition hover:bg-admin-surface-muted hover:text-admin-text"
      >
        {item.label}
      </Link>
    ));

  return (
    <header className="sticky top-0 z-20 border-b border-admin-border bg-admin-surface/95 backdrop-blur">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          href={localizedPath(lang)}
          className="flex items-center gap-3 font-semibold text-admin-text"
        >
          <img
            src={mark}
            alt=""
            width={36}
            height={36}
            className="h-9 w-9 rounded-md object-contain"
          />
          <span>{brand.productName}</span>
        </Link>
        <nav className="hidden items-center gap-1 md:flex" aria-label={t('aria')}>
          {renderItems('desktop')}
        </nav>
        <div className="flex items-center gap-2">
          <HeaderLanguageSwitch
            lang={lang}
            label={languageSwitchText('label')}
            targetShort={languageSwitchText('targetShort')}
          />
          <ThemeToggle />
          <Link
            href={localizedPath(lang, '/login')}
            className="hidden h-9 items-center rounded-admin-md border border-admin-border bg-admin-surface px-3.5 text-sm font-medium text-admin-text shadow-sm shadow-slate-950/5 transition-colors hover:bg-admin-surface-muted sm:inline-flex"
          >
            {t('login')}
          </Link>
          <Link
            href={localizedPath(lang, '/register')}
            className="inline-flex h-9 items-center rounded-admin-md bg-admin-primary px-3.5 text-sm font-semibold !text-white shadow-[0_8px_18px_rgba(37,99,235,0.16)] transition-colors hover:bg-blue-700 dark:!text-white dark:hover:bg-blue-400"
          >
            {t('register')}
          </Link>
        </div>
      </div>
      <nav
        className="flex gap-1 overflow-x-auto border-t border-admin-border px-4 py-2 md:hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        aria-label={t('mobileAria')}
      >
        {renderItems('mobile')}
      </nav>
    </header>
  );
}
