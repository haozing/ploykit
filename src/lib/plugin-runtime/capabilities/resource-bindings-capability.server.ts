import { randomUUID } from 'crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  Permission,
  PluginError,
  type PluginResourceBindingRecord,
  type PluginResourceBindingStatus,
  type PluginResourceBindings,
  type PluginWorkspaceRole,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginResourceBindings,
  type NewPluginResourceBinding,
  type PluginResourceBinding,
} from '@/lib/db/schema/plugin-platform';
import {
  assertJsonSerializable,
  assertName,
  assertResourceScopeAccess,
  assertResourceScopeWorkspaceRoles,
  denormalizeResourceScope,
  enforceCapabilityPermission,
  normalizeResourceScope,
  requireUser,
  type NormalizedPluginResourceScope,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';
import type { AuditPort } from '@/lib/audit/audit-port.server';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

export interface PluginResourceBindingsScope {
  pluginId: string;
  userId: string;
}

export interface PluginResourceBindingsRepository {
  get(
    scope: PluginResourceBindingsScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      resourceType: string;
      resourceId?: string;
      status?: PluginResourceBindingStatus;
    }
  ): Promise<PluginResourceBinding | null>;
  list(
    scope: PluginResourceBindingsScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      resourceType?: string;
      status?: PluginResourceBindingStatus;
      limit: number;
      offset: number;
    }
  ): Promise<PluginResourceBinding[]>;
  upsert(
    scope: PluginResourceBindingsScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      resourceType: string;
      resourceId: string;
      displayName?: string;
      metadata: Record<string, unknown>;
      status: Extract<PluginResourceBindingStatus, 'active' | 'disabled'>;
      cardinality: 'one' | 'many';
    }
  ): Promise<PluginResourceBinding>;
  getById(scope: PluginResourceBindingsScope, id: string): Promise<PluginResourceBinding | null>;
  archive(scope: PluginResourceBindingsScope, id: string): Promise<PluginResourceBinding>;
}

export interface CreatePluginResourceBindingsOptions {
  repository?: PluginResourceBindingsRepository;
  auditPort?: AuditPort;
}

const VALID_STATUS = new Set<PluginResourceBindingStatus>(['active', 'archived', 'disabled']);
const DEFAULT_READ_ROLES = ['owner', 'admin', 'editor', 'viewer'] satisfies PluginWorkspaceRole[];
const DEFAULT_WRITE_ROLES = ['owner', 'admin'] satisfies PluginWorkspaceRole[];

function resolveScope(scope: PluginCapabilityScope, capability: string): PluginResourceBindingsScope {
  const user = requireUser(scope, capability);
  return { pluginId: scope.contract.id, userId: user.id };
}

function normalizeResourceType(value: string): string {
  const normalized = value.trim();
  assertName(normalized, 'Resource binding type');
  return normalized;
}

function normalizeResourceId(value: string): string {
  const normalized = value.trim();
  assertName(normalized, 'Resource binding id');
  return normalized;
}

function normalizeStatus(
  status: PluginResourceBindingStatus | undefined,
  fallback: PluginResourceBindingStatus
): PluginResourceBindingStatus {
  const normalized = status ?? fallback;
  if (!VALID_STATUS.has(normalized)) {
    throw new PluginError({
      code: 'PLUGIN_RESOURCE_BINDING_STATUS_INVALID',
      message: `Resource binding status "${String(status)}" is invalid.`,
      statusCode: 400,
    });
  }
  return normalized;
}

function bindingDeclaration(scope: PluginCapabilityScope, resourceType: string, scopeType: string) {
  return scope.contract.resourceBindings.find(
    (binding) => binding.type === resourceType && binding.scope === scopeType
  );
}

function requireBindingDeclaration(
  scope: PluginCapabilityScope,
  resourceType: string,
  resourceScope: NormalizedPluginResourceScope,
  capability: string
) {
  const declaration = bindingDeclaration(scope, resourceType, resourceScope.type);
  if (!declaration) {
    throw new PluginError({
      code: 'PLUGIN_RESOURCE_BINDING_UNDECLARED',
      message: `${capability} uses undeclared resource binding "${resourceType}" for ${resourceScope.type} scope.`,
      statusCode: 403,
      fix: `Declare resourceBindings: [{ type: "${resourceType}", scope: "${resourceScope.type}" }] in plugin.ts.`,
      details: {
        pluginId: scope.contract.id,
        resourceType,
        scope: resourceScope.type,
      },
    });
  }
  return declaration;
}

function roleAccessAllowed(
  required: readonly PluginWorkspaceRole[] | undefined,
  fallback: readonly PluginWorkspaceRole[]
): readonly PluginWorkspaceRole[] {
  return required?.length ? required : fallback;
}

async function enforceBindingAccess(
  scope: PluginCapabilityScope,
  resourceScope: NormalizedPluginResourceScope,
  action: 'read' | 'write',
  requiredRoles: readonly PluginWorkspaceRole[],
  capability: string
) {
  await assertResourceScopeWorkspaceRoles(scope, resourceScope, action, requiredRoles, capability);
}

function toRecord(row: PluginResourceBinding): PluginResourceBindingRecord {
  return {
    id: row.id,
    scope: denormalizeResourceScope({
      type: row.scopeType as 'user' | 'workspace',
      id: row.scopeId,
    }),
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    displayName: row.displayName ?? undefined,
    status: normalizeStatus(row.status as PluginResourceBindingStatus, 'active'),
    metadata: row.metadata,
    createdByUserId: row.createdByUserId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt ?? undefined,
  };
}

export class DbPluginResourceBindingsRepository implements PluginResourceBindingsRepository {
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

  async get(
    scope: PluginResourceBindingsScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      resourceType: string;
      resourceId?: string;
      status?: PluginResourceBindingStatus;
    }
  ) {
    return this.inSystem(async (executor) => {
      const conditions: SQL[] = [
        eq(pluginResourceBindings.pluginId, scope.pluginId),
        eq(pluginResourceBindings.scopeType, input.resourceScope.type),
        eq(pluginResourceBindings.scopeId, input.resourceScope.id),
        eq(pluginResourceBindings.resourceType, input.resourceType),
      ];
      if (input.resourceId) {
        conditions.push(eq(pluginResourceBindings.resourceId, input.resourceId));
      }
      if (input.status) {
        conditions.push(eq(pluginResourceBindings.status, input.status));
      }

      const rows = await executor
        .select()
        .from(pluginResourceBindings)
        .where(and(...conditions))
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async list(
    scope: PluginResourceBindingsScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      resourceType?: string;
      status?: PluginResourceBindingStatus;
      limit: number;
      offset: number;
    }
  ) {
    return this.inSystem(async (executor) => {
      const conditions: SQL[] = [
        eq(pluginResourceBindings.pluginId, scope.pluginId),
        eq(pluginResourceBindings.scopeType, input.resourceScope.type),
        eq(pluginResourceBindings.scopeId, input.resourceScope.id),
      ];
      if (input.resourceType) {
        conditions.push(eq(pluginResourceBindings.resourceType, input.resourceType));
      }
      if (input.status) {
        conditions.push(eq(pluginResourceBindings.status, input.status));
      }

      return executor
        .select()
        .from(pluginResourceBindings)
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset);
    });
  }

  async upsert(
    scope: PluginResourceBindingsScope,
    input: {
      resourceScope: NormalizedPluginResourceScope;
      resourceType: string;
      resourceId: string;
      displayName?: string;
      metadata: Record<string, unknown>;
      status: Extract<PluginResourceBindingStatus, 'active' | 'disabled'>;
      cardinality: 'one' | 'many';
    }
  ) {
    const now = new Date();
    return this.inSystem(async (executor) => {
      if (input.cardinality === 'one') {
        await executor
          .update(pluginResourceBindings)
          .set({ status: 'archived', archivedAt: now, updatedAt: now })
          .where(
            and(
              eq(pluginResourceBindings.pluginId, scope.pluginId),
              eq(pluginResourceBindings.scopeType, input.resourceScope.type),
              eq(pluginResourceBindings.scopeId, input.resourceScope.id),
              eq(pluginResourceBindings.resourceType, input.resourceType)
            )
          );
      }

      const [row] = await executor
        .insert(pluginResourceBindings)
        .values({
          id: randomUUID(),
          pluginId: scope.pluginId,
          scopeType: input.resourceScope.type,
          scopeId: input.resourceScope.id,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          displayName: input.displayName,
          status: input.status,
          metadata: input.metadata,
          createdByUserId: scope.userId,
          updatedAt: now,
        } satisfies NewPluginResourceBinding)
        .onConflictDoUpdate({
          target: [
            pluginResourceBindings.pluginId,
            pluginResourceBindings.scopeType,
            pluginResourceBindings.scopeId,
            pluginResourceBindings.resourceType,
            pluginResourceBindings.resourceId,
          ],
          set: {
            displayName: input.displayName,
            status: input.status,
            metadata: input.metadata,
            archivedAt: null,
            updatedAt: now,
          },
        })
        .returning();
      return row;
    });
  }

  async getById(scope: PluginResourceBindingsScope, id: string) {
    return this.inSystem(async (executor) => {
      const rows = await executor
        .select()
        .from(pluginResourceBindings)
        .where(
          and(eq(pluginResourceBindings.pluginId, scope.pluginId), eq(pluginResourceBindings.id, id))
        )
        .limit(1);
      return rows[0] ?? null;
    });
  }

  async archive(scope: PluginResourceBindingsScope, id: string) {
    const now = new Date();
    return this.inSystem(async (executor) => {
      const [row] = await executor
        .update(pluginResourceBindings)
        .set({ status: 'archived', archivedAt: now, updatedAt: now })
        .where(
          and(eq(pluginResourceBindings.pluginId, scope.pluginId), eq(pluginResourceBindings.id, id))
        )
        .returning();
      if (!row) {
        throw new PluginError({
          code: 'PLUGIN_RESOURCE_BINDING_NOT_FOUND',
          message: `Resource binding "${id}" was not found.`,
          statusCode: 404,
        });
      }
      return row;
    });
  }
}

export function createPluginResourceBindingsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginResourceBindingsOptions = {}
): PluginResourceBindings {
  const repository = options.repository ?? new DbPluginResourceBindingsRepository();

  return {
    async get(input) {
      enforceCapabilityPermission(
        scope,
        Permission.ResourceBindingsRead,
        'ctx.resourceBindings.get'
      );
      const capabilityScope = resolveScope(scope, 'ctx.resourceBindings.get');
      const resourceScope = normalizeResourceScope(
        scope,
        input.scope,
        'ctx.resourceBindings.get'
      );
      const resourceType = normalizeResourceType(input.resourceType);
      const declaration = requireBindingDeclaration(
        scope,
        resourceType,
        resourceScope,
        'ctx.resourceBindings.get'
      );
      await enforceBindingAccess(
        scope,
        resourceScope,
        'read',
        roleAccessAllowed(declaration.permissions?.read, DEFAULT_READ_ROLES),
        'ctx.resourceBindings.get'
      );
      const row = await repository.get(capabilityScope, {
        resourceScope,
        resourceType,
        resourceId: input.resourceId ? normalizeResourceId(input.resourceId) : undefined,
        status: normalizeStatus(input.status, 'active'),
      });
      return row ? toRecord(row) : null;
    },

    async list(input) {
      enforceCapabilityPermission(
        scope,
        Permission.ResourceBindingsRead,
        'ctx.resourceBindings.list'
      );
      const capabilityScope = resolveScope(scope, 'ctx.resourceBindings.list');
      const resourceScope = normalizeResourceScope(
        scope,
        input.scope,
        'ctx.resourceBindings.list'
      );
      const resourceType = input.resourceType ? normalizeResourceType(input.resourceType) : undefined;
      if (resourceType) {
        const declaration = requireBindingDeclaration(
          scope,
          resourceType,
          resourceScope,
          'ctx.resourceBindings.list'
        );
        await enforceBindingAccess(
          scope,
          resourceScope,
          'read',
          roleAccessAllowed(declaration.permissions?.read, DEFAULT_READ_ROLES),
          'ctx.resourceBindings.list'
        );
      } else {
        await assertResourceScopeAccess(scope, resourceScope, 'read', 'ctx.resourceBindings.list');
      }

      const rows = await repository.list(capabilityScope, {
        resourceScope,
        resourceType,
        status: input.status ? normalizeStatus(input.status, 'active') : 'active',
        limit: Math.min(Math.max(input.limit ?? 100, 1), 500),
        offset: Math.max(input.offset ?? 0, 0),
      });
      return rows.map(toRecord);
    },

    async upsert(input) {
      enforceCapabilityPermission(
        scope,
        Permission.ResourceBindingsWrite,
        'ctx.resourceBindings.upsert'
      );
      const capabilityScope = resolveScope(scope, 'ctx.resourceBindings.upsert');
      const resourceScope = normalizeResourceScope(
        scope,
        input.scope,
        'ctx.resourceBindings.upsert'
      );
      const resourceType = normalizeResourceType(input.resourceType);
      const resourceId = normalizeResourceId(input.resourceId);
      const declaration = requireBindingDeclaration(
        scope,
        resourceType,
        resourceScope,
        'ctx.resourceBindings.upsert'
      );
      await enforceBindingAccess(
        scope,
        resourceScope,
        'write',
        roleAccessAllowed(declaration.permissions?.write, DEFAULT_WRITE_ROLES),
        'ctx.resourceBindings.upsert'
      );
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'Resource binding metadata');
      const row = await repository.upsert(capabilityScope, {
        resourceScope,
        resourceType,
        resourceId,
        displayName: input.displayName,
        metadata,
        status: normalizeStatus(input.status, 'active') as Extract<
          PluginResourceBindingStatus,
          'active' | 'disabled'
        >,
        cardinality: declaration.cardinality ?? 'many',
      });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.resourceBindings.upsert`,
        { bindingId: row.id, resourceType, resourceId, scope: resourceScope },
        options.auditPort
      );
      return toRecord(row);
    },

    async archive(id) {
      enforceCapabilityPermission(
        scope,
        Permission.ResourceBindingsWrite,
        'ctx.resourceBindings.archive'
      );
      const capabilityScope = resolveScope(scope, 'ctx.resourceBindings.archive');
      const existing = await repository.getById(capabilityScope, id.trim());
      if (!existing) {
        throw new PluginError({
          code: 'PLUGIN_RESOURCE_BINDING_NOT_FOUND',
          message: `Resource binding "${id}" was not found.`,
          statusCode: 404,
        });
      }
      const resourceScope: NormalizedPluginResourceScope = {
        type: existing.scopeType as 'user' | 'workspace',
        id: existing.scopeId,
      };
      const declaration = requireBindingDeclaration(
        scope,
        existing.resourceType,
        resourceScope,
        'ctx.resourceBindings.archive'
      );
      await enforceBindingAccess(
        scope,
        resourceScope,
        'write',
        roleAccessAllowed(declaration.permissions?.write, DEFAULT_WRITE_ROLES),
        'ctx.resourceBindings.archive'
      );
      const row = await repository.archive(capabilityScope, existing.id);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.resourceBindings.archive`,
        { bindingId: row.id, resourceType: row.resourceType },
        options.auditPort
      );
      return toRecord(row);
    },
  };
}
