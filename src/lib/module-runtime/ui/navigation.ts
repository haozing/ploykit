export {
  resolveModuleNavigation,
  type ResolvedModuleNavigationItem,
  type ResolveModuleNavigationInput,
} from '../adapters';

import type { ModuleNavigationItem } from '@ploykit/module-sdk';
import { resolveModuleNavigation, type ResolveModuleNavigationInput } from '../adapters';
import type { ModuleRuntimeHost } from '../host';

export type ModuleNavigationGroups = Partial<
  Record<ModuleNavigationItem['location'], ReturnType<typeof resolveModuleNavigation>>
>;

export function resolveModuleNavigationGroups(
  host: ModuleRuntimeHost,
  input: Omit<ResolveModuleNavigationInput, 'location'> = {}
): ModuleNavigationGroups {
  const groups: ModuleNavigationGroups = {};
  for (const location of [
    'site.header',
    'site.footer',
    'dashboard.sidebar',
    'admin.sidebar',
  ] as const) {
    const items = resolveModuleNavigation(host, { ...input, location });
    if (items.length > 0) {
      groups[location] = items;
    }
  }
  return groups;
}
