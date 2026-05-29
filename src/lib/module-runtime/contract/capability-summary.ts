import { PermissionRegistry } from '@ploykit/module-sdk';
import type {
  ModuleActionDefinition,
  ModuleApiRoute,
  ModuleCommercialRequirement,
  ModulePageRoute,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeCapabilitySummary, RuntimeModuleDefinition } from './types';

function keys(value: Record<string, unknown> | undefined): string[] {
  return Object.keys(value ?? {}).sort();
}

function routeCommercialRequirements(
  routes: readonly ((ModulePageRoute | ModuleApiRoute) & {
    commercial?: ModuleCommercialRequirement;
  })[]
): ModuleCommercialRequirement[] {
  return routes.map((route) => route.commercial).filter(Boolean) as ModuleCommercialRequirement[];
}

function actionCommercialRequirements(
  actions: Readonly<Record<string, ModuleActionDefinition>>
): ModuleCommercialRequirement[] {
  return Object.values(actions)
    .map((action) => action.commercial)
    .filter(Boolean) as ModuleCommercialRequirement[];
}

function collectEntitlements(requirements: readonly ModuleCommercialRequirement[]): string[] {
  return [
    ...new Set(requirements.flatMap((requirement) => [...(requirement.entitlements ?? [])])),
  ].sort();
}

function hasCredits(requirements: readonly ModuleCommercialRequirement[]): boolean {
  return requirements.some((requirement) => Boolean(requirement.credits));
}

export function createModuleCapabilitySummary(
  definition: RuntimeModuleDefinition
): ModuleRuntimeCapabilitySummary {
  const routes = definition.routes ?? {};
  const siteRoutes = routes.site ?? [];
  const dashboardRoutes = routes.dashboard ?? [];
  const adminRoutes = routes.admin ?? [];
  const apiRoutes = routes.api ?? [];
  const actions = definition.actions ?? {};
  const routeCommercial = routeCommercialRequirements([
    ...siteRoutes,
    ...dashboardRoutes,
    ...adminRoutes,
    ...apiRoutes,
  ]);
  const actionCommercial = actionCommercialRequirements(actions);

  return {
    routes: {
      site: siteRoutes.length,
      dashboard: dashboardRoutes.length,
      admin: adminRoutes.length,
      api: apiRoutes.length,
      publicAliases: siteRoutes.reduce((count, route) => count + (route.publicAliases?.length ?? 0), 0),
    },
    data: {
      tables: keys(definition.data?.tables),
      documents: keys(definition.data?.documents),
      views: keys(definition.data?.views),
      grants: keys(definition.data?.grants),
      checks: keys(definition.data?.checks),
      migrationMode: definition.data?.migrations?.mode,
    },
    permissions: [...(definition.permissions ?? [])].map((permission) => {
      const registry = PermissionRegistry[permission];
      return {
        value: permission,
        group: registry?.group ?? 'custom',
        risk: registry?.risk ?? 'medium',
        scope: registry?.scope ?? 'workspace',
        ctxCapability: registry?.ctxCapability,
      };
    }),
    backgroundHandlers: {
      jobs: keys(definition.jobs),
      eventPublishes: [...(definition.events?.publishes ?? [])].sort(),
      eventSubscribes: keys(definition.events?.subscribes),
      webhooks: keys(definition.webhooks),
    },
    providerRequirements: {
      services: Object.entries(definition.serviceRequirements ?? {})
        .map(([name, requirement]) => ({
          name,
          required: Boolean(requirement.required),
          provider: requirement.provider,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      resourceBindings: Object.entries(definition.resourceBindings ?? {})
        .map(([name, binding]) => ({
          name,
          kind: binding.kind,
          required: Boolean(binding.required),
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      egressOrigins: [...(definition.egress ?? [])].sort(),
    },
    commercialRequirements: {
      meters: keys(definition.meters),
      routeEntitlements: collectEntitlements(routeCommercial),
      actionEntitlements: collectEntitlements(actionCommercial),
      creditsRequired: hasCredits([...routeCommercial, ...actionCommercial]),
    },
    presentationContribution: {
      navigation: Array.isArray(definition.navigation)
        ? definition.navigation.length
        : definition.navigation
          ? 1
          : 0,
      surfaces: Object.entries(definition.surfaces ?? {})
        .map(([id, surface]) => ({
          id,
          mode: surface.mode ?? 'append',
          area: surface.placement?.area,
          slot: surface.placement?.slot,
          visibility: surface.visibility?.mode,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      whiteLabel: Boolean(definition.presentation?.whiteLabel),
      replaces: [...(definition.presentation?.replaces ?? [])].sort(),
      themeTokens: keys(definition.theme?.tokens),
      i18nNamespaces: [...(definition.i18n?.namespaces ?? [])].sort(),
    },
  };
}
