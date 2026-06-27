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
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.]+)?$/;
const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
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
