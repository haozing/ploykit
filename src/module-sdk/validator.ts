import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import { validateActions } from './validator-actions';
import { validateCleanContract } from './validator-clean-contract';
import { validateJobsEventsWebhooks } from './validator-background';
import { validateData } from './validator-data';
import { validatePresentation, validateTheme } from './validator-presentation';
import { validateNavigation, validateProduct } from './validator-product';
import { validateQuality } from './validator-quality';
import { validateI18n, validateResources } from './validator-resources';
import {
  validateCapabilityMetadata,
  validateDependencies,
  validateEgress,
  validateLifecycle,
} from './validator-runtime-metadata';
import { validateSurfaces } from './validator-surfaces';
import {
  ModulePermissionValues,
  ReservedRuntimePermissions,
  SystemOnlyPermissions,
  type PermissionValue,
} from './permissions';
import type { ModuleDefinition } from './types';

const MODULE_ID_PATTERN = /^[a-z0-9-]+$/;
const EXTENSION_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(?:[._-][a-zA-Z0-9]+)*$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
const RESERVED_CONTEXT_KEYS = new Set([
  'module',
  'product',
  'user',
  'auth',
  'scope',
  'workspace',
  'request',
  'response',
  'data',
  'config',
  'secrets',
  'services',
  'connectors',
  'resourceBindings',
  'http',
  'files',
  'artifacts',
  'notifications',
  'runs',
  'jobs',
  'events',
  'webhooks',
  'usage',
  'metering',
  'credits',
  'billing',
  'entitlements',
  'commerce',
  'redeemCodes',
  'ai',
  'rag',
  'apiKeys',
  'rateLimit',
  'risk',
  'cache',
  'audit',
  'extensions',
  'json',
]);
function addDiagnostic(
  diagnostics: ModuleDiagnostic[],
  severity: ModuleDiagnostic['severity'],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  diagnostics.push(createModuleDiagnostic({ code, severity, message, path, fix }));
}

function addError(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  addDiagnostic(diagnostics, 'error', code, message, path, fix);
}

function addWarning(
  diagnostics: ModuleDiagnostic[],
  code: string,
  message: string,
  path: string,
  fix?: string
): void {
  addDiagnostic(diagnostics, 'warning', code, message, path, fix);
}

function validateLocalModulePath(
  diagnostics: ModuleDiagnostic[],
  value: string | undefined,
  path: string,
  label: string,
  required = true
): void {
  if (!value) {
    if (required) {
      addError(diagnostics, 'MODULE_LOCAL_PATH_REQUIRED', `${label} path is required.`, path);
    }
    return;
  }

  if (!LOCAL_PATH_PATTERN.test(value)) {
    addError(
      diagnostics,
      'MODULE_LOCAL_PATH_INVALID',
      `${label} path "${value}" must be a local module path and must not escape the module root.`,
      path,
      'Use a path like "./api/run" or "./pages/HomePage".'
    );
  }
}

function validateContractParts(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  for (const [partName, partPath] of Object.entries(definition.parts ?? {})) {
    validateLocalModulePath(
      diagnostics,
      partPath,
      `parts.${partName}`,
      `Contract ${partName} part`
    );
  }

  const parts = definition.parts;
  if (!parts) {
    return;
  }

  if (parts.data && !definition.data) {
    addError(
      diagnostics,
      'MODULE_PART_DATA_NOT_WIRED',
      'parts.data is declared, but module.ts does not expose a data contract.',
      'parts.data',
      'Import the data definition in module.ts and assign it to data.'
    );
  }

  if (parts.pages && !definition.pages) {
    addError(
      diagnostics,
      'MODULE_PART_PAGES_NOT_WIRED',
      'parts.pages is declared, but module.ts does not expose a pages contract.',
      'parts.pages',
      'Import the page definition in module.ts and assign it to pages.'
    );
  }

  if (parts.apis && !definition.apis) {
    addError(
      diagnostics,
      'MODULE_PART_APIS_NOT_WIRED',
      'parts.apis is declared, but module.ts does not expose an apis contract.',
      'parts.apis',
      'Import the API definition in module.ts and assign it to apis.'
    );
  }

  if (parts.presentation && !definition.presentation) {
    addError(
      diagnostics,
      'MODULE_PART_PRESENTATION_NOT_WIRED',
      'parts.presentation is declared, but module.ts does not expose a presentation contract.',
      'parts.presentation',
      'Import the presentation definition in module.ts and assign it to presentation.'
    );
  }

  if (parts.theme && !definition.theme) {
    addError(
      diagnostics,
      'MODULE_PART_THEME_NOT_WIRED',
      'parts.theme is declared, but module.ts does not expose a theme contract.',
      'parts.theme',
      'Import the theme definition in module.ts and assign it to theme.'
    );
  }

  if (parts.i18n && !definition.i18n) {
    addError(
      diagnostics,
      'MODULE_PART_I18N_NOT_WIRED',
      'parts.i18n is declared, but module.ts does not expose an i18n contract.',
      'parts.i18n',
      'Import the i18n definition in module.ts and assign it to i18n.'
    );
  }
}

function validatePermissionList(
  diagnostics: ModuleDiagnostic[],
  permissions: readonly string[] | undefined,
  path: string
): void {
  for (const [index, permission] of (permissions ?? []).entries()) {
    const itemPath = `${path}.${index}`;
    const permissionValue = permission as PermissionValue;
    if (!ModulePermissionValues.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_PERMISSION_UNKNOWN',
        `Permission "${permission}" is not part of @ploykit/module-sdk.`,
        itemPath
      );
      continue;
    }

    if (SystemOnlyPermissions.has(permissionValue)) {
      addWarning(
        diagnostics,
        'MODULE_SYSTEM_PERMISSION_CONTEXT_BOUND',
        `System permission "${permission}" can only be executed by CLI or host system context.`,
        itemPath,
        'Keep it only when the capability is used outside request runtime.'
      );
    }
    if (ReservedRuntimePermissions.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_PERMISSION_RESERVED_RUNTIME',
        `Permission "${permission}" is reserved and has no request runtime capability.`,
        itemPath,
        'Remove it until the host exposes and guards the matching capability.'
      );
    }
  }
}

function hasTopLevelPermission(definition: ModuleDefinition, permission: PermissionValue): boolean {
  return (definition.permissions ?? []).includes(permission);
}

function validateExtensionKey(
  diagnostics: ModuleDiagnostic[],
  value: string,
  path: string,
  label: string
): void {
  if (!EXTENSION_KEY_PATTERN.test(value)) {
    addError(
      diagnostics,
      'MODULE_EXTENSION_KEY_INVALID',
      `${label} "${value}" must start with a lowercase letter and contain only letters, numbers, dot, underscore, or hyphen separators.`,
      path,
      'Use a key like "executor", "media.ffmpeg", or "crmSync".'
    );
  }
}

function validateModuleExtensions(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const kind = definition.kind ?? 'product';
  if (kind !== 'product' && kind !== 'host-extension') {
    addError(
      diagnostics,
      'MODULE_KIND_INVALID',
      `Module kind "${String(definition.kind)}" is not supported.`,
      'kind',
      'Use "product" or "host-extension".'
    );
  }

  const provides = definition.provides;
  if (kind === 'product' && provides) {
    addError(
      diagnostics,
      'MODULE_PROVIDES_PRODUCT_FORBIDDEN',
      'Product modules must not declare provides; host extension points require kind: "host-extension" and catalog trust.',
      'provides',
      'Move this declaration to a host-extension module.'
    );
  }

  for (const [index, capability] of (definition.uses?.capabilities ?? []).entries()) {
    validateExtensionKey(diagnostics, capability, `uses.capabilities.${index}`, 'Used capability');
  }

  for (const [name, capability] of Object.entries(provides?.capabilities ?? {})) {
    validateExtensionKey(diagnostics, name, `provides.capabilities.${name}`, 'Provided capability');
    if (RESERVED_CONTEXT_KEYS.has(name)) {
      addError(
        diagnostics,
        'MODULE_PROVIDED_CAPABILITY_KEY_RESERVED',
        `Provided capability "${name}" conflicts with a core ModuleContext key.`,
        `provides.capabilities.${name}`,
        'Use a ctx.extensions key such as "executor" or a namespaced key such as "media.ffmpeg".'
      );
    }
    validateLocalModulePath(
      diagnostics,
      capability.provider,
      `provides.capabilities.${name}.provider`,
      `Provided capability "${name}" provider`
    );
    validatePermissionList(
      diagnostics,
      capability.permissions,
      `provides.capabilities.${name}.permissions`
    );
    for (const [permissionIndex, permission] of (capability.permissions ?? []).entries()) {
      if (ModulePermissionValues.has(permission) && !hasTopLevelPermission(definition, permission)) {
        addError(
          diagnostics,
          'MODULE_PROVIDED_CAPABILITY_PERMISSION_NOT_DECLARED',
          `Provided capability "${name}" permission "${permission}" must also be declared in module permissions.`,
          `provides.capabilities.${name}.permissions.${permissionIndex}`,
          'Add the permission to the top-level permissions array.'
        );
      }
    }
  }

  for (const [resourceName, resource] of Object.entries(provides?.adminResources ?? {})) {
    validateExtensionKey(
      diagnostics,
      resourceName,
      `provides.adminResources.${resourceName}`,
      'Admin resource'
    );
    const operations = Object.entries(resource.operations ?? {});
    if (operations.length === 0) {
      addError(
        diagnostics,
        'MODULE_ADMIN_RESOURCE_OPERATIONS_REQUIRED',
        `Admin resource "${resourceName}" must declare at least one operation.`,
        `provides.adminResources.${resourceName}.operations`
      );
    }
    for (const [operationName, operation] of operations) {
      validateExtensionKey(
        diagnostics,
        operationName,
        `provides.adminResources.${resourceName}.operations.${operationName}`,
        'Admin resource operation'
      );
      validateLocalModulePath(
        diagnostics,
        operation.handler,
        `provides.adminResources.${resourceName}.operations.${operationName}.handler`,
        `Admin resource "${resourceName}" operation "${operationName}" handler`
      );
      validatePermissionList(
        diagnostics,
        [operation.permission],
        `provides.adminResources.${resourceName}.operations.${operationName}.permission`
      );
      if (
        ModulePermissionValues.has(operation.permission) &&
        !hasTopLevelPermission(definition, operation.permission)
      ) {
        addError(
          diagnostics,
          'MODULE_ADMIN_RESOURCE_PERMISSION_NOT_DECLARED',
          `Admin resource "${resourceName}" operation "${operationName}" permission "${operation.permission}" must also be declared in module permissions.`,
          `provides.adminResources.${resourceName}.operations.${operationName}.permission`,
          'Add the permission to the top-level permissions array.'
        );
      }
      if (!['read', 'write', 'dangerous'].includes(operation.risk)) {
        addError(
          diagnostics,
          'MODULE_ADMIN_RESOURCE_RISK_INVALID',
          `Admin resource "${resourceName}" operation "${operationName}" risk must be read, write, or dangerous.`,
          `provides.adminResources.${resourceName}.operations.${operationName}.risk`
        );
      }
      if (operation.risk !== 'read' && !operation.auditEvent?.trim()) {
        addError(
          diagnostics,
          'MODULE_ADMIN_RESOURCE_AUDIT_EVENT_REQUIRED',
          `Admin resource "${resourceName}" mutation operation "${operationName}" must declare auditEvent.`,
          `provides.adminResources.${resourceName}.operations.${operationName}.auditEvent`
        );
      }
      if (operation.risk === 'dangerous' && !operation.confirmation) {
        addError(
          diagnostics,
          'MODULE_ADMIN_RESOURCE_CONFIRMATION_REQUIRED',
          `Dangerous admin resource "${resourceName}" operation "${operationName}" must declare confirmation.`,
          `provides.adminResources.${resourceName}.operations.${operationName}.confirmation`
        );
      }
    }
  }
}

export function validateModuleDefinition(definition: ModuleDefinition): ModuleDiagnostic[] {
  const diagnostics: ModuleDiagnostic[] = [];

  if ('contractVersion' in definition) {
    addError(
      diagnostics,
      'MODULE_CONTRACT_VERSION_UNSUPPORTED',
      'Module contractVersion is no longer supported in the single-version contract.',
      'contractVersion',
      'Remove contractVersion; the SDK only accepts the current contract shape.'
    );
  }

  if (!MODULE_ID_PATTERN.test(definition.id)) {
    addError(
      diagnostics,
      'MODULE_ID_INVALID',
      `Module id "${definition.id}" must contain only lowercase letters, numbers, and hyphens.`,
      'id',
      'Use an id like "cms", "shop", or "workflow".'
    );
  }

  if (!definition.name.trim()) {
    addError(diagnostics, 'MODULE_NAME_REQUIRED', 'Module name is required.', 'name');
  }

  if (!SEMVER_PATTERN.test(definition.version)) {
    addError(
      diagnostics,
      'MODULE_VERSION_INVALID',
      `Module version "${definition.version}" must follow semantic versioning.`,
      'version',
      'Use a version like "0.1.0".'
    );
  }

  validatePermissionList(diagnostics, definition.permissions, 'permissions');
  validateModuleExtensions(diagnostics, definition);
  validateContractParts(diagnostics, definition);
  validateData(diagnostics, definition.data);
  validateActions(diagnostics, definition);
  validateSurfaces(diagnostics, definition);
  validateTheme(diagnostics, definition);
  validateNavigation(diagnostics, definition);
  validateProduct(diagnostics, definition);
  validateQuality(diagnostics, definition.quality);
  validateResources(diagnostics, definition);
  validateI18n(diagnostics, definition);
  validatePresentation(diagnostics, definition);
  validateJobsEventsWebhooks(diagnostics, definition);
  validateLifecycle(diagnostics, definition.lifecycle);
  validateDependencies(diagnostics, definition);
  validateCapabilityMetadata(diagnostics, definition);
  validateEgress(diagnostics, definition);
  validateCleanContract(diagnostics, definition);

  return diagnostics;
}
