import 'server-only';

import type { RuntimeProduct } from '@/lib/plugin-runtime/catalog/runtime-catalog-types';
import { getRuntimeProduct } from '@/lib/plugin-runtime/loader';
import { formatDefaultScopeName, resolveProductScopeProfile } from './product-scope-profile';
import {
  productScopeCreateDisabled,
  productScopeForbidden,
  productScopeNotFound,
  productScopeRequired,
  productScopeRoleRequired,
  productScopeSwitchDisabled,
} from './product-scope-errors';
import {
  DbProductScopeRepository,
  type ProductScopeMembership,
  type ProductScopeRepository,
} from './product-scope-repository.server';
import type {
  CurrentProductScope,
  ProductScopeDescriptor,
  ProductScopeListState,
  ProductScopeProfile,
  ProductScopeRole,
  ProductScopeState,
} from './product-scope-types';

export interface ProductScopeActor {
  userId: string;
  userEmail?: string | null;
  userName?: string | null;
}

export interface ProductScopeServiceOptions {
  repository?: ProductScopeRepository;
  getRuntimeProduct?: (productId: string) => RuntimeProduct | null;
}

export interface DescribeProductScopeInput {
  productId: string;
}

export interface GetCurrentProductScopeInput extends ProductScopeActor {
  productId: string;
  requestedWorkspaceId?: string | null;
}

export interface ListProductScopesInput extends ProductScopeActor {
  productId: string;
}

export interface CreateProductScopeInput extends ProductScopeActor {
  productId: string;
  name: string;
  slug?: string;
}

export interface SwitchProductScopeInput extends ProductScopeActor {
  productId: string;
  workspaceId: string;
}

const DEFAULT_READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] satisfies ProductScopeRole[];

function normalizeId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw productScopeRequired({ label });
  }
  return normalized;
}

function normalizeName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 120) {
    throw productScopeRequired({ field: 'name' });
  }
  return normalized;
}

function displayNameFor(membership: ProductScopeMembership): string {
  const alias = membership.workspace.metadata?.displayAlias;
  return typeof alias === 'string' && alias.trim() ? alias.trim() : membership.workspace.name;
}

function toCurrentProductScope(
  productId: string,
  profile: ProductScopeProfile,
  membership: ProductScopeMembership
): CurrentProductScope {
  return {
    productId,
    workspaceId: membership.workspace.id,
    displayName: displayNameFor(membership),
    label: profile.label,
    pluralLabel: profile.pluralLabel,
    role: membership.member.role as ProductScopeRole,
    mode: profile.mode,
    hidden: profile.mode === 'hidden-default',
    allowCreate: profile.allowCreate,
    allowSwitch: profile.allowSwitch,
    allowMembers: profile.allowMembers,
    resourceScope: {
      type: 'workspace',
      id: membership.workspace.id,
    },
  };
}

function toProductScopeDescriptor(
  product: RuntimeProduct,
  profile: ProductScopeProfile
): ProductScopeDescriptor {
  return {
    productId: product.id,
    productName: product.name,
    profile,
  };
}

function workspaceMetadataFor(input: {
  productId: string;
  profile: ProductScopeProfile;
  userId: string;
  hiddenDefault?: boolean;
}) {
  return {
    productId: input.productId,
    kind:
      input.profile.mode === 'domain-alias'
        ? 'site'
        : input.profile.mode === 'hidden-default'
          ? 'personal'
          : 'team',
    defaultForUserId: input.hiddenDefault ? input.userId : undefined,
    hiddenDefault: input.hiddenDefault || undefined,
  };
}

export class ProductScopeService {
  private readonly repository: ProductScopeRepository;
  private readonly loadRuntimeProduct: (productId: string) => RuntimeProduct | null;

  constructor(options: ProductScopeServiceOptions = {}) {
    this.repository = options.repository ?? new DbProductScopeRepository();
    this.loadRuntimeProduct = options.getRuntimeProduct ?? getRuntimeProduct;
  }

  private getProduct(productId: string): RuntimeProduct {
    const product = this.loadRuntimeProduct(productId);
    return (
      product ?? {
        id: productId,
        name: productId,
        runtimeKey: productId,
        defaultLocale: 'en',
        status: 'active',
      }
    );
  }

  private async getProductWithProfile(productId: string) {
    const product = this.getProduct(productId);
    const profile = resolveProductScopeProfile(product);
    await this.repository.ensureProduct(product);
    return { product, profile };
  }

  private async resolveCurrent(
    input: GetCurrentProductScopeInput,
    product: RuntimeProduct,
    profile: ProductScopeProfile
  ): Promise<CurrentProductScope | null> {
    const productId = product.id;
    const requestedWorkspaceId = input.requestedWorkspaceId?.trim();

    if (requestedWorkspaceId) {
      const requested = await this.repository.getMembership({
        productId,
        userId: input.userId,
        workspaceId: requestedWorkspaceId,
        roles: DEFAULT_READ_ROLES,
      });
      if (!requested) {
        throw productScopeForbidden({ productId, workspaceId: requestedWorkspaceId });
      }
      return toCurrentProductScope(productId, profile, requested);
    }

    const preferredWorkspaceId = await this.repository.getPreferredWorkspaceId({
      productId,
      userId: input.userId,
    });
    if (preferredWorkspaceId) {
      const preferred = await this.repository.getMembership({
        productId,
        userId: input.userId,
        workspaceId: preferredWorkspaceId,
        roles: DEFAULT_READ_ROLES,
      });
      if (preferred) {
        return toCurrentProductScope(productId, profile, preferred);
      }
    }

    const memberships = await this.repository.listMemberships({
      productId,
      userId: input.userId,
      roles: DEFAULT_READ_ROLES,
    });
    const defaultMembership =
      memberships.find(
        ({ workspace }) =>
          workspace.metadata?.defaultForUserId === input.userId ||
          workspace.metadata?.hiddenDefault === true
      ) ?? memberships[0];
    if (defaultMembership) {
      return toCurrentProductScope(productId, profile, defaultMembership);
    }

    if (profile.mode !== 'hidden-default') {
      return null;
    }

    const created = await this.repository.createWorkspace({
      productId,
      userId: input.userId,
      userEmail: input.userEmail,
      name: formatDefaultScopeName({
        template: profile.defaultNameTemplate,
        userName: input.userName,
        userEmail: input.userEmail,
        productName: product.name,
        label: profile.label,
      }),
      metadata: workspaceMetadataFor({
        productId,
        profile,
        userId: input.userId,
        hiddenDefault: true,
      }),
    });
    return toCurrentProductScope(productId, profile, created);
  }

  async describe(input: DescribeProductScopeInput): Promise<ProductScopeDescriptor> {
    const productId = normalizeId(input.productId, 'productId');
    const { product, profile } = await this.getProductWithProfile(productId);
    return toProductScopeDescriptor(product, profile);
  }

  async getState(input: GetCurrentProductScopeInput): Promise<ProductScopeState> {
    const productId = normalizeId(input.productId, 'productId');
    const { product, profile } = await this.getProductWithProfile(productId);
    return {
      product: toProductScopeDescriptor(product, profile),
      current: await this.resolveCurrent(input, product, profile),
    };
  }

  async getCurrent(input: GetCurrentProductScopeInput): Promise<CurrentProductScope | null> {
    return (await this.getState(input)).current;
  }

  async requireCurrent(input: GetCurrentProductScopeInput): Promise<CurrentProductScope> {
    const scope = await this.getCurrent(input);
    if (!scope) {
      throw productScopeRequired({ productId: input.productId });
    }
    return scope;
  }

  async listState(input: ListProductScopesInput): Promise<ProductScopeListState> {
    const productId = normalizeId(input.productId, 'productId');
    const { product, profile } = await this.getProductWithProfile(productId);
    const memberships = await this.repository.listMemberships({
      productId,
      userId: input.userId,
      roles: DEFAULT_READ_ROLES,
    });
    return {
      product: toProductScopeDescriptor(product, profile),
      scopes: memberships.map((membership) =>
        toCurrentProductScope(productId, profile, membership)
      ),
    };
  }

  async list(input: ListProductScopesInput): Promise<CurrentProductScope[]> {
    return (await this.listState(input)).scopes;
  }

  async create(input: CreateProductScopeInput): Promise<CurrentProductScope> {
    const productId = normalizeId(input.productId, 'productId');
    const { profile } = await this.getProductWithProfile(productId);
    if (!profile.allowCreate) {
      throw productScopeCreateDisabled({ productId, mode: profile.mode });
    }
    const created = await this.repository.createWorkspace({
      productId,
      userId: input.userId,
      userEmail: input.userEmail,
      name: normalizeName(input.name),
      slug: input.slug?.trim() || undefined,
      metadata: workspaceMetadataFor({ productId, profile, userId: input.userId }),
    });
    await this.repository.setPreferredWorkspace({
      productId,
      userId: input.userId,
      workspaceId: created.workspace.id,
    });
    return toCurrentProductScope(productId, profile, created);
  }

  async switch(input: SwitchProductScopeInput): Promise<CurrentProductScope> {
    const productId = normalizeId(input.productId, 'productId');
    const { profile } = await this.getProductWithProfile(productId);
    if (!profile.allowSwitch) {
      throw productScopeSwitchDisabled({ productId, mode: profile.mode });
    }
    const workspaceId = normalizeId(input.workspaceId, 'workspaceId');
    const membership = await this.repository.getMembership({
      productId,
      userId: input.userId,
      workspaceId,
      roles: DEFAULT_READ_ROLES,
    });
    if (!membership) {
      throw productScopeNotFound({ productId, workspaceId });
    }
    await this.repository.setPreferredWorkspace({
      productId,
      userId: input.userId,
      workspaceId,
    });
    return toCurrentProductScope(productId, profile, membership);
  }

  async hasRole(input: GetCurrentProductScopeInput & { roles: readonly ProductScopeRole[] }) {
    const scope = await this.getCurrent(input);
    if (!scope) {
      return false;
    }
    return input.roles.includes(scope.role);
  }

  async requireRole(
    input: GetCurrentProductScopeInput & { roles: readonly ProductScopeRole[] }
  ): Promise<CurrentProductScope> {
    const scope = await this.requireCurrent(input);
    if (!input.roles.includes(scope.role)) {
      throw productScopeRoleRequired({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        role: scope.role,
        requiredRoles: input.roles,
      });
    }
    return scope;
  }
}

export const productScopeService = new ProductScopeService();
