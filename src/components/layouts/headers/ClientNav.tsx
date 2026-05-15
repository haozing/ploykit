/**
 * ===========================================================================
 * Client Navigation Component
 * ===========================================================================
 *
 * Client component that supports multilingual navigation
 *
 * Features:
 * - Use next-intl to automatically translate navigation text
 * - Automatically add language prefix to links
 * - Respond to current language changes
 * - Support dynamic navigation (system + plugins)
 * - Highlight current page in navigation (longest path match)
 */

'use client';

import { useTranslations, useLocale } from 'next-intl';
import { usePathname } from 'next/navigation';
import { useMemo } from 'react';
import Link from 'next/link';
import { cn } from '@/lib/_core/utils';
import type { SiteMenuItem } from '@/lib/ui/navigation/types';

type TranslationFn = ReturnType<typeof useTranslations>;

interface ClientNavProps {
  /**
   * Navigation item list (system + plugins, already sorted)
   */
  navItems: SiteMenuItem[];
}

function translateWithFallback(t: TranslationFn, key: string, fallback?: string): string {
  return t.has(key) ? t(key) : fallback || key;
}

export function ClientNav({ navItems }: ClientNavProps) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();

  // 使用最长路径匹配算法找出当前应该选中的菜单项ID
  // 这样可以避免父级菜单和子级菜单同时被选中的问题
  const activeItemId = useMemo(() => {
    let bestMatch: { id: string; length: number } | null = null;

    for (const item of navItems) {
      const href = item.href === '/' ? `/${locale}` : `/${locale}${item.href}`;
      // 检查是否匹配（完全匹配或前缀匹配）
      if (pathname === href || pathname.startsWith(href + '/')) {
        // 保留最长匹配的菜单项
        if (!bestMatch || href.length > bestMatch.length) {
          bestMatch = { id: item.id, length: href.length };
        }
      }
    }

    return bestMatch?.id || null;
  }, [pathname, navItems, locale]);

  if (navItems.length === 0) {
    return null;
  }

  return (
    <nav className="flex items-center gap-6">
      {navItems.map((item) => {
        // Construct href with language prefix
        const href = item.href === '/' ? `/${locale}` : `/${locale}${item.href}`;
        // 只有最长匹配的菜单项才被标记为选中
        const isActive = item.id === activeItemId;

        return (
          <Link
            key={item.id}
            href={href}
            className={cn(
              'text-sm transition-opacity',
              isActive ? 'opacity-100 font-medium' : 'opacity-80 hover:opacity-100'
            )}
            style={{
              color: 'var(--header-text)',
            }}
          >
            {item.label ?? translateWithFallback(t, item.i18nKey, item.fallbackLabel)}
          </Link>
        );
      })}
    </nav>
  );
}
