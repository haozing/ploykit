import { describe, expect, it } from 'vitest';
import type { RuntimeProduct } from '@/lib/plugin-runtime/catalog/runtime-catalog-types';
import type { Workspace, WorkspaceMember, WorkspaceRole } from '@/lib/db/schema/plugin-platform';
import { ProductScopeService } from '../product-scope-service.server';
import type {
  ProductScopeMembership,
  ProductScopeRepository,
} from '../product-scope-repository.server';

class MemoryProductScopeRepository implements ProductScopeRepository {
  products = new Map<string, RuntimeProduct>();
  workspaces = new Map<string, Workspace>();
  members = new Map<string, WorkspaceMember>();
  preferences = new Map<string, string>();
  private sequence = 0;

  async ensureProduct(product: RuntimeProduct): Promise<void> {
    this.products.set(product.id, product);
  }

  async listMemberships(input: {
    productId: string;
    userId: string;
    roles?: readonly WorkspaceRole[];
  }): Promise<ProductScopeMembership[]> {
    return [...this.members.values()]
      .filter((member) => {
        const workspace = this.workspaces.get(member.workspaceId);
        return (
          workspace?.productId === input.productId &&
          workspace.status === 'active' &&
          member.userId === input.userId &&
          member.status === 'active' &&
          (!input.roles?.length || input.roles.includes(member.role as WorkspaceRole))
        );
      })
      .map((member) => ({
        workspace: this.workspaces.get(member.workspaceId)!,
        member,
      }));
  }

  async getMembership(input: {
    productId: string;
    userId: string;
    workspaceId: string;
    roles?: readonly WorkspaceRole[];
  }): Promise<ProductScopeMembership | null> {
    return (
      (await this.listMemberships(input)).find(
        (membership) => membership.workspace.id === input.workspaceId
      ) ?? null
    );
  }

  async getPreferredWorkspaceId(input: {
    productId: string;
    userId: string;
  }): Promise<string | null> {
    return this.preferences.get(`${input.productId}:${input.userId}`) ?? null;
  }

  async setPreferredWorkspace(input: {
    productId: string;
    userId: string;
    workspaceId: string;
  }): Promise<void> {
    this.preferences.set(`${input.productId}:${input.userId}`, input.workspaceId);
  }

  async createWorkspace(input: {
    productId: string;
    userId: string;
    userEmail?: string | null;
    name: string;
    slug?: string;
    metadata: Record<string, unknown>;
  }): Promise<ProductScopeMembership> {
    const now = new Date('2026-05-19T00:00:00Z');
    const id = `workspace-${++this.sequence}`;
    const workspace: Workspace = {
      id,
      productId: input.productId,
      name: input.name,
      slug: input.slug ?? null,
      ownerUserId: input.userId,
      status: 'active',
      metadata: input.metadata,
      createdAt: now,
      updatedAt: now,
    };
    const member: WorkspaceMember = {
      id: `member-${this.sequence}`,
      workspaceId: id,
      userId: input.userId,
      role: 'owner',
      status: 'active',
      email: input.userEmail ?? null,
      joinedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.workspaces.set(workspace.id, workspace);
    this.members.set(member.id, member);
    return { workspace, member };
  }
}

function createService(products: RuntimeProduct[]) {
  const repository = new MemoryProductScopeRepository();
  const byId = new Map(products.map((product) => [product.id, product]));
  const service = new ProductScopeService({
    repository,
    getRuntimeProduct: (productId) => byId.get(productId) ?? null,
  });
  return { service, repository };
}

const explicitWorkspaceProduct: RuntimeProduct = {
  id: 'runlynk',
  name: 'RunLynk',
  runtimeKey: 'runlynk',
  scopeProfile: {
    mode: 'explicit-workspace',
    label: 'Team Space',
    pluralLabel: 'Team Spaces',
    allowCreate: true,
    allowSwitch: true,
    allowMembers: true,
    defaultNameTemplate: '{userName} Team',
  },
};

describe('ProductScopeService', () => {
  it('auto-creates a hidden default scope without exposing switch controls', async () => {
    const { service, repository } = createService([
      {
        id: 'cms',
        name: 'CMS',
        scopeProfile: {
          mode: 'hidden-default',
          label: 'Site',
          pluralLabel: 'Sites',
          allowCreate: false,
          allowSwitch: false,
          allowMembers: false,
          defaultNameTemplate: '{userName} Site',
        },
      },
    ]);

    const state = await service.getState({
      productId: 'cms',
      userId: 'user-1',
      userEmail: 'ada@example.test',
      userName: 'Ada',
    });

    expect(state.product.profile.mode).toBe('hidden-default');
    expect(state.current).toMatchObject({
      productId: 'cms',
      displayName: 'Ada Site',
      hidden: true,
      allowSwitch: false,
      allowMembers: false,
    });
    expect(repository.workspaces.size).toBe(1);

    const again = await service.getCurrent({
      productId: 'cms',
      userId: 'user-1',
      userEmail: 'ada@example.test',
    });
    expect(again?.workspaceId).toBe(state.current?.workspaceId);
    expect(repository.workspaces.size).toBe(1);
  });

  it('keeps explicit workspace products empty until the user creates a scope', async () => {
    const { service } = createService([explicitWorkspaceProduct]);

    await expect(
      service.getState({
        productId: 'runlynk',
        userId: 'user-1',
        userEmail: 'ada@example.test',
      })
    ).resolves.toMatchObject({
      product: {
        productId: 'runlynk',
        profile: {
          mode: 'explicit-workspace',
          allowCreate: true,
          allowSwitch: true,
        },
      },
      current: null,
    });

    const created = await service.create({
      productId: 'runlynk',
      userId: 'user-1',
      userEmail: 'ada@example.test',
      name: 'Core Team',
    });

    expect(created).toMatchObject({
      productId: 'runlynk',
      displayName: 'Core Team',
      hidden: false,
      allowMembers: true,
    });
    await expect(
      service.getCurrent({
        productId: 'runlynk',
        userId: 'user-1',
        userEmail: 'ada@example.test',
      })
    ).resolves.toMatchObject({ workspaceId: created.workspaceId });
  });

  it('resolves requested workspace without changing the preferred scope', async () => {
    const { service } = createService([explicitWorkspaceProduct]);
    const first = await service.create({
      productId: 'runlynk',
      userId: 'user-1',
      userEmail: 'ada@example.test',
      name: 'Core Team',
    });
    const second = await service.create({
      productId: 'runlynk',
      userId: 'user-1',
      userEmail: 'ada@example.test',
      name: 'Workers Team',
    });

    await expect(
      service.getCurrent({
        productId: 'runlynk',
        userId: 'user-1',
        requestedWorkspaceId: first.workspaceId,
      })
    ).resolves.toMatchObject({ workspaceId: first.workspaceId });

    await expect(
      service.getCurrent({
        productId: 'runlynk',
        userId: 'user-1',
      })
    ).resolves.toMatchObject({ workspaceId: second.workspaceId });

    await expect(
      service.getCurrent({
        productId: 'runlynk',
        userId: 'user-1',
        requestedWorkspaceId: second.workspaceId,
      })
    ).resolves.toMatchObject({ workspaceId: second.workspaceId });

    await expect(
      service.getCurrent({
        productId: 'runlynk',
        userId: 'user-1',
      })
    ).resolves.toMatchObject({ workspaceId: second.workspaceId });
  });

  it('does not let one product select another product workspace', async () => {
    const { service } = createService([
      explicitWorkspaceProduct,
      {
        ...explicitWorkspaceProduct,
        id: 'cms',
        name: 'CMS',
      },
    ]);
    const created = await service.create({
      productId: 'runlynk',
      userId: 'user-1',
      userEmail: 'ada@example.test',
      name: 'RunLynk Team',
    });

    await expect(
      service.getCurrent({
        productId: 'cms',
        userId: 'user-1',
        requestedWorkspaceId: created.workspaceId,
      })
    ).rejects.toMatchObject({
      code: 'PRODUCT_SCOPE_FORBIDDEN',
    });
  });
});
