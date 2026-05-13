import type { AbstractIntlMessages } from 'next-intl';
import { locales } from './config';

type MessageRecord = Record<string, unknown>;

const SHARED_CLIENT_MESSAGE_PATHS = ['common', 'components.shared.userDropdown'];

const PUBLIC_SITE_MESSAGE_PATHS: Record<string, string[]> = {
  '/': ['home'],
  '/about': ['about'],
  '/contact': ['contact'],
  '/pricing': ['pricing'],
  '/privacy': ['privacy'],
  '/terms': ['terms'],
};

const AUTH_MESSAGE_PATHS: Record<string, string[]> = {
  '/login': ['auth.login', 'common'],
  '/register': ['auth.register', 'common'],
  '/forgot-password': ['auth.forgotPassword', 'common'],
  '/reset-password': ['auth.resetPassword', 'common'],
};

function isRecord(value: unknown): value is MessageRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getPathValue(source: MessageRecord, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current)) {
      return undefined;
    }

    return current[segment];
  }, source);
}

function setPathValue(target: MessageRecord, path: string, value: unknown): void {
  const segments = path.split('.');
  let current = target;

  for (const segment of segments.slice(0, -1)) {
    const existing = current[segment];
    if (!isRecord(existing)) {
      current[segment] = {};
    }

    const next = current[segment];
    if (isRecord(next)) {
      current = next;
    }
  }

  current[segments[segments.length - 1]] = value;
}

function pickMessagePaths(messages: MessageRecord, paths: readonly string[]): MessageRecord {
  const selected: MessageRecord = {};

  for (const path of paths) {
    const value = getPathValue(messages, path);
    if (value !== undefined) {
      setPathValue(selected, path, value);
    }
  }

  return selected;
}

function normalizeRoutePath(pathname: string, locale: string): string {
  const rawPath = pathname || `/${locale}`;
  const withoutQuery = rawPath.split('?')[0] || rawPath;
  const localePattern = new RegExp(`^/(${locales.join('|')})(?=/|$)`);
  const withoutLocale = withoutQuery.replace(localePattern, '') || '/';
  const normalized = `/${withoutLocale}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

  return normalized === '' ? '/' : normalized;
}

function clientMessagePathsForRoute(routePath: string): string[] | null {
  const publicPaths = PUBLIC_SITE_MESSAGE_PATHS[routePath];
  if (publicPaths) {
    return [...SHARED_CLIENT_MESSAGE_PATHS, ...publicPaths];
  }

  const authPaths = AUTH_MESSAGE_PATHS[routePath];
  if (authPaths) {
    return [...new Set([...SHARED_CLIENT_MESSAGE_PATHS, ...authPaths])];
  }

  if (routePath === '/not-found') {
    return [...SHARED_CLIENT_MESSAGE_PATHS, 'errors.404'];
  }

  return null;
}

export function getClientMessagesForPath(
  messages: AbstractIntlMessages,
  pathname: string,
  locale: string
): AbstractIntlMessages {
  const source = messages as MessageRecord;
  const routePath = normalizeRoutePath(pathname, locale);
  const paths = clientMessagePathsForRoute(routePath);

  if (!paths) {
    return messages;
  }

  return pickMessagePaths(source, paths) as AbstractIntlMessages;
}
