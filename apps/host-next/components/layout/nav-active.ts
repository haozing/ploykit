import { localizedPath, type SupportedLanguage } from '@host/lib/i18n';
import type { NavGroup, NavItem } from './types';

function normalizePath(path: string): string {
  return path.replace(/[?#].*$/, '').replace(/\/$/, '') || '/';
}

function isShellRootPath(path: string): boolean {
  return path.endsWith('/admin') || path.endsWith('/dashboard');
}

export function resolveNavHref(lang: SupportedLanguage, item: NavItem): string {
  return item.localized === false ? item.href : localizedPath(lang, item.href);
}

export function isActiveNavHref(active: { href: string } | undefined, href: string): boolean {
  return normalizePath(active?.href ?? '') === normalizePath(href);
}

function activeScore(currentPath: string, href: string): number {
  const normalizedCurrent = normalizePath(currentPath);
  const normalizedHref = normalizePath(href);
  if (normalizedCurrent === normalizedHref) {
    return normalizedHref.length;
  }
  if (isShellRootPath(normalizedHref)) {
    return -1;
  }
  return normalizedCurrent.startsWith(`${normalizedHref}/`) ? normalizedHref.length : -1;
}

export function resolveActiveNavItem(
  lang: SupportedLanguage,
  groups: readonly NavGroup[],
  currentPath: string
): { group: NavGroup; item: NavItem; href: string } | undefined {
  let best: { group: NavGroup; item: NavItem; href: string } | undefined;
  let bestScore = -1;
  for (const group of groups) {
    for (const item of group.items) {
      const href = resolveNavHref(lang, item);
      const score = activeScore(currentPath, href);
      if (score > bestScore) {
        best = { group, item, href };
        bestScore = score;
      }
    }
  }
  return best;
}
