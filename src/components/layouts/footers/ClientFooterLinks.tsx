/**
 * ============================================================================
 * Client-side Footer Links Component
 * ============================================================================
 *
 * Supports multi-language and dynamic links in Footer
 *
 * Features:
 * - Uses next-intl for internationalization
 * - Automatically adds language prefix to links
 * - Reads link configuration from site.config.ts
 */

'use client';

import { useTranslations, useLocale } from 'next-intl';
import Link from 'next/link';
import type { SiteMenuItem } from '@/lib/ui/navigation/types';

type TranslationFn = ReturnType<typeof useTranslations>;

interface ClientFooterLinksProps {
  links: SiteMenuItem[];
}

function translateWithFallback(t: TranslationFn, key: string, fallback?: string): string {
  return t.has(key) ? t(key) : fallback || key;
}

/**
 * ClientFooterLinks Component
 *
 * Renders the link list in Footer
 */
export function ClientFooterLinks({ links }: ClientFooterLinksProps) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <nav className="flex items-center gap-6">
      {links.map((link) => {
        // Add language prefix to href
        const href = link.href === '/' ? `/${locale}` : `/${locale}${link.href}`;

        return (
          <Link
            key={link.id}
            href={href}
            className="text-sm transition-opacity hover:opacity-80"
            style={{
              color: 'var(--footer-text)',
            }}
          >
            {link.label ?? translateWithFallback(t, link.i18nKey, link.fallbackLabel)}
          </Link>
        );
      })}
    </nav>
  );
}
