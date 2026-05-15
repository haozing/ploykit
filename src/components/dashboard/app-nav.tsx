/**
 * Dashboard Navigation Component
 *
 * Renders the role-filtered system and plugin dashboard menu.
 */

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { useLanguage } from '@/contexts/language-context';
import { cn } from '@/lib/_core/utils';
import { Badge } from '@/components/ui/badge';
import * as LucideIcons from 'lucide-react';
import type { NavGroupConfig } from '@/lib/ui/navigation/types';

interface AppNavProps {
  navGroups: NavGroupConfig[];
}

type IconComponent = React.ComponentType<{ className?: string }>;

const iconRegistry = LucideIcons as unknown as Record<string, IconComponent | undefined>;
type TranslationFn = ReturnType<typeof useTranslations>;

function toPascalCaseIconName(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function resolveIcon(icon?: string | null): IconComponent | null {
  if (!icon) return null;

  return (
    iconRegistry[icon] ?? iconRegistry[toPascalCaseIconName(icon)] ?? iconRegistry.Circle ?? null
  );
}

function translateWithFallback(t: TranslationFn, key: string, fallback?: string): string {
  return t.has(key) ? t(key) : fallback || key;
}

/**
 * AppNav Component
 */
export function AppNav({ navGroups }: AppNavProps) {
  const pathname = usePathname();
  const t = useTranslations();
  const { getLangPath } = useLanguage();

  // Use the most specific matching path so parent and child items do not both appear active.
  const activeItemId = useMemo(() => {
    let bestMatch: { id: string; length: number } | null = null;

    for (const group of navGroups) {
      for (const item of group.items) {
        const fullPath = getLangPath(item.href);
        if (pathname === fullPath || pathname.startsWith(fullPath + '/')) {
          if (!bestMatch || fullPath.length > bestMatch.length) {
            bestMatch = { id: item.id, length: fullPath.length };
          }
        }
      }
    }

    return bestMatch?.id || null;
  }, [pathname, navGroups, getLangPath]);

  return (
    <nav className="flex-1 overflow-y-auto scrollbar-hide p-4">
      {navGroups.map((group, groupIndex) => (
        <div key={group.key} className={cn(groupIndex > 0 && 'mt-6')}>
          {/* Group Title */}
          <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {translateWithFallback(t, group.titleKey, group.fallbackTitle)}
          </h3>

          {/* Group Items */}
          <div className="space-y-1">
            {group.items.map((item) => {
              const IconComponent = resolveIcon(item.icon);

              const fullPath = getLangPath(item.href);
              const isActive = item.id === activeItemId;

              return (
                <Link
                  key={item.id}
                  href={fullPath}
                  className={cn(
                    'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-200',
                    'hover:bg-primary/10 hover:text-foreground hover:shadow-sm hover:scale-[1.02]',
                    isActive
                      ? 'bg-primary text-primary-foreground font-medium shadow-sm ring-1 ring-primary/30'
                      : 'text-muted-foreground hover:translate-x-0.5'
                  )}
                >
                  {IconComponent && (
                    <IconComponent className="h-4 w-4 group-hover:scale-110 transition-transform duration-200" />
                  )}
                  <span className="flex-1">
                    {item.label ?? translateWithFallback(t, item.i18nKey, item.fallbackLabel)}
                  </span>
                  {item.badge && (
                    <Badge variant={item.badgeVariant || 'secondary'} className="ml-auto">
                      {item.badge}
                    </Badge>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
