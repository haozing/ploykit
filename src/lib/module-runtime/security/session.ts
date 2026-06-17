import type {
  CommercialSubject,
  ModuleUser,
  ModuleWorkspaceRole,
  PermissionValue,
} from '@ploykit/module-sdk';
import type { ProductScopeProfile } from '../scope';

export interface ModuleRuntimeAccessSession {
  user: ModuleUser | null;
  productId?: string;
  environmentId?: string | null;
  workspaceId?: string;
  organizationId?: string;
  userId?: string;
  actorId?: string;
  authKind?: 'anonymous' | 'user' | 'apiKey' | 'system';
  apiKeyId?: string;
  subject?: CommercialSubject;
  authSessionId?: string;
  workspaceRole?: ModuleWorkspaceRole;
  productScopeProfile?: ProductScopeProfile;
  permissions?: readonly PermissionValue[];
  entitlements?: readonly string[];
  plans?: readonly string[];
  plan?: string;
  serviceConnections?: readonly string[];
  features?: readonly string[];
  creditsBalance?: number;
  system?: boolean;
  requestId?: string;
}

export function createAnonymousModuleRuntimeAccessSession(): ModuleRuntimeAccessSession {
  return { user: null, permissions: [] };
}

export function mergeModuleRuntimeAccessSession(
  base: ModuleRuntimeAccessSession,
  override: Partial<ModuleRuntimeAccessSession> | undefined
): ModuleRuntimeAccessSession {
  if (!override) {
    return base;
  }

  return {
    ...base,
    ...override,
    user: override.user === undefined ? base.user : override.user,
  };
}
