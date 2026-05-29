import { Permission, type ModuleSurfaceDefinition } from '@ploykit/module-sdk';
import type { ModuleDiagnostic } from '@ploykit/module-sdk';

export function isModuleHostPageOverrideSurface(surfaceId: string): boolean {
  if (surfaceId.includes(':override')) {
    return true;
  }
  if (!surfaceId.startsWith('host.page:')) {
    return false;
  }
  return surfaceId.split(':').length === 2;
}

export function validateModuleHostPageOverride(
  surfaceId: string,
  definition: ModuleSurfaceDefinition
): ModuleDiagnostic[] {
  const diagnostics: ModuleDiagnostic[] = [];
  if (!isModuleHostPageOverrideSurface(surfaceId)) {
    return diagnostics;
  }

  if (definition.mode !== 'replace') {
    diagnostics.push({
      severity: 'error',
      code: 'MODULE_HOST_PAGE_OVERRIDE_REPLACE_REQUIRED',
      message: `Host page override "${surfaceId}" must use replace mode.`,
      path: `surfaces.${surfaceId}.mode`,
      fix: 'Set mode: "replace".',
    });
  }

  if (!(definition.permissions ?? []).includes(Permission.SurfaceOverride)) {
    diagnostics.push({
      severity: 'error',
      code: 'MODULE_HOST_PAGE_OVERRIDE_PERMISSION_REQUIRED',
      message: `Host page override "${surfaceId}" must declare SurfaceOverride permission.`,
      path: `surfaces.${surfaceId}.permissions`,
      fix: 'Add Permission.SurfaceOverride.',
    });
  }

  if (!definition.loader) {
    diagnostics.push({
      severity: 'error',
      code: 'MODULE_HOST_PAGE_OVERRIDE_LOADER_REQUIRED',
      message: `Host page override "${surfaceId}" must declare a loader for SEO, shell, cache and i18n metadata.`,
      path: `surfaces.${surfaceId}.loader`,
      fix: 'Add a loader that returns structured page override metadata.',
    });
  }

  return diagnostics;
}
