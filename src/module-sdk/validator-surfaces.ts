import { createModuleDiagnostic, type ModuleDiagnostic } from './diagnostics';
import {
  ModulePermissionValues,
  Permission,
  SystemOnlyPermissions,
  type PermissionValue,
} from './permissions';
import type { ModuleCommercialRequirement, ModuleDefinition } from './types';

const LOCAL_PATH_PATTERN = /^\.\/(?!\.)(?!.*(?:^|\/)\.\.(?:\/|$))/;
const SURFACE_VISIBILITY_MODES = new Set([
  'always',
  'authenticated',
  'admin',
  'permission',
  'feature',
]);
const SURFACE_RESPONSIVE_PLACEMENTS = new Set(['inline', 'stack', 'drawer', 'modal']);
const SURFACE_FALLBACK_BEHAVIORS = new Set(['hide', 'host', 'placeholder']);

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
  }
}

function validateDeclaredPermissionList(
  diagnostics: ModuleDiagnostic[],
  permissions: readonly string[] | undefined,
  modulePermissions: ReadonlySet<string>,
  path: string
): void {
  for (const [index, permission] of (permissions ?? []).entries()) {
    const permissionValue = permission as PermissionValue;
    if (!ModulePermissionValues.has(permissionValue)) {
      continue;
    }
    if (!modulePermissions.has(permissionValue)) {
      addError(
        diagnostics,
        'MODULE_ENTRY_PERMISSION_NOT_DECLARED',
        `Entry permission "${permission}" must also be declared in module permissions.`,
        `${path}.${index}`,
        'Add the permission to the top-level permissions array.'
      );
    }
  }
}

function validateCommercialRequirement(
  diagnostics: ModuleDiagnostic[],
  commercial: ModuleCommercialRequirement | undefined,
  path: string
): void {
  if (!commercial) {
    return;
  }

  for (const [field, values] of [
    ['entitlements', commercial.entitlements ?? []],
    ['plans', commercial.plans ?? []],
  ] as const) {
    for (const [index, value] of values.entries()) {
      if (!value.trim()) {
        addError(
          diagnostics,
          'MODULE_COMMERCIAL_REQUIREMENT_EMPTY',
          `Commercial ${field} entry must not be empty.`,
          `${path}.${field}.${index}`
        );
      }
    }
  }

  if (commercial.meter !== undefined && !commercial.meter.trim()) {
    addError(
      diagnostics,
      'MODULE_COMMERCIAL_METER_EMPTY',
      'Commercial meter must not be empty when declared.',
      `${path}.meter`
    );
  }

  if (commercial.credits && commercial.credits.amount <= 0) {
    addError(
      diagnostics,
      'MODULE_COMMERCIAL_CREDITS_INVALID',
      'Commercial credits amount must be greater than zero.',
      `${path}.credits.amount`
    );
  }
}

export function isHostPageOverrideSurfaceId(surfaceId: string): boolean {
  if (surfaceId.includes(':override')) {
    return true;
  }
  if (!surfaceId.startsWith('host.page:')) {
    return false;
  }
  return surfaceId.split(':').length === 2;
}

export function validateSurfaces(
  diagnostics: ModuleDiagnostic[],
  definition: ModuleDefinition
): void {
  const modulePermissions = new Set(definition.permissions ?? []);
  for (const [surfaceId, surface] of Object.entries(definition.surfaces ?? {})) {
    validateLocalModulePath(
      diagnostics,
      surface.component,
      `surfaces.${surfaceId}.component`,
      'Surface component'
    );
    validateLocalModulePath(
      diagnostics,
      surface.loader,
      `surfaces.${surfaceId}.loader`,
      'Surface loader',
      false
    );
    validatePermissionList(diagnostics, surface.permissions, `surfaces.${surfaceId}.permissions`);
    validateDeclaredPermissionList(
      diagnostics,
      surface.permissions,
      modulePermissions,
      `surfaces.${surfaceId}.permissions`
    );
    validateCommercialRequirement(
      diagnostics,
      surface.commercial,
      `surfaces.${surfaceId}.commercial`
    );

    if (
      surface.placement?.responsive &&
      !SURFACE_RESPONSIVE_PLACEMENTS.has(surface.placement.responsive)
    ) {
      addError(
        diagnostics,
        'MODULE_SURFACE_PLACEMENT_RESPONSIVE_INVALID',
        `Surface responsive placement "${surface.placement.responsive}" is not supported.`,
        `surfaces.${surfaceId}.placement.responsive`,
        `Use one of: ${Array.from(SURFACE_RESPONSIVE_PLACEMENTS).join(', ')}.`
      );
    }

    if (surface.fallback?.behavior && !SURFACE_FALLBACK_BEHAVIORS.has(surface.fallback.behavior)) {
      addError(
        diagnostics,
        'MODULE_SURFACE_FALLBACK_INVALID',
        `Surface fallback behavior "${surface.fallback.behavior}" is not supported.`,
        `surfaces.${surfaceId}.fallback.behavior`,
        `Use one of: ${Array.from(SURFACE_FALLBACK_BEHAVIORS).join(', ')}.`
      );
    }

    if (surface.visibility?.mode && !SURFACE_VISIBILITY_MODES.has(surface.visibility.mode)) {
      addError(
        diagnostics,
        'MODULE_SURFACE_VISIBILITY_INVALID',
        `Surface visibility mode "${surface.visibility.mode}" is not supported.`,
        `surfaces.${surfaceId}.visibility.mode`,
        `Use one of: ${Array.from(SURFACE_VISIBILITY_MODES).join(', ')}.`
      );
    }

    if (surface.visibility?.mode === 'permission' && !surface.visibility.permission) {
      addError(
        diagnostics,
        'MODULE_SURFACE_VISIBILITY_PERMISSION_REQUIRED',
        'Permission-gated surfaces must declare visibility.permission.',
        `surfaces.${surfaceId}.visibility.permission`,
        'Add the permission needed to see this surface.'
      );
    }

    if (surface.visibility?.permission) {
      validatePermissionList(
        diagnostics,
        [surface.visibility.permission],
        `surfaces.${surfaceId}.visibility.permission`
      );
      validateDeclaredPermissionList(
        diagnostics,
        [surface.visibility.permission],
        modulePermissions,
        `surfaces.${surfaceId}.visibility.permission`
      );
    }

    if (surface.visibility?.mode === 'feature' && !surface.visibility.feature?.trim()) {
      addError(
        diagnostics,
        'MODULE_SURFACE_VISIBILITY_FEATURE_REQUIRED',
        'Feature-gated surfaces must declare visibility.feature.',
        `surfaces.${surfaceId}.visibility.feature`,
        'Add a product feature flag or capability key.'
      );
    }

    if (
      surface.mode === 'replace' &&
      !modulePermissions.has(Permission.SurfaceOverride) &&
      !(surface.permissions ?? []).includes(Permission.SurfaceOverride)
    ) {
      addError(
        diagnostics,
        'MODULE_SURFACE_REPLACE_PERMISSION_REQUIRED',
        `Surface "${surfaceId}" uses replace mode but does not declare SurfaceOverride.`,
        `surfaces.${surfaceId}.permissions`,
        'Add Permission.SurfaceOverride at module or surface level.'
      );
    }

    if (isHostPageOverrideSurfaceId(surfaceId) && !surface.loader) {
      addError(
        diagnostics,
        'MODULE_HOST_PAGE_OVERRIDE_LOADER_REQUIRED',
        `Host page override "${surfaceId}" must declare a loader for SEO, shell, cache and i18n metadata.`,
        `surfaces.${surfaceId}.loader`,
        'Add a loader that returns structured page override metadata.'
      );
    }
  }
}
