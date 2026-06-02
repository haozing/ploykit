import {
  Permission,
  type ModuleRouteAuth,
  type ModuleSurfaceDefinition,
  type PermissionValue,
} from '@ploykit/module-sdk';

export interface ModuleSurfaceAccessPolicy {
  auth: ModuleRouteAuth;
  permissions: readonly PermissionValue[];
  features?: readonly string[];
  requiredModulePermissions: readonly PermissionValue[];
}

export function resolveModuleSurfaceAccessPolicy(
  definition: ModuleSurfaceDefinition
): ModuleSurfaceAccessPolicy {
  const permissions = new Set(definition.permissions ?? []);
  permissions.add(
    definition.mode === 'replace' ? Permission.SurfaceOverride : Permission.SurfaceContribute
  );

  return {
    auth: resolveSurfaceAuth(definition),
    permissions: resolveSurfaceRuntimePermissions(definition),
    features: resolveSurfaceFeatures(definition),
    requiredModulePermissions: [...permissions],
  };
}

function resolveSurfaceAuth(definition: ModuleSurfaceDefinition): ModuleRouteAuth {
  switch (definition.visibility?.mode) {
    case 'authenticated':
      return 'auth';
    case 'admin':
      return 'admin';
    default:
      return 'public';
  }
}

function resolveSurfaceRuntimePermissions(
  definition: ModuleSurfaceDefinition
): readonly PermissionValue[] {
  if (definition.visibility?.mode === 'permission' && definition.visibility.permission) {
    return [definition.visibility.permission];
  }
  return [];
}

function resolveSurfaceFeatures(
  definition: ModuleSurfaceDefinition
): readonly string[] | undefined {
  return definition.visibility?.mode === 'feature' && definition.visibility.feature
    ? [definition.visibility.feature]
    : undefined;
}
