import type { NavItem } from '@host/components/layout/types';
import type { SupportedLanguage } from '@host/lib/i18n';
import { createHostTranslator } from '@host/lib/host-i18n';

const publicNavKeys = [
  ['/', 'home'],
  ['/pricing', 'pricing'],
  ['/docs', 'docs'],
  ['/about', 'about'],
  ['/contact', 'contact'],
] as const;

const publicFooterKeys = [
  ['/privacy', 'privacy'],
  ['/terms', 'terms'],
] as const;

export function getPublicNavItems(lang: SupportedLanguage): readonly NavItem[] {
  const t = createHostTranslator(lang, 'site.nav');
  return publicNavKeys.map(([href, key]) => ({ href, label: t(key) }));
}

export function getPublicFooterItems(lang: SupportedLanguage): readonly NavItem[] {
  const t = createHostTranslator(lang, 'site.nav');
  return publicFooterKeys.map(([href, key]) => ({ href, label: t(key) }));
}

export const publicNavItems: readonly NavItem[] = getPublicNavItems('zh');
export const publicFooterItems: readonly NavItem[] = getPublicFooterItems('zh');
