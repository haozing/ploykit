import type { ModuleNavigationItem } from '@ploykit/module-sdk';
import type { ModuleRuntimeContract, RuntimeModuleDefinition } from './types';
import { createModuleCapabilitySummary } from './capability-summary';

function normalizeNavigation(
  navigation: RuntimeModuleDefinition['navigation']
): readonly ModuleNavigationItem[] {
  if (!navigation) {
    return [];
  }

  if (Array.isArray(navigation)) {
    return [...navigation];
  }

  return [navigation as ModuleNavigationItem];
}

export function normalizeModuleRuntimeContract(
  definition: RuntimeModuleDefinition
): ModuleRuntimeContract {
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    permissions: definition.permissions ?? [],
    pages: definition.pages ?? [],
    apis: definition.apis ?? [],
    navigation: normalizeNavigation(definition.navigation),
    surfaces: definition.surfaces ?? {},
    assets: definition.assets ?? {},
    resources: definition.resources ?? {},
    theme: definition.theme ?? {},
    meters: definition.meters ?? {},
    serviceRequirements: definition.serviceRequirements ?? {},
    resourceBindings: definition.resourceBindings ?? {},
    config: definition.config ?? {},
    actions: definition.actions ?? {},
    jobs: definition.jobs ?? {},
    events: {
      publishes: definition.events?.publishes ?? [],
      subscribes: definition.events?.subscribes ?? {},
    },
    webhooks: definition.webhooks ?? {},
    head: definition.head ?? {},
    lifecycle: definition.lifecycle ?? {},
    dependencies: definition.dependencies ?? {},
    egress: definition.egress ?? [],
    parts: definition.parts ?? {},
    capabilitySummary: createModuleCapabilitySummary(definition),
    definition,
  };
}
