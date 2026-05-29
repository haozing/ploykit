import type { ModuleRuntimeHost } from './module-runtime-host';

export interface ModuleRuntimeHostSnapshot {
  generatedAt: string;
  buildId?: string;
  mountedCapabilities: {
    modules: number;
    routes: number;
    actions: number;
    surfaces: number;
    navigationItems: number;
    dataModels: number;
    backgroundHandlers: number;
    providerRequirements: number;
    commercialRequirements: number;
    presentationContributions: number;
  };
  providerProfile: {
    services: readonly string[];
    resourceBindings: readonly string[];
    egressOrigins: readonly string[];
  };
  productScope?: {
    productId?: string;
    workspaceId?: string;
    profile?: string;
  };
  routeResolution: readonly {
    moduleId: string;
    kind: string;
    path: string;
    canonicalPath: string;
    auth: string;
    source: string;
    explanation: string;
  }[];
  moduleMapHealth: {
    modules: number;
    entriesWithReleaseMetadata: number;
    entriesMissingReleaseMetadata: readonly string[];
  };
}

export function createModuleRuntimeHostSnapshot(
  host: ModuleRuntimeHost,
  options: {
    productScope?: ModuleRuntimeHostSnapshot['productScope'];
    generatedAt?: string;
  } = {}
): ModuleRuntimeHostSnapshot {
  const releaseEntries = Object.entries(host.artifact.modules).filter(([, entry]) => entry.release);
  const missingReleaseMetadata = Object.entries(host.artifact.modules)
    .filter(([, entry]) => !entry.release)
    .map(([moduleId]) => moduleId)
    .sort();
  const capabilityTotals = host.contracts.reduce(
    (totals, contract) => {
      const summary = contract.capabilitySummary;
      totals.dataModels +=
        summary.data.tables.length +
        summary.data.documents.length +
        summary.data.views.length +
        summary.data.grants.length +
        summary.data.checks.length;
      totals.backgroundHandlers +=
        summary.backgroundHandlers.jobs.length +
        summary.backgroundHandlers.eventPublishes.length +
        summary.backgroundHandlers.eventSubscribes.length +
        summary.backgroundHandlers.webhooks.length;
      totals.providerRequirements +=
        summary.providerRequirements.services.length +
        summary.providerRequirements.resourceBindings.length +
        summary.providerRequirements.egressOrigins.length;
      totals.commercialRequirements +=
        summary.commercialRequirements.meters.length +
        summary.commercialRequirements.routeEntitlements.length +
        summary.commercialRequirements.actionEntitlements.length +
        (summary.commercialRequirements.creditsRequired ? 1 : 0);
      totals.presentationContributions +=
        summary.presentationContribution.navigation +
        summary.presentationContribution.surfaces.length +
        summary.presentationContribution.replaces.length +
        summary.presentationContribution.themeTokens.length;
      return totals;
    },
    {
      dataModels: 0,
      backgroundHandlers: 0,
      providerRequirements: 0,
      commercialRequirements: 0,
      presentationContributions: 0,
    }
  );

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    buildId: host.artifact.buildId,
    mountedCapabilities: {
      modules: host.contracts.length,
      routes: host.routes.length,
      actions: host.actions.list().length,
      surfaces: host.surfaces.list().length,
      navigationItems: host.contracts.reduce((count, contract) => count + contract.navigation.length, 0),
      ...capabilityTotals,
    },
    providerProfile: {
      services: [
        ...new Set(
          host.contracts.flatMap((contract) =>
            Object.entries(contract.serviceRequirements).map(
              ([name, requirement]) => requirement.provider ?? name
            )
          )
        ),
      ].sort(),
      resourceBindings: [
        ...new Set(
          host.contracts.flatMap((contract) =>
            Object.entries(contract.resourceBindings).map(([name, binding]) => `${binding.kind}:${name}`)
          )
        ),
      ].sort(),
      egressOrigins: [...new Set(host.contracts.flatMap((contract) => [...contract.egress]))].sort(),
    },
    productScope: options.productScope,
    routeResolution: host.routes.map((route) => ({
      moduleId: route.moduleId,
      kind: route.kind,
      path: route.path,
      canonicalPath: route.canonicalPath,
      auth: route.auth,
      source: route.source,
      explanation:
        route.source === 'publicAlias'
          ? `${route.path} resolves to ${route.moduleId}:${route.canonicalPath} through a public alias.`
          : `${route.path} resolves to ${route.moduleId}:${route.canonicalPath} through the ${route.kind} route manifest.`,
    })),
    moduleMapHealth: {
      modules: Object.keys(host.artifact.modules).length,
      entriesWithReleaseMetadata: releaseEntries.length,
      entriesMissingReleaseMetadata: missingReleaseMetadata,
    },
  };
}
