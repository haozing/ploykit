import {
  SystemOnlyPermissions,
  type ModuleProvidedCapabilityDefinition,
  type PermissionValue,
} from '@ploykit/module-sdk';
import {
  createCapabilityDescriptorRegistry,
  type CapabilityDescriptor,
  type CapabilityDescriptorRegistry,
  type CapabilityDiagnostic,
  type CapabilityGuardInput,
  type CapabilityMountInput,
  type CapabilityProvider,
  type CapabilityProviderRegistry,
} from '../../module-kernel/capability-registry';
import {
  isModuleCatalogStateEnabled,
  resolveCatalogModuleState,
  type ModuleCatalogRuntimeFilter,
} from '../catalog';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeHost } from './module-runtime-host';

interface ModuleCapabilityProviderHooks {
  api?: unknown;
  mount?: (input: CapabilityMountInput) => unknown;
  guard?: (input: CapabilityGuardInput<unknown>) => unknown;
  doctor?: (input: { moduleRoot: string }) => CapabilityDiagnostic[];
  validateContract?: (input: { contract: ModuleRuntimeContract }) => CapabilityDiagnostic[];
}

export interface ResolvedTrustedModuleCapabilities {
  registry?: CapabilityDescriptorRegistry;
  providers?: CapabilityProviderRegistry;
}

function readDefaultExport(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 5; index += 1) {
    if (!current || typeof current !== 'object' || !('default' in current)) {
      return current;
    }
    current = (current as { default: unknown }).default;
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function hasRuntimeHooks(value: unknown): value is ModuleCapabilityProviderHooks {
  return (
    isRecord(value) &&
    (typeof value.mount === 'function' ||
      typeof value.guard === 'function' ||
      typeof value.doctor === 'function' ||
      typeof value.validateContract === 'function' ||
      'api' in value)
  );
}

function asProviderHooks(value: unknown): ModuleCapabilityProviderHooks | null {
  return hasRuntimeHooks(value) ? value : null;
}

function assertTrustedCapabilityPermissions(input: {
  moduleId: string;
  capabilityName: string;
  trust: 'trusted' | 'system';
  permissions: readonly PermissionValue[];
}): void {
  if (input.trust === 'system') {
    return;
  }

  const systemPermission = input.permissions.find((permission) =>
    SystemOnlyPermissions.has(permission)
  );
  if (systemPermission) {
    throw new Error(
      `MODULE_PROVIDED_CAPABILITY_SYSTEM_PERMISSION_FORBIDDEN: ${input.moduleId}.provides.capabilities.${input.capabilityName} requires system-only permission "${systemPermission}" but catalog trust is "${input.trust}".`
    );
  }
}

function createDescriptorFromModuleProvider(input: {
  contract: ModuleRuntimeContract;
  name: string;
  declaration: ModuleProvidedCapabilityDefinition;
  loaded: unknown;
}): { descriptor: CapabilityDescriptor; provider?: CapabilityProvider } {
  const hooks = asProviderHooks(input.loaded);
  const descriptor: CapabilityDescriptor = {
    name: input.name,
    ctxKey: input.name,
    permissions: input.declaration.permissions ?? [],
    mount:
      hooks && typeof hooks.mount === 'function'
        ? (hooks.mount as (mountInput: CapabilityMountInput) => unknown)
        : undefined,
    guard:
      hooks && typeof hooks.guard === 'function'
        ? (hooks.guard as (guardInput: CapabilityGuardInput<unknown>) => unknown)
        : undefined,
    doctor:
      hooks && typeof hooks.doctor === 'function'
        ? (hooks.doctor as (doctorInput: { moduleRoot: string }) => CapabilityDiagnostic[])
        : undefined,
    validateContract:
      hooks && typeof hooks.validateContract === 'function'
        ? (hooks.validateContract as (validateInput: {
            contract: ModuleRuntimeContract;
          }) => CapabilityDiagnostic[])
        : undefined,
  };

  if (descriptor.mount) {
    return { descriptor };
  }

  const provider = hasRuntimeHooks(input.loaded) && hooks ? hooks.api : input.loaded;
  if (provider === undefined) {
    throw new Error(
      `MODULE_PROVIDED_CAPABILITY_PROVIDER_INVALID: ${input.contract.id}.provides.capabilities.${input.name} must export a mount function, an api value, or a static provider.`
    );
  }

  return { descriptor, provider: provider as CapabilityProvider };
}

export async function resolveTrustedModuleCapabilities(input: {
  runtime: ModuleRuntimeHost;
  catalog?: ModuleCatalogRuntimeFilter;
  registry?: CapabilityDescriptorRegistry;
  providers?: CapabilityProviderRegistry;
}): Promise<ResolvedTrustedModuleCapabilities> {
  const registry = createCapabilityDescriptorRegistry();
  let hasDescriptors = false;

  for (const descriptor of input.registry?.list() ?? []) {
    registry.register(descriptor);
    hasDescriptors = true;
  }

  const providers: Record<string, CapabilityProvider | undefined> = {
    ...(input.providers ?? {}),
  };

  for (const contract of input.runtime.contracts) {
    if (contract.definition.kind !== 'host-extension') {
      continue;
    }

    const state = resolveCatalogModuleState(input.catalog, contract.id);
    if (
      !state ||
      !isModuleCatalogStateEnabled(state, input.catalog?.includeMaintenance) ||
      (state.trust !== 'trusted' && state.trust !== 'system')
    ) {
      continue;
    }

    const allowedProvides = new Set(state.allowedProvides ?? []);
    const providedCapabilities = contract.definition.provides?.capabilities ?? {};
    const mapEntry = input.runtime.getMapEntry(contract.id);

    for (const [name, declaration] of Object.entries(providedCapabilities)) {
      if (!allowedProvides.has(`capabilities.${name}`)) {
        continue;
      }

      assertTrustedCapabilityPermissions({
        moduleId: contract.id,
        capabilityName: name,
        trust: state.trust,
        permissions: declaration.permissions ?? [],
      });

      const loader = mapEntry?.capabilities?.[name];
      if (!loader) {
        throw new Error(
          `MODULE_PROVIDED_CAPABILITY_PROVIDER_LOADER_MISSING: ${contract.id}.provides.capabilities.${name} has no module map loader.`
        );
      }

      const loaded = readDefaultExport(await loader());
      const { descriptor, provider } = createDescriptorFromModuleProvider({
        contract,
        name,
        declaration,
        loaded,
      });
      registry.register(descriptor);
      hasDescriptors = true;
      if (provider !== undefined) {
        providers[descriptor.name] = provider;
      }
    }
  }

  return {
    registry: hasDescriptors ? registry : undefined,
    providers: Object.keys(providers).length > 0 ? providers : undefined,
  };
}
