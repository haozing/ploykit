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

export type RuntimeStoreUserIdentityStatus = 'active' | 'disabled';
export type RuntimeStorePlatformUserStatus =
  | 'active'
  | 'suspended'
  | 'deleted'
  | 'pending-verification';
export type RuntimeStoreWorkspaceMemberStatus = 'active' | 'disabled';
export type RuntimeStoreWorkspaceInviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type RuntimeStoreAuthSessionSubjectType = 'hosted_user' | 'platform_user';
export type RuntimeStoreAuthSessionStatus = 'active' | 'revoked' | 'expired';

export interface RuntimeStoreUserIdentity {
  id: string;
  productId: string;
  environmentId?: string | null;
  userId: string;
  provider: string;
  providerKey: string;
  email?: string;
  status: RuntimeStoreUserIdentityStatus;
  metadata: Record<string, unknown>;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreUserIdentityInput {
  id?: string;
  productId: string;
  environmentId?: string | null;
  userId: string;
  provider: string;
  providerKey: string;
  email?: string;
  status?: RuntimeStoreUserIdentityStatus;
  metadata?: Record<string, unknown>;
  lastUsedAt?: string;
}

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

export interface RuntimeStorePlatformUser {
  id: string;
  email: string;
  displayName?: string;
  status: RuntimeStorePlatformUserStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStorePlatformUserInput {
  id?: string;
  email: string;
  displayName?: string;
  status?: RuntimeStorePlatformUserStatus;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeStoreWorkspaceMember {
  id: string;
  productId: string;
  workspaceId: string;
  platformUserId: string;
  role: string;
  status: RuntimeStoreWorkspaceMemberStatus;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreWorkspaceMemberInput {
  id?: string;
  productId: string;
  workspaceId: string;
  platformUserId: string;
  role: string;
  status?: RuntimeStoreWorkspaceMemberStatus;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeStoreWorkspaceInvite {
  id: string;
  productId: string;
  workspaceId: string;
  email: string;
  role: string;
  status: RuntimeStoreWorkspaceInviteStatus;
  tokenHash: string;
  invitedByPlatformUserId?: string;
  acceptedByPlatformUserId?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertRuntimeStoreWorkspaceInviteInput {
  id?: string;
  productId: string;
  workspaceId: string;
  email: string;
  role: string;
  status?: RuntimeStoreWorkspaceInviteStatus;
  tokenHash: string;
  invitedByPlatformUserId?: string;
  acceptedByPlatformUserId?: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface RuntimeStoreAuthSession {
  id: string;
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  subjectType: RuntimeStoreAuthSessionSubjectType;
  subjectId: string;
  deviceId?: string;
  sessionType: string;
  status: RuntimeStoreAuthSessionStatus;
  createdAt: string;
  lastSeenAt: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  metadata: Record<string, unknown>;
  updatedAt: string;
}

export interface CreateRuntimeStoreAuthSessionInput {
  id?: string;
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  subjectType: RuntimeStoreAuthSessionSubjectType;
  subjectId: string;
  deviceId?: string;
  sessionType?: string;
  status?: RuntimeStoreAuthSessionStatus;
  lastSeenAt?: string;
  expiresAt?: string;
  revokedAt?: string;
  revokedReason?: string;
  metadata?: Record<string, unknown>;
}
