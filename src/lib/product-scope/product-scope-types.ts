import type { WorkspaceRole } from '@/lib/db/schema/plugin-platform';

export const PRODUCT_SCOPE_MODES = [
  'hidden-default',
  'explicit-workspace',
  'domain-alias',
] as const;

export type ProductScopeMode = (typeof PRODUCT_SCOPE_MODES)[number];

export interface ProductScopeProfile {
  mode: ProductScopeMode;
  label: string;
  pluralLabel: string;
  icon?: string;
  routePrefix?: string;
  allowCreate: boolean;
  allowSwitch: boolean;
  allowMembers: boolean;
  defaultNameTemplate?: string;
}

export type ProductScopeRole = WorkspaceRole;

export interface CurrentProductScope {
  productId: string;
  workspaceId: string;
  displayName: string;
  label: string;
  pluralLabel: string;
  role: ProductScopeRole;
  mode: ProductScopeMode;
  hidden: boolean;
  allowCreate: boolean;
  allowSwitch: boolean;
  allowMembers: boolean;
  resourceScope: {
    type: 'workspace';
    id: string;
  };
}

export interface ProductScopeDescriptor {
  productId: string;
  productName: string;
  profile: ProductScopeProfile;
}

export interface ProductScopeState {
  product: ProductScopeDescriptor;
  current: CurrentProductScope | null;
}

export interface ProductScopeListState {
  product: ProductScopeDescriptor;
  scopes: CurrentProductScope[];
}

export interface WorkspaceProductMetadata {
  productId?: string;
  kind?: 'team' | 'site' | 'personal' | 'project';
  displayAlias?: string;
  defaultForUserId?: string;
  hiddenDefault?: boolean;
}
