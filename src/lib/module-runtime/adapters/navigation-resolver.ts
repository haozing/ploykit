import type { ModuleNavigationItem } from '@ploykit/module-sdk';
import type { ModuleRuntimeHost } from '../host';
import { canAccessModuleRuntime, type ModuleRuntimeAccessSession } from '../security';

export interface ResolvedModuleNavigationItem {
  moduleId: string;
  item: ModuleNavigationItem;
}

export interface ResolveModuleNavigationInput {
  location?: ModuleNavigationItem['location'];
  session?: ModuleRuntimeAccessSession;
}

export function resolveModuleNavigation(
  host: ModuleRuntimeHost,
  input: ResolveModuleNavigationInput = {}
): ResolvedModuleNavigationItem[] {
  const session = input.session ?? { user: null };
  const items: ResolvedModuleNavigationItem[] = [];

  for (const contract of host.contracts) {
    for (const item of contract.navigation) {
      if (input.location && item.location !== input.location) {
        continue;
      }

      if (
        !canAccessModuleRuntime({
          kind: 'navigation',
          contract,
          session,
          auth: 'public',
          navigation: item,
        })
      ) {
        continue;
      }

      items.push({
        moduleId: contract.id,
        item,
      });
    }
  }

  return items.sort((left, right) => {
    const leftWeight = left.item.weight ?? 0;
    const rightWeight = right.item.weight ?? 0;
    if (leftWeight !== rightWeight) {
      return leftWeight - rightWeight;
    }
    return `${left.moduleId}:${left.item.path}`.localeCompare(
      `${right.moduleId}:${right.item.path}`
    );
  });
}
