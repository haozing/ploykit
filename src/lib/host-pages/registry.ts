import type { PluginHostPageSlotPosition } from '@ploykit/plugin-sdk';
import { normalizeAppPath } from '@/lib/seo/url-policy';

export type HostPagePath =
  | '/'
  | '/about'
  | '/contact'
  | '/pricing'
  | '/privacy'
  | '/terms'
  | '/success';
export type HostPageSlotPosition = PluginHostPageSlotPosition;
export type HostPageContainer = 'fixed' | 'fluid' | 'full';

export interface HostPageDefinition {
  path: HostPagePath;
  slotPrefix: string;
  allowedSlots: readonly HostPageSlotPosition[];
  allowOverride: boolean;
  seoRequired: boolean;
  i18nRequired: boolean;
  defaultContainer: HostPageContainer;
  navActivePath: string;
}

const MAIN_SLOTS = ['main.before', 'main.after', 'main.replace'] as const;
const HERO_AND_MAIN_SLOTS = ['hero.before', 'hero.after', ...MAIN_SLOTS] as const;

export const HOST_PAGE_REGISTRY = {
  '/': {
    path: '/',
    slotPrefix: 'site.home',
    allowedSlots: HERO_AND_MAIN_SLOTS,
    allowOverride: true,
    seoRequired: true,
    i18nRequired: true,
    defaultContainer: 'fixed',
    navActivePath: '/',
  },
  '/about': {
    path: '/about',
    slotPrefix: 'site.about',
    allowedSlots: HERO_AND_MAIN_SLOTS,
    allowOverride: true,
    seoRequired: true,
    i18nRequired: true,
    defaultContainer: 'fixed',
    navActivePath: '/about',
  },
  '/contact': {
    path: '/contact',
    slotPrefix: 'site.contact',
    allowedSlots: HERO_AND_MAIN_SLOTS,
    allowOverride: true,
    seoRequired: true,
    i18nRequired: true,
    defaultContainer: 'fluid',
    navActivePath: '/contact',
  },
  '/pricing': {
    path: '/pricing',
    slotPrefix: 'site.pricing',
    allowedSlots: HERO_AND_MAIN_SLOTS,
    allowOverride: true,
    seoRequired: true,
    i18nRequired: true,
    defaultContainer: 'fixed',
    navActivePath: '/pricing',
  },
  '/privacy': {
    path: '/privacy',
    slotPrefix: 'site.privacy',
    allowedSlots: HERO_AND_MAIN_SLOTS,
    allowOverride: true,
    seoRequired: true,
    i18nRequired: true,
    defaultContainer: 'fixed',
    navActivePath: '/privacy',
  },
  '/terms': {
    path: '/terms',
    slotPrefix: 'site.terms',
    allowedSlots: HERO_AND_MAIN_SLOTS,
    allowOverride: true,
    seoRequired: true,
    i18nRequired: true,
    defaultContainer: 'fixed',
    navActivePath: '/terms',
  },
  '/success': {
    path: '/success',
    slotPrefix: 'site.success',
    allowedSlots: MAIN_SLOTS,
    allowOverride: true,
    seoRequired: true,
    i18nRequired: true,
    defaultContainer: 'fixed',
    navActivePath: '/pricing',
  },
} as const satisfies Record<HostPagePath, HostPageDefinition>;

export function normalizeHostPagePath(pathname: string): HostPagePath | null {
  const normalized = normalizeAppPath(pathname);
  return normalized in HOST_PAGE_REGISTRY ? (normalized as HostPagePath) : null;
}

export function getHostPageDefinition(pathname: string): HostPageDefinition | null {
  const normalized = normalizeHostPagePath(pathname);
  return normalized ? HOST_PAGE_REGISTRY[normalized] : null;
}

export function listHostPageDefinitions(): HostPageDefinition[] {
  return Object.values(HOST_PAGE_REGISTRY);
}

export function hostPageSlotName(
  page: HostPageDefinition,
  position: HostPageSlotPosition
): `${string}:${HostPageSlotPosition}` {
  return `${page.slotPrefix}:${position}`;
}
