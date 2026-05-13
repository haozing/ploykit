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
import { siteConfig } from '../../../../site.config';

/**
 * ClientFooterLinks Component
 *
 * Renders the link list in Footer
 */
export function ClientFooterLinks() {
  const t = useTranslations();
  const locale = useLocale();

  const footerLinks = siteConfig.footer?.links || [];

  return (
    <nav className="flex items-center gap-6">
      {footerLinks.map((link) => {
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
            {t(link.i18nKey)}
          </Link>
        );
      })}
    </nav>
  );
}
