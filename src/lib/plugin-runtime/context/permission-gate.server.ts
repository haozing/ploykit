import { PluginError, type PermissionValue } from '@ploykit/plugin-sdk';
import { auth } from '@/lib/auth/server';
import type { PluginUser } from '@ploykit/plugin-sdk';
import type { PluginRuntimeContract, RuntimeRoute } from '../contract';
import { DbPluginApiKeysRepository } from '../capabilities';

export interface PluginRuntimeAuthResult {
  user: PluginUser | null;
  apiKey?: {
    id: string;
    scope: { type: 'user' | 'workspace'; id: string };
    permissions: string[];
  };
}

const AUTH_WEIGHT = {
  public: 0,
  auth: 1,
  admin: 2,
} as const;

function stricterAuth(
  left: RuntimeRoute['auth'],
  right: RuntimeRoute['auth']
): RuntimeRoute['auth'] {
  return AUTH_WEIGHT[left] >= AUTH_WEIGHT[right] ? left : right;
}

function layoutMinimumAuth(route: RuntimeRoute): RuntimeRoute['auth'] {
  if (route.kind === 'api') {
    return route.auth;
  }

  if (route.layout === 'dashboard-admin') {
    return 'admin';
  }

  if (route.layout === 'dashboard') {
    return 'auth';
  }

  return 'public';
}

export function resolveRuntimeRouteAuth(route: RuntimeRoute): RuntimeRoute['auth'] {
  return stricterAuth(route.auth, layoutMinimumAuth(route));
}

export function enforcePluginPermissions(
  contract: PluginRuntimeContract,
  requiredPermissions: readonly PermissionValue[] = []
): void {
  if (requiredPermissions.length === 0) {
    return;
  }

  const granted = new Set(contract.permissions);
  const missing = requiredPermissions.filter((permission) => !granted.has(permission));

  if (missing.length > 0) {
    throw new PluginError({
      code: 'PLUGIN_PERMISSION_MISSING',
      message: `Plugin "${contract.id}" lacks required permission(s): ${missing.join(', ')}.`,
      statusCode: 403,
      fix: 'Add the missing permission(s) to plugin.ts permissions.',
      details: {
        pluginId: contract.id,
        missing,
      },
    });
  }
}

function routeApiKeyPermissionCandidates(route: RuntimeRoute): string[] {
  if (route.kind !== 'api') {
    return [];
  }

  const method = route.method.toUpperCase();
  return [
    '*',
    `${method}:${route.path}`,
    `${method} ${route.path}`,
    `route:${method}:${route.path}`,
    `route:${route.path}`,
    route.path,
    ...route.permissions,
  ];
}

function enforceApiKeyRoutePermission(
  contract: PluginRuntimeContract,
  route: RuntimeRoute,
  apiKey: { id: string; permissions: string[] }
): void {
  const granted = new Set(apiKey.permissions);
  const candidates = routeApiKeyPermissionCandidates(route);
  const allowed = candidates.some((permission) => granted.has(permission));

  if (allowed) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_API_KEY_PERMISSION_DENIED',
    message: `API key "${apiKey.id}" is not allowed to access this plugin route.`,
    statusCode: 403,
    fix: `Grant one of these API key permissions: ${candidates.join(', ')}.`,
    details: {
      pluginId: contract.id,
      apiKeyId: apiKey.id,
      route: route.kind === 'api' ? `${route.method.toUpperCase()} ${route.path}` : route.path,
      requiredAnyOf: candidates,
    },
  });
}

export async function enforcePluginRuntimeAuth(
  contract: PluginRuntimeContract,
  route: RuntimeRoute,
  requestHeaders: Headers
): Promise<PluginRuntimeAuthResult> {
  const effectiveAuth = resolveRuntimeRouteAuth(route);
  const authorization = requestHeaders.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (route.kind === 'api' && route.machineAuth === 'apiKey' && bearer) {
    const apiKey = await new DbPluginApiKeysRepository().verify(contract.id, bearer);
    if (!apiKey) {
      throw new PluginError({
        code: 'PLUGIN_API_KEY_INVALID',
        message: 'Plugin API key is invalid, expired, or revoked.',
        statusCode: 401,
        details: {
          pluginId: contract.id,
          route: `${route.method.toUpperCase()} ${route.path}`,
        },
      });
    }

    enforceApiKeyRoutePermission(contract, route, {
      id: apiKey.id,
      permissions: apiKey.permissions,
    });

    return {
      user: apiKey.userId ? { id: apiKey.userId, role: 'user' } : null,
      apiKey: {
        id: apiKey.id,
        scope: { type: apiKey.scopeType as 'user' | 'workspace', id: apiKey.scopeId },
        permissions: apiKey.permissions,
      },
    };
  }

  if (effectiveAuth === 'public') {
    if (route.commercial) {
      const session = await auth.api.getSession({ headers: requestHeaders });
      const userId = session?.user?.id;

      if (session?.session && userId) {
        return {
          user: {
            id: userId,
            role: 'user',
            email: session.user.email ?? undefined,
          },
        };
      }
    }

    return { user: null };
  }

  const session = await auth.api.getSession({ headers: requestHeaders });
  const userId = session?.user?.id;

  if (!session?.session || !userId) {
    throw new PluginError({
      code: 'PLUGIN_AUTH_REQUIRED',
      message: 'Authentication required to access this plugin route.',
      statusCode: 401,
    });
  }

  if (effectiveAuth === 'admin') {
    const { isAdmin } = await import('@/lib/auth/permissions');
    const userIsAdmin = await isAdmin(userId);

    if (!userIsAdmin) {
      throw new PluginError({
        code: 'PLUGIN_ADMIN_REQUIRED',
        message: 'Admin access required for this plugin route.',
        statusCode: 403,
        details: {
          userId,
        },
      });
    }
  }

  return {
    user: {
      id: userId,
      role: effectiveAuth === 'admin' ? 'admin' : 'user',
      email: session.user.email ?? undefined,
    },
  };
}
