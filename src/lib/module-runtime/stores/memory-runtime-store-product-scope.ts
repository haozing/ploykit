import type { ModuleCatalogModuleState } from '../catalog';
import type {
  ProductScopeDomainAlias,
  ProductScopeInvite,
  ProductScopeProduct,
  ProductScopeWorkspace,
} from '../scope/product-scope-types';
import type { RuntimeStore, RuntimeStoreMembership } from './runtime-store-types';

type InMemoryProductScopeRuntimeStore = Pick<
  RuntimeStore,
  | 'upsertCatalogState'
  | 'listCatalogStates'
  | 'upsertMembership'
  | 'listMemberships'
  | 'upsertProductScopeProduct'
  | 'listProductScopeProducts'
  | 'upsertProductScopeWorkspace'
  | 'listProductScopeWorkspaces'
  | 'upsertProductScopeDomainAlias'
  | 'listProductScopeDomainAliases'
  | 'upsertProductScopeInvite'
  | 'listProductScopeInvites'
>;

interface CreateInMemoryProductScopeRuntimeStoreInput {
  now: () => Date;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryProductScopeRuntimeStore({
  now,
}: CreateInMemoryProductScopeRuntimeStoreInput): InMemoryProductScopeRuntimeStore {
  const catalog = new Map<string, ModuleCatalogModuleState>();
  const memberships = new Map<string, RuntimeStoreMembership>();
  const productScopeProducts = new Map<string, ProductScopeProduct>();
  const productScopeWorkspaces = new Map<string, ProductScopeWorkspace>();
  const productScopeAliases = new Map<string, ProductScopeDomainAlias>();
  const productScopeInvites = new Map<string, ProductScopeInvite>();

  return {
    async upsertCatalogState(state: ModuleCatalogModuleState) {
      const key = `${state.productId}:${state.moduleId}`;
      catalog.set(key, state);
      return clone(state);
    },
    async listCatalogStates(query = {}) {
      return [...catalog.values()]
        .filter((state) => !query.productId || state.productId === query.productId)
        .filter((state) => !query.status || state.status === query.status)
        .map((state) => clone(state));
    },
    async upsertMembership(input) {
      const timestamp = input.updatedAt ?? iso(now);
      const membership: RuntimeStoreMembership = {
        id: input.id ?? `${input.productId}:${input.workspaceId}:${input.userId}`,
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
        status: input.status,
        updatedAt: timestamp,
      };
      memberships.set(membership.id, membership);
      return clone(membership);
    },
    async listMemberships(query = {}) {
      return [...memberships.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter((record) => !query.workspaceId || record.workspaceId === query.workspaceId)
        .filter((record) => !query.userId || record.userId === query.userId)
        .map((record) => clone(record));
    },
    async upsertProductScopeProduct(product) {
      productScopeProducts.set(product.id, product);
      return clone(product);
    },
    async listProductScopeProducts(query = {}) {
      return [...productScopeProducts.values()]
        .filter((product) => !query.productId || product.id === query.productId)
        .map((product) => clone(product));
    },
    async upsertProductScopeWorkspace(workspace) {
      productScopeWorkspaces.set(workspace.id, workspace);
      return clone(workspace);
    },
    async listProductScopeWorkspaces(query = {}) {
      return [...productScopeWorkspaces.values()]
        .filter((workspace) => !query.productId || workspace.productId === query.productId)
        .filter((workspace) => !query.workspaceId || workspace.id === query.workspaceId)
        .map((workspace) => clone(workspace));
    },
    async upsertProductScopeDomainAlias(alias) {
      productScopeAliases.set(alias.hostname.toLowerCase(), {
        ...alias,
        hostname: alias.hostname.toLowerCase(),
      });
      return clone(productScopeAliases.get(alias.hostname.toLowerCase())!);
    },
    async listProductScopeDomainAliases(query = {}) {
      const hostname = query.hostname?.toLowerCase();
      return [...productScopeAliases.values()]
        .filter((alias) => !query.productId || alias.productId === query.productId)
        .filter((alias) => !hostname || alias.hostname === hostname)
        .map((alias) => clone(alias));
    },
    async upsertProductScopeInvite(invite) {
      productScopeInvites.set(invite.token, invite);
      return clone(invite);
    },
    async listProductScopeInvites(query = {}) {
      return [...productScopeInvites.values()]
        .filter((invite) => !query.productId || invite.productId === query.productId)
        .filter((invite) => !query.workspaceId || invite.workspaceId === query.workspaceId)
        .filter((invite) => !query.status || invite.status === query.status)
        .filter((invite) => !query.token || invite.token === query.token)
        .map((invite) => clone(invite));
    },
  };
}
