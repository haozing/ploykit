import type { ModuleRuntimeAccessSession } from '../security';
import type {
  ProductScopeMembership,
  ProductScopeProduct,
  ProductScopeSnapshot,
  ProductScopeWorkspace,
} from './product-scope-types';

export type ProductScopeResolutionSource =
  | 'adminOverride'
  | 'domainAlias'
  | 'workspaceOverride'
  | 'urlWorkspace'
  | 'sessionDefault'
  | 'productDefault';

export interface ProductScopeOverride {
  productId: string;
  workspaceId?: string;
}

export interface ResolveProductScopeInput {
  snapshot: ProductScopeSnapshot;
  request: Request;
  session?: ModuleRuntimeAccessSession;
  adminOverride?: ProductScopeOverride;
  workspaceOverride?: ProductScopeOverride;
  workspaceSlug?: string;
}

export interface ProductScopeResolution {
  source: ProductScopeResolutionSource;
  product: ProductScopeProduct;
  workspace: ProductScopeWorkspace;
  membership: ProductScopeMembership | null;
}

function activeMembershipFor(
  snapshot: ProductScopeSnapshot,
  userId: string | undefined,
  productId: string,
  workspaceId: string
): ProductScopeMembership | null {
  if (!userId) {
    return null;
  }

  return (
    snapshot.memberships.find(
      (membership) =>
        membership.status === 'active' &&
        membership.userId === userId &&
        membership.productId === productId &&
        membership.workspaceId === workspaceId
    ) ?? null
  );
}

function findProduct(
  snapshot: ProductScopeSnapshot,
  productId: string
): ProductScopeProduct | null {
  return snapshot.products.find((product) => product.id === productId) ?? null;
}

function findWorkspace(
  snapshot: ProductScopeSnapshot,
  productId: string,
  workspaceId: string | undefined
): ProductScopeWorkspace | null {
  if (workspaceId) {
    return (
      snapshot.workspaces.find(
        (workspace) => workspace.productId === productId && workspace.id === workspaceId
      ) ?? null
    );
  }

  const product = findProduct(snapshot, productId);
  if (product?.defaultWorkspaceId) {
    const workspace = snapshot.workspaces.find(
      (candidate) =>
        candidate.productId === productId && candidate.id === product.defaultWorkspaceId
    );
    if (workspace) {
      return workspace;
    }
  }

  return snapshot.workspaces.find((workspace) => workspace.productId === productId) ?? null;
}

function resolutionFrom(
  snapshot: ProductScopeSnapshot,
  source: ProductScopeResolutionSource,
  productId: string,
  workspaceId: string | undefined,
  userId: string | undefined
): ProductScopeResolution | null {
  const product = findProduct(snapshot, productId);
  if (!product) {
    return null;
  }

  const workspace = findWorkspace(snapshot, productId, workspaceId);
  if (!workspace) {
    return null;
  }

  return {
    source,
    product,
    workspace,
    membership: activeMembershipFor(snapshot, userId, product.id, workspace.id),
  };
}

function hostnameFromRequest(request: Request): string {
  const host = request.headers.get('host') ?? new URL(request.url).host;
  return host.split(':')[0]?.toLowerCase() ?? '';
}

function workspaceSlugFromRequest(input: ResolveProductScopeInput): string | undefined {
  if (input.workspaceSlug) {
    return input.workspaceSlug;
  }

  const url = new URL(input.request.url);
  return url.searchParams.get('workspace') ?? undefined;
}

export function resolveProductScope(input: ResolveProductScopeInput): ProductScopeResolution {
  const userId = input.session?.user?.id ?? input.session?.userId;

  if (input.adminOverride) {
    const resolution = resolutionFrom(
      input.snapshot,
      'adminOverride',
      input.adminOverride.productId,
      input.adminOverride.workspaceId,
      userId
    );
    if (resolution) {
      return resolution;
    }
  }

  if (input.workspaceOverride) {
    const resolution = resolutionFrom(
      input.snapshot,
      'workspaceOverride',
      input.workspaceOverride.productId,
      input.workspaceOverride.workspaceId,
      userId
    );
    if (
      resolution &&
      (input.session?.user?.role === 'admin' || resolution.membership?.status === 'active')
    ) {
      return resolution;
    }
  }

  const hostname = hostnameFromRequest(input.request);
  const alias = input.snapshot.domainAliases.find(
    (candidate) => candidate.hostname.toLowerCase() === hostname
  );
  if (alias) {
    const resolution = resolutionFrom(
      input.snapshot,
      'domainAlias',
      alias.productId,
      alias.workspaceId,
      userId
    );
    if (resolution) {
      return resolution;
    }
  }

  const workspaceSlug = workspaceSlugFromRequest(input);
  if (workspaceSlug) {
    const workspace = input.snapshot.workspaces.find(
      (candidate) => candidate.slug === workspaceSlug
    );
    if (workspace) {
      const resolution = resolutionFrom(
        input.snapshot,
        'urlWorkspace',
        workspace.productId,
        workspace.id,
        userId
      );
      if (resolution) {
        return resolution;
      }
    }
  }

  if (input.session?.productId) {
    const resolution = resolutionFrom(
      input.snapshot,
      'sessionDefault',
      input.session.productId,
      input.session.workspaceId,
      userId
    );
    if (resolution) {
      return resolution;
    }
  }

  const product = input.snapshot.products[0];
  if (!product) {
    throw new Error('PRODUCT_SCOPE_PRODUCT_REQUIRED');
  }

  const resolution = resolutionFrom(
    input.snapshot,
    'productDefault',
    product.id,
    product.defaultWorkspaceId,
    userId
  );
  if (!resolution) {
    throw new Error(`PRODUCT_SCOPE_WORKSPACE_REQUIRED: ${product.id}`);
  }

  return resolution;
}

export function applyProductScopeToSession(
  session: ModuleRuntimeAccessSession,
  resolution: ProductScopeResolution
): ModuleRuntimeAccessSession {
  return {
    ...session,
    productId: resolution.product.id,
    workspaceId: resolution.workspace.id,
    productScopeProfile: resolution.product.profile,
    workspaceRole: resolution.membership?.role ?? session.workspaceRole,
  };
}

export function shouldShowProductScopeSwitcher(resolution: ProductScopeResolution): boolean {
  return resolution.product.profile !== 'hidden-default';
}
