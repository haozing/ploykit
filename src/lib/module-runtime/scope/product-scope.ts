import type { ModuleScopeDefinition, ModuleWorkspaceRole } from '@ploykit/module-sdk';
import type { ModuleRuntimeAccessSession } from '../security/session';

export type ProductScopeProfile = 'hidden-default' | 'explicit-workspace' | 'domain-alias';

export type ModuleRuntimeScopeResource =
  | 'user'
  | 'workspace'
  | 'product'
  | 'public-read'
  | 'system';

export interface ModuleRuntimeScopeContext {
  profile: ProductScopeProfile;
  resource: ModuleRuntimeScopeResource;
  productId: string | null;
  workspaceId: string | null;
  userId: string | null;
  actorId: string | null;
  workspaceRole: ModuleWorkspaceRole | null;
}

export interface ResolveModuleRuntimeScopeInput {
  session: ModuleRuntimeAccessSession;
  definition?: ModuleScopeDefinition;
  resource?: ModuleRuntimeScopeResource;
}

export function resolveModuleRuntimeScope(
  input: ResolveModuleRuntimeScopeInput
): ModuleRuntimeScopeContext {
  const session = input.session;
  return {
    profile: session.productScopeProfile ?? 'hidden-default',
    resource: input.resource ?? input.definition?.resource ?? 'workspace',
    productId: session.productId ?? null,
    workspaceId: session.workspaceId ?? null,
    userId: session.user?.id ?? session.userId ?? null,
    actorId: session.actorId ?? session.user?.id ?? session.userId ?? null,
    workspaceRole: session.workspaceRole ?? null,
  };
}
