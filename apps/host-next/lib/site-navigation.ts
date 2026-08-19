import type { NavItem } from '@host/components/layout/types';
import { getPublicFooterItems, getPublicNavItems } from '@host/components/site/site-nav';
import type { SupportedLanguage } from '@host/lib/i18n';
import { getModuleHost } from './module-host';
import { createAnonymousModuleHostSession } from '@/lib/module-runtime/host/session';
import { translateModuleMessage } from '@/lib/module-runtime/i18n';

function mergeNavItems(baseItems: readonly NavItem[], extraItems: readonly NavItem[]): NavItem[] {
  const merged: NavItem[] = [...baseItems];
  const known = new Set(baseItems.map((item) => item.href));

  for (const item of extraItems) {
    if (known.has(item.href)) {
      continue;
    }
    merged.push(item);
    known.add(item.href);
  }

  return merged;
}

function moduleNavigationLabel(
  host: Awaited<ReturnType<typeof getModuleHost>>,
  item: ReturnType<Awaited<ReturnType<typeof getModuleHost>>['resolveNavigation']>[number],
  lang: SupportedLanguage
): string {
  if (item.item.labelKey) {
    return translateModuleMessage(host.runtime, item.moduleId, lang, item.item.labelKey);
  }

  return item.item.fallbackLabel || host.getContract(item.moduleId)?.name || item.moduleId;
}

export async function resolvePublicNavigation(lang: SupportedLanguage): Promise<{
  headerItems: readonly NavItem[];
  footerItems: readonly NavItem[];
}> {
  const host = await getModuleHost();
  const session = createAnonymousModuleHostSession();
  const publicNavItems = getPublicNavItems(lang);
  const publicFooterItems = getPublicFooterItems(lang);
  const headerItems = mergeNavItems(
    publicNavItems,
    host.resolveNavigation('site.header', { session }).map((item) => ({
      href: item.item.path,
      label: moduleNavigationLabel(host, item, lang),
      detail: item.moduleId,
    }))
  );
  const footerItems = mergeNavItems(
    publicFooterItems,
    host.resolveNavigation('site.footer', { session }).map((item) => ({
      href: item.item.path,
      label: moduleNavigationLabel(host, item, lang),
      detail: item.moduleId,
    }))
  );

  return { headerItems, footerItems };
}
