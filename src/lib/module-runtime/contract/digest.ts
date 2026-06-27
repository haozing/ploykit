import { createHash } from 'node:crypto';
import type { ModuleRuntimeContract } from './types';

export interface ModuleContractDigest {
  algorithm: 'sha256';
  value: string;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stable);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => key !== 'definition')
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stable(nested)])
    );
  }
  return value;
}

export function hashStableJson(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function createModuleContractDigest(contract: ModuleRuntimeContract): ModuleContractDigest {
  return {
    algorithm: 'sha256',
    value: hashStableJson({
      id: contract.id,
      name: contract.name,
      version: contract.version,
      permissions: contract.permissions,
      pages: contract.pages,
      apis: contract.apis,
      navigation: contract.navigation,
      surfaces: contract.surfaces,
      assets: contract.assets,
      resources: contract.resources,
      data: contract.definition.data,
      i18n: contract.definition.i18n,
      presentation: contract.definition.presentation,
      theme: contract.theme,
      actions: contract.actions,
      jobs: contract.jobs,
      events: contract.events,
      webhooks: contract.webhooks,
      serviceRequirements: contract.serviceRequirements,
      resourceBindings: contract.resourceBindings,
      meters: contract.meters,
      config: contract.config,
      lifecycle: contract.lifecycle,
      egress: contract.egress,
      dependencies: contract.dependencies,
      capabilitySummary: contract.capabilitySummary,
    }),
  };
}
