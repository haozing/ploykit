import { env } from '@/lib/_core/env';
import { locales, type Locale } from '@/i18n/config';

const HASH_OR_QUERY_PATTERN = /[?#]/;
const PARAM_PATTERN = /(^|\/)(:[^/]+|\[[^/\]]+\]|\[\.\.\.[^/\]]+\])(?=\/|$)/;

export function appBaseUrl(): string {
  return env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
}

export function normalizeAppPath(path: string): string {
  if (!path || path === '/') {
    return '/';
  }

  return `/${path}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

export function isDynamicAppPath(path: string): boolean {
  return PARAM_PATTERN.test(normalizeAppPath(path));
}

export function stripLocalePrefix(path: string): string {
  const normalized = normalizeAppPath(path);
  const segment = normalized.split('/')[1];

  return locales.includes(segment as Locale)
    ? normalizeAppPath(normalized.slice(segment.length + 1) || '/')
    : normalized;
}

export function localizedPath(locale: string, path: string): string {
  const normalized = stripLocalePrefix(path);
  return normalized === '/' ? `/${locale}` : `/${locale}${normalized}`;
}

export function absoluteUrl(path: string): string {
  return new URL(normalizeAppPath(path), `${appBaseUrl()}/`).toString();
}

export function localizedAbsoluteUrl(locale: string, path: string): string {
  return absoluteUrl(localizedPath(locale, path));
}

export function languageAlternates(path: string): Record<Locale, string> {
  return Object.fromEntries(
    locales.map((locale) => [locale, localizedAbsoluteUrl(locale, path)])
  ) as Record<Locale, string>;
}

export function normalizeCanonicalPath(input: {
  path: string;
  locale?: string;
  fallbackPath?: string;
}): string | null {
  const raw = input.path || input.fallbackPath;
  const fallback =
    input.fallbackPath && input.fallbackPath !== raw ? input.fallbackPath : undefined;
  if (!raw || HASH_OR_QUERY_PATTERN.test(raw)) {
    return fallback
      ? normalizeCanonicalPath({ ...input, path: fallback, fallbackPath: undefined })
      : null;
  }

  let pathname: string;
  if (raw.startsWith('/')) {
    pathname = raw;
  } else {
    try {
      const url = new URL(raw);
      const base = new URL(appBaseUrl());
      if (url.origin !== base.origin || url.search || url.hash) {
        return fallback
          ? normalizeCanonicalPath({ ...input, path: fallback, fallbackPath: undefined })
          : null;
      }
      pathname = url.pathname;
    } catch {
      return fallback
        ? normalizeCanonicalPath({ ...input, path: fallback, fallbackPath: undefined })
        : null;
    }
  }

  const normalized = normalizeAppPath(pathname);
  if (isDynamicAppPath(normalized)) {
    return fallback
      ? normalizeCanonicalPath({ ...input, path: fallback, fallbackPath: undefined })
      : null;
  }

  return input.locale ? localizedPath(input.locale, normalized) : stripLocalePrefix(normalized);
}

export function normalizeIndexableAppPath(input: {
  path: string;
  locale?: string;
  fallbackPath?: string;
}): string | null {
  return normalizeCanonicalPath(input);
}

export function normalizeCanonicalUrl(input: {
  path: string;
  locale?: string;
  fallbackPath?: string;
}): string | null {
  const path = normalizeCanonicalPath(input);
  return path ? absoluteUrl(path) : null;
}
