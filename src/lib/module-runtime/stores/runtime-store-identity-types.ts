import type { ModuleWorkspaceRole, PermissionValue } from '@ploykit/module-sdk';
import type { RuntimeStoreScope } from './runtime-store-common-types';

export type RuntimeStoreApiKeyStatus = 'active' | 'rotating' | 'revoked';

export interface RuntimeStoreApiKeyRecord {
  id: string;
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  moduleId?: string | null;
  name: string;
  prefix: string;
  keyHash: string;
  ownerSubjectType?: 'user' | 'workspace' | 'organization' | 'apiKey';
  ownerSubjectId?: string;
  createdBy?: string;
  permissions: readonly PermissionValue[];
  rateLimit?: Record<string, unknown>;
  status: RuntimeStoreApiKeyStatus;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRuntimeStoreApiKeyInput extends RuntimeStoreScope {
  id?: string;
  name: string;
  prefix: string;
  keyHash: string;
  ownerSubjectType?: RuntimeStoreApiKeyRecord['ownerSubjectType'];
  ownerSubjectId?: string;
  createdBy?: string;
  permissions?: readonly PermissionValue[];
  rateLimit?: Record<string, unknown>;
  status?: RuntimeStoreApiKeyStatus;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeStoreMembership {
  id: string;
  productId: string;
  workspaceId: string;
  userId: string;
  role: ModuleWorkspaceRole;
  status: 'active' | 'disabled';
  updatedAt: string;
}

export type RuntimeStoreHostUserRole = 'admin' | 'user';
export type RuntimeStoreHostUserStatus =
  | 'active'
  | 'suspended'
  | 'deleted'
  | 'pending-verification';

export interface RuntimeStoreHostUser {
  id: string;
  email: string;
  passwordHash: string;
  role: RuntimeStoreHostUserRole;
  status: RuntimeStoreHostUserStatus;
  productId: string;
  workspaceId: string;
  workspaceRole: ModuleWorkspaceRole;
  permissions?: readonly PermissionValue[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}
