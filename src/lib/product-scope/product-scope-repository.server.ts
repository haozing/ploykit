import 'server-only';

import { randomUUID } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, type Database } from '@/lib/db/client.server';
import { appProducts, type NewAppProduct } from '@/lib/db/schema/plugins';
import {
  workspaceMembers,
  workspaces,
  type NewWorkspace,
  type NewWorkspaceMember,
  type Workspace,
  type WorkspaceMember,
  type WorkspaceRole,
} from '@/lib/db/schema/plugin-platform';
import {
  productScopePreferences,
  type NewProductScopePreference,
} from '@/lib/db/schema/product-scope';
import type { RuntimeProduct } from '@/lib/plugin-runtime/catalog/runtime-catalog-types';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface ProductScopeMembership {
  workspace: Workspace;
  member: WorkspaceMember;
}

export interface ProductScopeRepository {
  ensureProduct(product: RuntimeProduct): Promise<void>;
  listMemberships(input: {
    productId: string;
    userId: string;
    roles?: readonly WorkspaceRole[];
  }): Promise<ProductScopeMembership[]>;
  getMembership(input: {
    productId: string;
    userId: string;
    workspaceId: string;
    roles?: readonly WorkspaceRole[];
  }): Promise<ProductScopeMembership | null>;
  getPreferredWorkspaceId(input: { productId: string; userId: string }): Promise<string | null>;
  setPreferredWorkspace(input: {
    productId: string;
    userId: string;
    workspaceId: string;
  }): Promise<void>;
  createWorkspace(input: {
    productId: string;
    userId: string;
    userEmail?: string | null;
    name: string;
    slug?: string;
    metadata: Record<string, unknown>;
  }): Promise<ProductScopeMembership>;
}

export class DbProductScopeRepository implements ProductScopeRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inSystem<T>(fn: (executor: Executor) => Promise<T>): Promise<T> {
    if (this.executor !== db) {
      return fn(this.executor);
    }

    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
      return fn(tx);
    });
  }

  async ensureProduct(product: RuntimeProduct): Promise<void> {
    const now = new Date();
    await this.inSystem(async (executor) => {
      await executor
        .insert(appProducts)
        .values({
          id: product.id,
          name: product.name,
          runtimeKey: product.runtimeKey ?? product.id,
          defaultLocale: product.defaultLocale ?? 'en',
          status: product.status ?? 'active',
          metadata: {
            ...(product.metadata ?? {}),
            ...(product.scopeProfile ? { scopeProfile: product.scopeProfile } : {}),
          },
          updatedAt: now,
        } satisfies NewAppProduct)
        .onConflictDoUpdate({
          target: appProducts.id,
          set: {
            name: sql`excluded.name`,
            runtimeKey: sql`excluded.runtime_key`,
            defaultLocale: sql`excluded.default_locale`,
            status: sql`excluded.status`,
            metadata: sql`excluded.metadata`,
            updatedAt: now,
          },
        });
    });
  }

  async listMemberships(input: {
    productId: string;
    userId: string;
    roles?: readonly WorkspaceRole[];
  }): Promise<ProductScopeMembership[]> {
    return this.inSystem(async (executor) => {
      const conditions = [
        eq(workspaces.productId, input.productId),
        eq(workspaces.status, 'active'),
        eq(workspaceMembers.userId, input.userId),
        eq(workspaceMembers.status, 'active'),
      ];
      if (input.roles?.length) {
        conditions.push(inArray(workspaceMembers.role, input.roles));
      }

      const rows = await executor
        .select({ workspace: workspaces, member: workspaceMembers })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(and(...conditions));

      return rows.map((row) => ({ workspace: row.workspace, member: row.member }));
    });
  }

  async getMembership(input: {
    productId: string;
    userId: string;
    workspaceId: string;
    roles?: readonly WorkspaceRole[];
  }): Promise<ProductScopeMembership | null> {
    return this.inSystem(async (executor) => {
      const conditions = [
        eq(workspaces.id, input.workspaceId),
        eq(workspaces.productId, input.productId),
        eq(workspaces.status, 'active'),
        eq(workspaceMembers.userId, input.userId),
        eq(workspaceMembers.status, 'active'),
      ];
      if (input.roles?.length) {
        conditions.push(inArray(workspaceMembers.role, input.roles));
      }

      const [row] = await executor
        .select({ workspace: workspaces, member: workspaceMembers })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
        .where(and(...conditions))
        .limit(1);

      return row ? { workspace: row.workspace, member: row.member } : null;
    });
  }

  async getPreferredWorkspaceId(input: {
    productId: string;
    userId: string;
  }): Promise<string | null> {
    return this.inSystem(async (executor) => {
      const [row] = await executor
        .select({ workspaceId: productScopePreferences.workspaceId })
        .from(productScopePreferences)
        .where(
          and(
            eq(productScopePreferences.productId, input.productId),
            eq(productScopePreferences.userId, input.userId)
          )
        )
        .limit(1);

      return row?.workspaceId ?? null;
    });
  }

  async setPreferredWorkspace(input: {
    productId: string;
    userId: string;
    workspaceId: string;
  }): Promise<void> {
    const now = new Date();
    await this.inSystem(async (executor) => {
      await executor
        .insert(productScopePreferences)
        .values({
          id: randomUUID(),
          productId: input.productId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          updatedAt: now,
        } satisfies NewProductScopePreference)
        .onConflictDoUpdate({
          target: [productScopePreferences.productId, productScopePreferences.userId],
          set: {
            workspaceId: sql`excluded.workspace_id`,
            updatedAt: now,
          },
        });
    });
  }

  async createWorkspace(input: {
    productId: string;
    userId: string;
    userEmail?: string | null;
    name: string;
    slug?: string;
    metadata: Record<string, unknown>;
  }): Promise<ProductScopeMembership> {
    const now = new Date();
    return this.inSystem(async (executor) => {
      const [workspace] = await executor
        .insert(workspaces)
        .values({
          id: randomUUID(),
          productId: input.productId,
          name: input.name,
          slug: input.slug,
          ownerUserId: input.userId,
          metadata: input.metadata,
          updatedAt: now,
        } satisfies NewWorkspace)
        .returning();

      const [member] = await executor
        .insert(workspaceMembers)
        .values({
          id: randomUUID(),
          workspaceId: workspace.id,
          userId: input.userId,
          role: 'owner',
          status: 'active',
          email: input.userEmail ?? null,
          joinedAt: now,
          updatedAt: now,
        } satisfies NewWorkspaceMember)
        .returning();

      return { workspace, member };
    });
  }
}
