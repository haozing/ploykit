import {
  SystemOnlyPermissions,
  type ModuleActionHandler,
  type ModuleContext,
  type ModuleProvidedAdminResourceOperationDefinition,
  type PermissionValue,
} from '@ploykit/module-sdk';
import {
  isModuleCatalogStateEnabled,
  resolveCatalogModuleState,
  type ModuleCatalogRuntimeFilter,
} from '../catalog';
import type { ModuleRuntimeContract } from '../contract';
import type { ModuleRuntimeHost } from '../host/module-runtime-host';
import type { ModuleHostSession } from '../host/session';
import { resolveModuleEntryLoader } from '../loader';
import { asModuleActionHandler } from '../adapters/module-export';
import type { RuntimeStore } from '../stores/runtime-store-types';

export interface ModuleAdminResourceOperationEntry
  extends ModuleProvidedAdminResourceOperationDefinition {
  moduleId: string;
  resourceName: string;
  operationName: string;
}

export interface ModuleAdminResourceEntry {
  id: string;
  moduleId: string;
  name: string;
  label?: string;
  operations: readonly ModuleAdminResourceOperationEntry[];
}

export interface ModuleAdminResourceRegistry {
  list(): readonly ModuleAdminResourceEntry[];
  get(id: string): ModuleAdminResourceEntry | null;
  getOperation(id: string, operationName: string): ModuleAdminResourceOperationEntry | null;
}

export interface ModuleAdminResourceOperationPublicEntry {
  moduleId: string;
  resourceName: string;
  operationName: string;
  permission: PermissionValue;
  risk: ModuleProvidedAdminResourceOperationDefinition['risk'];
  auditEvent?: string;
  confirmation?: ModuleProvidedAdminResourceOperationDefinition['confirmation'];
}

export interface ModuleAdminResourcePublicEntry {
  id: string;
  moduleId: string;
  name: string;
  label?: string;
  operations: readonly ModuleAdminResourceOperationPublicEntry[];
}

export interface ExecuteModuleAdminResourceOperationInput<TInput = unknown> {
  resourceId: string;
  operationName: string;
  input?: TInput;
  request?: Request;
  session: ModuleHostSession;
  params?: Record<string, string>;
  confirmed?: boolean;
  confirmation?: Record<string, unknown>;
  createContext?: (input: CreateModuleAdminResourceOperationContextInput) => ModuleContext;
}

export interface CreateModuleAdminResourceOperationContextInput {
  host: ModuleRuntimeHost;
  moduleId: string;
  resourceId: string;
  resourceName: string;
  operationName: string;
  request: Request;
  session: ModuleHostSession;
  params: Record<string, string>;
}

export interface ExecuteModuleAdminResourceOperationOptions {
  host: ModuleRuntimeHost;
  store?: Pick<RuntimeStore, 'recordAudit'>;
}

export interface CreateModuleAdminResourceRegistryOptions {
  contracts: readonly ModuleRuntimeContract[];
  catalog?: ModuleCatalogRuntimeFilter;
}

function hasSessionPermission(session: ModuleHostSession, permission: PermissionValue): boolean {
  if (session.system || session.user?.role === 'admin') {
    return true;
  }
  return Array.isArray(session.permissions) && session.permissions.includes(permission);
}

function assertTrustedAdminResourcePermissions(input: {
  moduleId: string;
  resourceName: string;
  operationName: string;
  trust: 'trusted' | 'system';
  permission: PermissionValue;
}): void {
  if (input.trust === 'system') {
    return;
  }
  if (SystemOnlyPermissions.has(input.permission)) {
    throw new Error(
      `MODULE_ADMIN_RESOURCE_SYSTEM_PERMISSION_FORBIDDEN: ${input.moduleId}.provides.adminResources.${input.resourceName}.operations.${input.operationName} requires system-only permission "${input.permission}" but catalog trust is "${input.trust}".`
    );
  }
}

export function assertAdminResourceOperationAllowed(
  session: ModuleHostSession,
  operation: ModuleAdminResourceOperationEntry,
  input: {
    confirmed?: boolean;
    confirmation?: Record<string, unknown>;
  } = {}
): void {
  if (!session.system && session.user?.role !== 'admin') {
    throw new Error('ADMIN_RESOURCE_OPERATION_FORBIDDEN');
  }
  if (!hasSessionPermission(session, operation.permission)) {
    throw new Error(
      `ADMIN_RESOURCE_OPERATION_PERMISSION_DENIED: ${operation.moduleId}.${operation.resourceName}.${operation.operationName} requires "${operation.permission}".`
    );
  }
  if (operation.risk === 'dangerous') {
    const expected = operation.confirmation;
    if (!expected || input.confirmation?.[expected.field] !== expected.value) {
      throw new Error(
        `ADMIN_RESOURCE_OPERATION_CONFIRMATION_REQUIRED: ${operation.moduleId}.${operation.resourceName}.${operation.operationName}`
      );
    }
  }
}

export function createModuleAdminResourceRegistry(
  options: CreateModuleAdminResourceRegistryOptions
): ModuleAdminResourceRegistry {
  const entries: ModuleAdminResourceEntry[] = [];

  for (const contract of options.contracts) {
    if (contract.definition.kind !== 'host-extension') {
      continue;
    }

    const state = resolveCatalogModuleState(options.catalog, contract.id);
    const trust = state?.trust;
    if (
      !state ||
      !isModuleCatalogStateEnabled(state, options.catalog?.includeMaintenance) ||
      (trust !== 'trusted' && trust !== 'system')
    ) {
      continue;
    }

    const allowedProvides = new Set(state.allowedProvides ?? []);
    for (const [resourceName, resource] of Object.entries(
      contract.definition.provides?.adminResources ?? {}
    )) {
      if (!allowedProvides.has(`adminResources.${resourceName}`)) {
        continue;
      }

      const operations = Object.entries(resource.operations).map(
        ([operationName, operation]) => {
          assertTrustedAdminResourcePermissions({
            moduleId: contract.id,
            resourceName,
            operationName,
            trust,
            permission: operation.permission,
          });
          return {
            ...operation,
            moduleId: contract.id,
            resourceName,
            operationName,
          };
        }
      );

      entries.push({
        id: `${contract.id}.${resourceName}`,
        moduleId: contract.id,
        name: resourceName,
        label: resource.label,
        operations,
      });
    }
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  return {
    list() {
      return entries;
    },
    get(id) {
      return byId.get(id) ?? null;
    },
    getOperation(id, operationName) {
      return byId.get(id)?.operations.find((operation) => operation.operationName === operationName) ?? null;
    },
  };
}

function createSyntheticAdminResourceRequest(resourceId: string, operationName: string): Request {
  return new Request(`http://localhost/admin/resources/${resourceId}/${operationName}`, {
    method: 'POST',
  });
}

export function toPublicAdminResourceEntry(
  resource: ModuleAdminResourceEntry
): ModuleAdminResourcePublicEntry {
  return {
    id: resource.id,
    moduleId: resource.moduleId,
    name: resource.name,
    label: resource.label,
    operations: resource.operations.map((operation) => ({
      moduleId: operation.moduleId,
      resourceName: operation.resourceName,
      operationName: operation.operationName,
      permission: operation.permission,
      risk: operation.risk,
      auditEvent: operation.auditEvent,
      confirmation: operation.confirmation,
    })),
  };
}

async function recordAdminResourceAudit(
  options: ExecuteModuleAdminResourceOperationOptions,
  input: ExecuteModuleAdminResourceOperationInput<unknown>,
  resource: ModuleAdminResourceEntry,
  operation: ModuleAdminResourceOperationEntry,
  outcome: 'success' | 'denied',
  reason?: string
): Promise<void> {
  if (operation.risk === 'read') {
    return;
  }

  await options.store?.recordAudit({
    productId: input.session.productId ?? 'unknown',
    environmentId: input.session.environmentId,
    workspaceId: input.session.workspaceId,
    moduleId: resource.moduleId,
    actorId: input.session.actorId ?? input.session.user?.id,
    type:
      outcome === 'success'
        ? operation.auditEvent ?? `admin.resource.${resource.name}.${operation.operationName}`
        : 'admin.resource.denied',
    metadata: {
      resourceId: input.resourceId,
      resourceName: resource.name,
      operationName: operation.operationName,
      risk: operation.risk,
      outcome,
      ...(reason ? { reason } : {}),
    },
  });
}

export async function executeModuleAdminResourceOperation<TInput = unknown, TResult = unknown>(
  options: ExecuteModuleAdminResourceOperationOptions,
  input: ExecuteModuleAdminResourceOperationInput<TInput>
): Promise<TResult> {
  const resource = options.host.adminResources.get(input.resourceId);
  if (!resource) {
    throw new Error(`ADMIN_RESOURCE_NOT_FOUND: ${input.resourceId}`);
  }

  const operation = resource.operations.find(
    (candidate) => candidate.operationName === input.operationName
  );
  if (!operation) {
    throw new Error(`ADMIN_RESOURCE_OPERATION_NOT_FOUND: ${input.resourceId}.${input.operationName}`);
  }

  try {
    assertAdminResourceOperationAllowed(input.session, operation, {
      confirmed: input.confirmed,
      confirmation: input.confirmation,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.split(':')[0] : String(error);
    await recordAdminResourceAudit(
      options,
      input as ExecuteModuleAdminResourceOperationInput<unknown>,
      resource,
      operation,
      'denied',
      reason
    );
    throw error;
  }

  const entry = options.host.getMapEntry(resource.moduleId);
  const contract = options.host.getContract(resource.moduleId);
  if (!entry || !contract) {
    throw new Error(`ADMIN_RESOURCE_RUNTIME_ENTRY_MISSING: ${input.resourceId}`);
  }

  const loader = resolveModuleEntryLoader(entry, 'admin', operation.handler);
  if (!loader) {
    throw new Error(
      `ADMIN_RESOURCE_OPERATION_HANDLER_MISSING: ${input.resourceId}.${input.operationName}`
    );
  }

  const handler = asModuleActionHandler(await loader()) as ModuleActionHandler<
    ModuleContext,
    TInput | undefined,
    TResult
  > | null;
  if (!handler) {
    throw new Error(
      `ADMIN_RESOURCE_OPERATION_INVALID_EXPORT: ${input.resourceId}.${input.operationName}`
    );
  }

  const request =
    input.request ?? createSyntheticAdminResourceRequest(input.resourceId, input.operationName);
  const params = input.params ?? {};
  const context = input.createContext?.({
    host: options.host,
    moduleId: resource.moduleId,
    resourceId: input.resourceId,
    resourceName: resource.name,
    operationName: input.operationName,
    request,
    session: input.session,
    params,
  });
  if (!context) {
    throw new Error(
      `ADMIN_RESOURCE_OPERATION_CONTEXT_REQUIRED: ${input.resourceId}.${input.operationName}`
    );
  }

  const result = await handler(context, input.input);

  await recordAdminResourceAudit(
    options,
    input as ExecuteModuleAdminResourceOperationInput<unknown>,
    resource,
    operation,
    'success'
  );

  return result;
}
