import type { MetadataRoute } from 'next';
import { logger } from '@/lib/_core/logger';
import type { SitemapEntry } from '@/lib/bus/hook-helpers.server';
import { absoluteUrl, appBaseUrl, normalizeAppPath, stripLocalePrefix } from './url-policy';

export const SITEMAP_CHUNK_SIZE = 45_000;
const DISALLOWED_SITEMAP_PREFIXES = [
  '/api',
  '/admin',
  '/plugins',
  '/profile',
  '/billing',
  '/notifications',
  '/tasks',
  '/settings',
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
  '/success',
];

const CHANGE_FREQUENCIES = new Set([
  'always',
  'hourly',
  'daily',
  'weekly',
  'monthly',
  'yearly',
  'never',
]);

export interface SitemapChunk {
  id: number;
  start: number;
  end: number;
}

export function normalizeSitemapEntry(
  entry: SitemapEntry,
  context: { source: string; pluginId?: string }
): MetadataRoute.Sitemap[number] | null {
  const url = normalizeSitemapUrl(entry.url, context);
  if (!url) {
    return null;
  }

  return {
    url,
    lastModified: normalizeLastModified(entry.lastModified, context),
    changeFrequency: normalizeChangeFrequency(entry.changeFrequency, context),
    priority: normalizePriority(entry.priority, context),
    alternates: normalizeAlternates(entry.alternates, context),
  };
}

export function dedupeSitemapItems(items: MetadataRoute.Sitemap): MetadataRoute.Sitemap {
  const byUrl = new Map<string, MetadataRoute.Sitemap[number]>();

  for (const item of items) {
    if (!item.url || byUrl.has(item.url)) {
      continue;
    }

    byUrl.set(item.url, item);
  }

  return [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url));
}

export function createSitemapChunks(totalItems: number): SitemapChunk[] {
  const count = Math.max(1, Math.ceil(totalItems / SITEMAP_CHUNK_SIZE));
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    start: index * SITEMAP_CHUNK_SIZE,
    end: Math.min((index + 1) * SITEMAP_CHUNK_SIZE, totalItems),
  }));
}

function normalizeSitemapUrl(
  value: string,
  context: { source: string; pluginId?: string }
): string | null {
  try {
    const url = new URL(value, `${appBaseUrl()}/`);
    const base = new URL(appBaseUrl());

    url.hash = '';

    if (url.origin !== base.origin) {
      logRejectedSitemapEntry('origin', value, context);
      return null;
    }

    if (base.protocol === 'https:' && url.protocol !== 'https:') {
      logRejectedSitemapEntry('protocol', value, context);
      return null;
    }

    if (base.protocol === 'http:' && url.protocol !== 'http:') {
      logRejectedSitemapEntry('protocol', value, context);
      return null;
    }

    if (url.search) {
      logRejectedSitemapEntry('query', value, context);
      return null;
    }

    const pathname = normalizeAppPath(url.pathname);
    if (isDisallowedSitemapPath(pathname)) {
      logRejectedSitemapEntry('private_path', value, context);
      return null;
    }

    return absoluteUrl(pathname);
  } catch {
    logRejectedSitemapEntry('invalid_url', value, context);
    return null;
  }
}

function isDisallowedSitemapPath(pathname: string): boolean {
  const unlocalized = stripLocalePrefix(pathname);
  return DISALLOWED_SITEMAP_PREFIXES.some(
    (prefix) =>
      pathname === prefix ||
      pathname.startsWith(`${prefix}/`) ||
      unlocalized === prefix ||
      unlocalized.startsWith(`${prefix}/`)
  );
}

function normalizeLastModified(
  value: SitemapEntry['lastModified'],
  context: { source: string; pluginId?: string }
) {
  if (value === undefined) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    logger.warn({ ...context, value }, 'Rejected invalid sitemap lastModified value');
    return undefined;
  }

  return date;
}

function normalizeChangeFrequency(
  value: SitemapEntry['changeFrequency'],
  context: { source: string; pluginId?: string }
) {
  if (value === undefined) {
    return undefined;
  }

  if (!CHANGE_FREQUENCIES.has(value)) {
    logger.warn({ ...context, value }, 'Rejected invalid sitemap changeFrequency value');
    return undefined;
  }

  return value;
}

function normalizePriority(
  value: SitemapEntry['priority'],
  context: { source: string; pluginId?: string }
) {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    logger.warn({ ...context, value }, 'Rejected invalid sitemap priority value');
    return undefined;
  }

  return value;
}

function normalizeAlternates(
  value: SitemapEntry['alternates'],
  context: { source: string; pluginId?: string }
) {
  const languages = value?.languages;
  if (!languages) {
    return undefined;
  }

  const normalizedLanguages = Object.fromEntries(
    Object.entries(languages).flatMap(([language, href]) => {
      const url = normalizeSitemapUrl(href, context);
      return url ? [[language, url]] : [];
    })
  );

  return Object.keys(normalizedLanguages).length > 0
    ? {
        languages: normalizedLanguages,
      }
    : undefined;
}

function logRejectedSitemapEntry(
  reason: string,
  url: string,
  context: { source: string; pluginId?: string }
) {
  logger.warn({ ...context, reason, url }, 'Rejected sitemap entry');
}
