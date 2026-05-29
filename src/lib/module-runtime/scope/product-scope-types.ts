import type { ModuleWorkspaceRole } from '@ploykit/module-sdk';
import type { ProductScopeProfile } from './product-scope';

export interface ProductScopeProduct {
  id: string;
  name: string;
  profile: ProductScopeProfile;
  defaultWorkspaceId?: string;
}

export interface ProductScopeWorkspace {
  id: string;
  productId: string;
  name: string;
  slug: string;
  domainAliases?: readonly string[];
}

export interface ProductScopeMembership {
  id: string;
  productId: string;
  workspaceId: string;
  userId: string;
  role: ModuleWorkspaceRole;
  status: 'active' | 'disabled';
}

export interface ProductScopeInvite {
  id: string;
  productId: string;
  workspaceId: string;
  email: string;
  role: ModuleWorkspaceRole;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  token: string;
  expiresAt: string;
  invitedBy?: string;
  acceptedBy?: string;
}

export interface ProductScopeDomainAlias {
  hostname: string;
  productId: string;
  workspaceId?: string;
}

export interface ProductScopeSnapshot {
  version: 1;
  products: readonly ProductScopeProduct[];
  workspaces: readonly ProductScopeWorkspace[];
  memberships: readonly ProductScopeMembership[];
  invites: readonly ProductScopeInvite[];
  domainAliases: readonly ProductScopeDomainAlias[];
}
