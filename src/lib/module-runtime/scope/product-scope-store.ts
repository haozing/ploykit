import type { ModuleWorkspaceRole } from '@ploykit/module-sdk';
import type {
  ProductScopeInvite,
  ProductScopeMembership,
  ProductScopeProduct,
  ProductScopeSnapshot,
  ProductScopeWorkspace,
} from './product-scope-types';

export interface CreateProductScopeInviteInput {
  productId: string;
  workspaceId: string;
  email: string;
  role: ModuleWorkspaceRole;
  token: string;
  expiresAt: string;
  invitedBy?: string;
}

export interface ProductScopeStore {
  getSnapshot(): Promise<ProductScopeSnapshot>;
  upsertProduct(product: ProductScopeProduct): Promise<void>;
  upsertWorkspace(workspace: ProductScopeWorkspace): Promise<void>;
  upsertMembership(membership: ProductScopeMembership): Promise<void>;
  createInvite(input: CreateProductScopeInviteInput): Promise<ProductScopeInvite>;
  acceptInvite(token: string, userId: string): Promise<ProductScopeMembership | null>;
  revokeInvite(token: string): Promise<ProductScopeInvite | null>;
}

function membershipId(productId: string, workspaceId: string, userId: string): string {
  return `${productId}:${workspaceId}:${userId}`;
}

export function createInMemoryProductScopeStore(
  initial: ProductScopeSnapshot = {
    version: 1,
    products: [],
    workspaces: [],
    memberships: [],
    invites: [],
    domainAliases: [],
  }
): ProductScopeStore {
  const products = new Map(initial.products.map((product) => [product.id, product]));
  const workspaces = new Map(initial.workspaces.map((workspace) => [workspace.id, workspace]));
  const memberships = new Map(initial.memberships.map((item) => [item.id, item]));
  const invites = new Map(initial.invites.map((invite) => [invite.token, invite]));
  const domainAliases = [...initial.domainAliases];

  return {
    async getSnapshot() {
      return {
        version: 1,
        products: [...products.values()],
        workspaces: [...workspaces.values()],
        memberships: [...memberships.values()],
        invites: [...invites.values()],
        domainAliases,
      };
    },
    async upsertProduct(product) {
      products.set(product.id, product);
    },
    async upsertWorkspace(workspace) {
      workspaces.set(workspace.id, workspace);
    },
    async upsertMembership(membership) {
      memberships.set(membership.id, membership);
    },
    async createInvite(input) {
      const invite: ProductScopeInvite = {
        id: `invite:${input.token}`,
        productId: input.productId,
        workspaceId: input.workspaceId,
        email: input.email,
        role: input.role,
        status: 'pending',
        token: input.token,
        expiresAt: input.expiresAt,
        invitedBy: input.invitedBy,
      };
      invites.set(invite.token, invite);
      return invite;
    },
    async acceptInvite(token, userId) {
      const invite = invites.get(token);
      if (!invite || invite.status !== 'pending') {
        return null;
      }

      const now = new Date();
      if (new Date(invite.expiresAt).getTime() < now.getTime()) {
        invites.set(token, { ...invite, status: 'expired' });
        return null;
      }

      const membership: ProductScopeMembership = {
        id: membershipId(invite.productId, invite.workspaceId, userId),
        productId: invite.productId,
        workspaceId: invite.workspaceId,
        userId,
        role: invite.role,
        status: 'active',
      };
      memberships.set(membership.id, membership);
      invites.set(token, { ...invite, status: 'accepted', acceptedBy: userId });
      return membership;
    },
    async revokeInvite(token) {
      const invite = invites.get(token);
      if (!invite || invite.status !== 'pending') {
        return null;
      }
      const revoked = { ...invite, status: 'revoked' as const };
      invites.set(token, revoked);
      return revoked;
    },
  };
}
