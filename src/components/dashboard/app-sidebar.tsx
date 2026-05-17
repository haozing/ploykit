/**
 * Dashboard Sidebar
 *
 * Left sidebar navigation with:
 * - Logo and app name
 * - Role-based navigation menu (via AppNav)
 */

'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useLanguage } from '@/contexts/language-context';
import { useTranslations } from 'next-intl';
import { AppNav } from './app-nav';
import type { NavGroupConfig } from '@/lib/ui/navigation/types';
import { siteConfig } from '@/site.config';

interface AppSidebarProps {
  navGroups: NavGroupConfig[];
}

export function AppSidebar({ navGroups }: AppSidebarProps) {
  const { getLangPath } = useLanguage();
  const t = useTranslations('dashboard');

  return (
    <div className="flex h-full flex-col bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-border/40 px-6">
        <Link
          href={getLangPath('/profile')}
          className="group flex items-center gap-2 font-semibold transition-all duration-200 hover:gap-3"
        >
          <Image
            src={siteConfig.assets.brand.mark}
            alt=""
            width={32}
            height={32}
            priority
            className="h-8 w-8 transition-transform duration-200 group-hover:scale-110"
          />
          <span className="text-lg group-hover:text-primary transition-colors duration-200">
            {t('appName')}
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <AppNav navGroups={navGroups} />
    </div>
  );
}
