import Link from 'next/link';
import type { ReactNode } from 'react';
import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import { readHostMessageValue } from '@host/lib/host-i18n';
import type { NavItem } from '@host/components/layout/types';
import { PublicNav } from './PublicNav';
import { getPublicFooterItems, getPublicNavItems } from './site-nav';

export function SiteFrame({
  lang,
  navItems,
  footerItems,
  children,
}: {
  lang: SupportedLanguage;
  navItems?: readonly NavItem[];
  footerItems?: readonly NavItem[];
  children: ReactNode;
}) {
  const resolvedNavItems = navItems ?? getPublicNavItems(lang);
  const resolvedFooterItems = footerItems ?? getPublicFooterItems(lang);
  const footerBrand = readHostMessageValue<string>(lang, 'site.footerBrand');

  return (
    <div className="flex min-h-screen flex-col bg-admin-bg text-admin-text">
      <PublicNav lang={lang} items={resolvedNavItems} />
      <div className="flex-1">{children}</div>
      <footer className="border-t border-admin-border bg-admin-surface">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-7 text-sm text-admin-text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span className="font-semibold text-admin-text">{footerBrand}</span>
          <div className="flex flex-wrap items-center gap-4">
            {resolvedFooterItems.map((item) => (
              <Link key={item.href} href={localizedPath(lang, item.href)} className="hover:text-admin-text">
                {item.label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
