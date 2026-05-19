import { Permission, PluginError, type PluginProductScopeApi } from '@ploykit/plugin-sdk';
import { ProductScopeError, productScopeService, type ProductScopeService } from '@/lib/product-scope';
import { getCurrentRuntimeProductId } from '@/lib/plugin-runtime/product-context.server';
import { enforceCapabilityPermission, requireUser, type PluginCapabilityScope } from './guards.server';
import type { PluginWorkspaceRole } from '@ploykit/plugin-sdk';

export interface CreatePluginScopeOptions {
  service?: ProductScopeService;
}

function requestedWorkspaceIdFromRequest(request: Request): string | undefined {
  const url = new URL(request.url);
  return (
    url.searchParams.get('workspaceId')?.trim() ||
    url.searchParams.get('scopeId')?.trim() ||
    request.headers.get('x-ploykit-workspace-id')?.trim() ||
    undefined
  );
}

function normalizeRoles(roles: PluginWorkspaceRole | PluginWorkspaceRole[]): PluginWorkspaceRole[] {
  return Array.isArray(roles) ? roles : [roles];
}

function toPluginScopeError(error: unknown, capability: string): never {
  if (error instanceof ProductScopeError) {
    throw new PluginError({
      code: error.code,
      message: error.message,
      statusCode: error.statusCode,
      details: {
        capability,
        ...(error.details ?? {}),
      },
    });
  }

  throw error;
}

export function createPluginScopeCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginScopeOptions = {}
): PluginProductScopeApi {
  const service = options.service ?? productScopeService;

  return {
    async current() {
      enforceCapabilityPermission(scope, Permission.WorkspaceRead, 'ctx.scope.current');
      const user = requireUser(scope, 'ctx.scope.current');
      try {
        const current = await service.getCurrent({
          productId: getCurrentRuntimeProductId(),
          userId: user.id,
          userEmail: user.email,
          requestedWorkspaceId: requestedWorkspaceIdFromRequest(scope.request),
        });
        return current
          ? {
              type: 'workspace',
              id: current.workspaceId,
              productId: current.productId,
              label: current.label,
              pluralLabel: current.pluralLabel,
              displayName: current.displayName,
              role: current.role,
              hidden: current.hidden,
              mode: current.mode,
              resourceScope: current.resourceScope,
            }
          : null;
      } catch (error) {
        toPluginScopeError(error, 'ctx.scope.current');
      }
    },

    async require() {
      enforceCapabilityPermission(scope, Permission.WorkspaceRead, 'ctx.scope.require');
      const user = requireUser(scope, 'ctx.scope.require');
      try {
        const current = await service.requireCurrent({
          productId: getCurrentRuntimeProductId(),
          userId: user.id,
          userEmail: user.email,
          requestedWorkspaceId: requestedWorkspaceIdFromRequest(scope.request),
        });
        return {
          type: 'workspace',
          id: current.workspaceId,
          productId: current.productId,
          label: current.label,
          pluralLabel: current.pluralLabel,
          displayName: current.displayName,
          role: current.role,
          hidden: current.hidden,
          mode: current.mode,
          resourceScope: current.resourceScope,
        };
      } catch (error) {
        toPluginScopeError(error, 'ctx.scope.require');
      }
    },

    async hasRole(roles) {
      enforceCapabilityPermission(scope, Permission.WorkspaceRead, 'ctx.scope.hasRole');
      const user = requireUser(scope, 'ctx.scope.hasRole');
      try {
        return await service.hasRole({
          productId: getCurrentRuntimeProductId(),
          userId: user.id,
          userEmail: user.email,
          requestedWorkspaceId: requestedWorkspaceIdFromRequest(scope.request),
          roles: normalizeRoles(roles),
        });
      } catch (error) {
        toPluginScopeError(error, 'ctx.scope.hasRole');
      }
    },
  };
}

export { requestedWorkspaceIdFromRequest, toPluginScopeError };

