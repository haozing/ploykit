import {
  PluginError,
  type PermissionValue,
  type PluginResourceScope,
  type PluginUser,
} from '@ploykit/plugin-sdk';
import { AsyncLocalStorage } from 'node:async_hooks';
import { and, eq, inArray } from 'drizzle-orm';
import { withSystemContext } from '@/lib/db/client.server';
import { workspaceMembers, type WorkspaceRole } from '@/lib/db/schema/plugin-platform';
import type { PluginRuntimeContract } from '../contract';

const JSON_NAME_PATTERN = /^[a-zA-Z0-9._:-]+$/;

export interface PluginCapabilityScope {
  contract: PluginRuntimeContract;
  user: PluginUser | null;
  request: Request;
  requestId: string;
  system?: boolean;
  apiKey?: PluginRuntimeApiKeyContext;
}

export interface PluginRuntimeApiKeyContext {
  id: string;
  scope: NormalizedPluginResourceScope;
  permissions: string[];
}

export interface NormalizedPluginResourceScope {
  type: 'user' | 'workspace';
  id: string;
}

export type PluginResourceScopeAccessAction = 'read' | 'write' | 'delete' | 'manage';

const WORKSPACE_READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] satisfies WorkspaceRole[];
const WORKSPACE_WRITE_ROLES = ['owner', 'admin', 'editor'] satisfies WorkspaceRole[];
const WORKSPACE_MANAGE_ROLES = ['owner', 'admin'] satisfies WorkspaceRole[];

type PluginResourceScopeAccessOverride = (
  scope: PluginCapabilityScope,
  resourceScope: NormalizedPluginResourceScope,
  action: PluginResourceScopeAccessAction,
  capability: string,
  requiredRoles?: readonly WorkspaceRole[]
) => Promise<boolean> | boolean;

const workspaceAccessOverrides = new AsyncLocalStorage<
  PluginResourceScopeAccessOverride | undefined
>();

export async function withPluginResourceScopeAccessOverride<T>(
  override: PluginResourceScopeAccessOverride | undefined,
  callback: () => Promise<T>
): Promise<T> {
  return workspaceAccessOverrides.run(override, callback);
}

export function enforceCapabilityPermission(
  scope: PluginCapabilityScope,
  permission: PermissionValue,
  capability: string
): void {
  if (!scope.contract.permissions.includes(permission)) {
    throw new PluginError({
      code: 'PLUGIN_CAPABILITY_PERMISSION_MISSING',
      message: `Plugin "${scope.contract.id}" lacks permission "${permission}" for ${capability}.`,
      statusCode: 403,
      fix: `Add "${permission}" to plugin.ts permissions.`,
      details: {
        pluginId: scope.contract.id,
        capability,
        permission,
      },
    });
  }
}

export function requireUser(scope: PluginCapabilityScope, capability: string): PluginUser {
  if (scope.user) {
    return scope.user;
  }

  throw new PluginError({
    code: 'PLUGIN_CAPABILITY_USER_REQUIRED',
    message: `${capability} requires an authenticated plugin user.`,
    statusCode: 401,
    details: {
      pluginId: scope.contract.id,
      capability,
    },
  });
}

export function requireUserOrSystem(scope: PluginCapabilityScope, capability: string): void {
  if (scope.user || scope.system) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_CAPABILITY_CONTEXT_REQUIRED',
    message: `${capability} requires an authenticated user or system lifecycle context.`,
    statusCode: 401,
    details: {
      pluginId: scope.contract.id,
      capability,
    },
  });
}

export function currentApiKeyId(scope: PluginCapabilityScope): string | undefined {
  return scope.apiKey?.id;
}

export function assertPluginNamespaced(
  scope: PluginCapabilityScope,
  value: string,
  label: string
): void {
  if (value.startsWith(`${scope.contract.id}.`)) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_CAPABILITY_NAMESPACE_INVALID',
    message: `${label} "${value}" must start with "${scope.contract.id}.".`,
    statusCode: 400,
    fix: `Use a namespaced ${label.toLowerCase()} like "${scope.contract.id}.example".`,
    details: {
      pluginId: scope.contract.id,
      value,
      label,
    },
  });
}

export function assertName(value: string, label: string): void {
  if (JSON_NAME_PATTERN.test(value)) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_CAPABILITY_NAME_INVALID',
    message: `${label} "${value}" may only contain letters, numbers, dots, underscores, colons, and hyphens.`,
    statusCode: 400,
    details: {
      value,
      label,
    },
  });
}

export function assertJsonSerializable(value: unknown, label: string): void {
  try {
    JSON.stringify(value);
  } catch {
    throw new PluginError({
      code: 'PLUGIN_CAPABILITY_PAYLOAD_INVALID',
      message: `${label} must be JSON serializable.`,
      statusCode: 400,
      details: {
        label,
      },
    });
  }
}

export function normalizeResourceScope(
  scope: PluginCapabilityScope,
  input: PluginResourceScope | undefined,
  capability: string
): NormalizedPluginResourceScope {
  if (!input && scope.apiKey) {
    return scope.apiKey.scope;
  }

  if (!input) {
    const user = requireUser(scope, capability);
    return assertApiKeyResourceScope(scope, { type: 'user', id: user.id }, capability);
  }

  if (input.type === 'user') {
    const user = requireUser(scope, capability);
    const targetUserId = input.id?.trim() || user.id;

    if (targetUserId !== user.id && !scope.system && user.role !== 'admin') {
      throw new PluginError({
        code: 'PLUGIN_RESOURCE_SCOPE_FORBIDDEN',
        message: `${capability} cannot access another user scope from this context.`,
        statusCode: 403,
        details: {
          pluginId: scope.contract.id,
          capability,
          targetUserId,
        },
      });
    }

    assertName(targetUserId, 'Resource user scope id');
    return assertApiKeyResourceScope(scope, { type: 'user', id: targetUserId }, capability);
  }

  if (input.type === 'workspace') {
    const workspaceId = input.id.trim();
    if (!workspaceId) {
      throw new PluginError({
        code: 'PLUGIN_RESOURCE_SCOPE_INVALID',
        message: `${capability} requires a non-empty workspace scope id.`,
        statusCode: 400,
        details: {
          pluginId: scope.contract.id,
          capability,
        },
      });
    }

    assertName(workspaceId, 'Resource workspace scope id');
    return assertApiKeyResourceScope(scope, { type: 'workspace', id: workspaceId }, capability);
  }

  throw new PluginError({
    code: 'PLUGIN_RESOURCE_SCOPE_INVALID',
    message: `${capability} received an unsupported resource scope.`,
    statusCode: 400,
    details: {
      pluginId: scope.contract.id,
      capability,
      scope: input,
    },
  });
}

export function denormalizeResourceScope(
  scope: NormalizedPluginResourceScope
): PluginResourceScope {
  return scope.type === 'workspace'
    ? { type: 'workspace', id: scope.id }
    : { type: 'user', id: scope.id };
}

function assertApiKeyResourceScope(
  scope: PluginCapabilityScope,
  resourceScope: NormalizedPluginResourceScope,
  capability: string
): NormalizedPluginResourceScope {
  const apiKeyScope = scope.apiKey?.scope;
  if (!apiKeyScope || scope.system) {
    return resourceScope;
  }

  if (apiKeyScope.type === resourceScope.type && apiKeyScope.id === resourceScope.id) {
    return resourceScope;
  }

  throw new PluginError({
    code: 'PLUGIN_API_KEY_SCOPE_FORBIDDEN',
    message: `${capability} cannot access a resource scope outside the API key scope.`,
    statusCode: 403,
    details: {
      pluginId: scope.contract.id,
      capability,
      apiKeyId: scope.apiKey?.id,
      apiKeyScope,
      requestedScope: resourceScope,
    },
  });
}

function requiredWorkspaceRoles(action: PluginResourceScopeAccessAction): readonly WorkspaceRole[] {
  if (action === 'read') {
    return WORKSPACE_READ_ROLES;
  }

  if (action === 'write') {
    return WORKSPACE_WRITE_ROLES;
  }

  return WORKSPACE_MANAGE_ROLES;
}

function uniqueWorkspaceRoles(roles: readonly WorkspaceRole[]): readonly WorkspaceRole[] {
  return [...new Set(roles)];
}

async function assertWorkspaceRoleAccess(
  scope: PluginCapabilityScope,
  resourceScope: NormalizedPluginResourceScope,
  action: PluginResourceScopeAccessAction,
  capability: string,
  roles: readonly WorkspaceRole[]
): Promise<void> {
  const requiredRoles = uniqueWorkspaceRoles(roles);
  const override = workspaceAccessOverrides.getStore();
  if (override && (await override(scope, resourceScope, action, capability, requiredRoles))) {
    return;
  }

  if (scope.system) {
    return;
  }

  const user = requireUser(scope, capability);
  const rows = await withSystemContext((database) =>
    database
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, resourceScope.id),
          eq(workspaceMembers.userId, user.id),
          eq(workspaceMembers.status, 'active'),
          inArray(workspaceMembers.role, requiredRoles)
        )
      )
      .limit(1)
  );

  if (rows.length > 0) {
    return;
  }

  throw new PluginError({
    code: 'PLUGIN_WORKSPACE_SCOPE_FORBIDDEN',
    message: `${capability} cannot ${action} workspace "${resourceScope.id}" from this context.`,
    statusCode: 403,
    details: {
      pluginId: scope.contract.id,
      capability,
      action,
      requestedScope: resourceScope,
      requiredRoles,
      userId: user.id,
    },
  });
}

export async function assertResourceScopeAccess(
  scope: PluginCapabilityScope,
  resourceScope: NormalizedPluginResourceScope,
  action: PluginResourceScopeAccessAction,
  capability: string
): Promise<void> {
  const roles = requiredWorkspaceRoles(action);
  const override = workspaceAccessOverrides.getStore();
  if (override && (await override(scope, resourceScope, action, capability, roles))) {
    return;
  }

  if (scope.system) {
    return;
  }

  const user = requireUser(scope, capability);

  if (resourceScope.type === 'user') {
    if (resourceScope.id === user.id || user.role === 'admin') {
      return;
    }

    throw new PluginError({
      code: 'PLUGIN_RESOURCE_SCOPE_FORBIDDEN',
      message: `${capability} cannot ${action} another user scope from this context.`,
      statusCode: 403,
      details: {
        pluginId: scope.contract.id,
        capability,
        action,
        requestedScope: resourceScope,
      },
    });
  }

  await assertWorkspaceRoleAccess(scope, resourceScope, action, capability, roles);
}

export async function assertResourceScopeWorkspaceRoles(
  scope: PluginCapabilityScope,
  resourceScope: NormalizedPluginResourceScope,
  action: PluginResourceScopeAccessAction,
  requiredRoles: readonly WorkspaceRole[],
  capability: string
): Promise<void> {
  if (resourceScope.type !== 'workspace') {
    await assertResourceScopeAccess(scope, resourceScope, action, capability);
    return;
  }

  await assertWorkspaceRoleAccess(scope, resourceScope, action, capability, requiredRoles);
}
