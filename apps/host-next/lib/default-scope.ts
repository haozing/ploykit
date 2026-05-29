import defaultProductScope from '../../../scope/default.product-scope.json';
import type { ProductScopeSnapshot } from '@/lib/module-runtime/scope/product-scope-types';

export const DEFAULT_PRODUCT_SCOPE_SNAPSHOT = defaultProductScope as ProductScopeSnapshot;

const defaultProduct = DEFAULT_PRODUCT_SCOPE_SNAPSHOT.products[0];
const defaultWorkspace =
  DEFAULT_PRODUCT_SCOPE_SNAPSHOT.workspaces.find(
    (workspace) => workspace.id === defaultProduct?.defaultWorkspaceId
  ) ?? DEFAULT_PRODUCT_SCOPE_SNAPSHOT.workspaces[0];

export const DEFAULT_HOST_PRODUCT_ID = defaultProduct?.id ?? 'demo-product';
export const DEFAULT_HOST_WORKSPACE_ID = defaultWorkspace?.id ?? 'demo-workspace';
export const DEFAULT_HOST_PRODUCT_SCOPE_PROFILE = defaultProduct?.profile ?? 'hidden-default';
export const DEFAULT_HOST_ADMIN_USER_ID = 'demo-admin';
export const DEFAULT_HOST_USER_ID = 'demo-user';

export function defaultProductId(productId: string | null | undefined): string {
  return productId ?? DEFAULT_HOST_PRODUCT_ID;
}

export function defaultWorkspaceId(workspaceId: string | null | undefined): string {
  return workspaceId ?? DEFAULT_HOST_WORKSPACE_ID;
}
