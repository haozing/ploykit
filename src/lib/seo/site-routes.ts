import type { MetadataRoute } from 'next';
import { locales, type Locale } from '@/i18n/config';
import { siteConfig } from '@/site.config';
import { languageAlternates, localizedAbsoluteUrl, normalizeAppPath } from './url-policy';

export interface PublicSiteRoute {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
  priority: number;
}

const EXTRA_PUBLIC_SITE_ROUTES: readonly PublicSiteRoute[] = [
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.4 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.4 },
];

function routePriority(path: string): number {
  if (path === '/') return 1;
  if (path === '/pricing') return 0.8;
  if (path === '/about' || path === '/contact') return 0.7;
  return 0.5;
}

function routeChangeFrequency(
  path: string
): NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']> {
  if (path === '/') return 'daily';
  if (path === '/pricing') return 'weekly';
  return 'monthly';
}

export function listPublicSiteRoutes(): PublicSiteRoute[] {
  const byPath = new Map<string, PublicSiteRoute>();

  for (const path of Object.keys(siteConfig.pages)) {
    const normalized = normalizeAppPath(path);
    byPath.set(normalized, {
      path: normalized,
      changeFrequency: routeChangeFrequency(normalized),
      priority: routePriority(normalized),
    });
  }

  for (const route of EXTRA_PUBLIC_SITE_ROUTES) {
    byPath.set(route.path, route);
  }

  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function listLocalizedPublicSiteSitemapEntries(): MetadataRoute.Sitemap {
  return locales.flatMap((locale) =>
    listPublicSiteRoutes().map((route) => ({
      url: localizedAbsoluteUrl(locale, route.path),
      changeFrequency: route.changeFrequency,
      priority: route.priority,
      alternates: {
        languages: languageAlternates(route.path),
      },
    }))
  );
}

export function localizedSitemapUrlsFor(path: string): Record<Locale, string> {
  return languageAlternates(path);
}
