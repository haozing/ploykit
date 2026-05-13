import { createHash, randomBytes, randomUUID } from 'crypto';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  Permission,
  type PluginApiKeyCreateResult,
  type PluginApiKeyRecord,
  type PluginApiKeys,
} from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginApiKeys,
  type NewPluginApiKey,
  type PluginApiKey,
} from '@/lib/db/schema/plugin-platform';
import {
  assertResourceScopeAccess,
  assertJsonSerializable,
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

export interface PluginApiKeysScope {
  pluginId: string;
  userId: string;
}

export interface PluginApiKeysRepository {
  create(
    scope: PluginApiKeysScope,
    input: {
      name: string;
      resourceScope: NormalizedPluginResourceScope;
      permissions: string[];
      metadata: Record<string, unknown>;
      expiresAt?: Date;
    }
  ): Promise<{ row: PluginApiKey; cleartext: string }>;
  list(
    scope: PluginApiKeysScope,
    input: { resourceScope?: NormalizedPluginResourceScope }
  ): Promise<PluginApiKey[]>;
  revoke(scope: PluginApiKeysScope, id: string): Promise<void>;
  verify(pluginId: string, key: string): Promise<PluginApiKey | null>;
}

export interface CreatePluginApiKeysOptions {
  repository?: PluginApiKeysRepository;
  auditPort?: AuditPort;
}

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

function generateKey(pluginId: string): { key: string; prefix: string } {
  const prefix = `pk_${pluginId.replace(/-/g, '_').slice(0, 16)}`;
  return {
    prefix,
    key: `${prefix}_${randomBytes(24).toString('base64url')}`,
  };
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (!normalized || normalized.length > 120) {
    throw new Error('API key name must be non-empty and at most 120 characters.');
  }
  return normalized;
}

function toRecord(row: PluginApiKey): PluginApiKeyRecord {
  return {
    id: row.id,
    name: row.name,
    scope: denormalizeResourceScope({
      type: row.scopeType as 'user' | 'workspace',
      id: row.scopeId,
    }),
    permissions: row.permissions,
    revokedAt: row.revokedAt ?? undefined,
    expiresAt: row.expiresAt ?? undefined,
    lastUsedAt: row.lastUsedAt ?? undefined,
    createdAt: row.createdAt,
  };
}

function toCreateResult(row: PluginApiKey, key: string): PluginApiKeyCreateResult {
  return {
    ...toRecord(row),
    key,
  };
}

function resolveScope(scope: PluginCapabilityScope, capability: string): PluginApiKeysScope {
  const user = requireUser(scope, capability);
  return { pluginId: scope.contract.id, userId: user.id };
}

export class DbPluginApiKeysRepository implements PluginApiKeysRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inSystem<T>(fn: (executor: Executor) => Promise<T>): Promise<T> {
    if (this.executor !== db) return fn(this.executor);
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.current_user_id', 'system', true)`);
      return fn(tx);
    });
  }

  async create(
    scope: PluginApiKeysScope,
    input: {
      name: string;
      resourceScope: NormalizedPluginResourceScope;
      permissions: string[];
      metadata: Record<string, unknown>;
      expiresAt?: Date;
    }
  ) {
    const generated = generateKey(scope.pluginId);
    return this.inSystem(async (executor) => {
      const [row] = await executor
        .insert(pluginApiKeys)
        .values({
          id: randomUUID(),
          pluginId: scope.pluginId,
          userId: scope.userId,
          scopeType: input.resourceScope.type,
          scopeId: input.resourceScope.id,
          name: input.name,
          prefix: generated.prefix,
          keyHash: hashKey(generated.key),
          permissions: input.permissions,
          metadata: input.metadata,
          expiresAt: input.expiresAt,
        } satisfies NewPluginApiKey)
        .returning();

      return { row, cleartext: generated.key };
    });
  }

  async list(scope: PluginApiKeysScope, input: { resourceScope?: NormalizedPluginResourceScope }) {
    return this.inSystem((executor) => {
      const conditions: SQL[] = [eq(pluginApiKeys.pluginId, scope.pluginId)];
      if (input.resourceScope) {
        conditions.push(eq(pluginApiKeys.scopeType, input.resourceScope.type));
        conditions.push(eq(pluginApiKeys.scopeId, input.resourceScope.id));
        if (input.resourceScope.type === 'user') {
          conditions.push(eq(pluginApiKeys.userId, scope.userId));
        }
      } else {
        conditions.push(eq(pluginApiKeys.userId, scope.userId));
      }
      return executor
        .select()
        .from(pluginApiKeys)
        .where(and(...conditions));
    });
  }

  async revoke(scope: PluginApiKeysScope, id: string) {
    await this.inSystem(async (executor) => {
      await executor
        .update(pluginApiKeys)
        .set({ revokedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(pluginApiKeys.pluginId, scope.pluginId),
            eq(pluginApiKeys.userId, scope.userId),
            eq(pluginApiKeys.id, id)
          )
        );
    });
  }

  async verify(pluginId: string, key: string) {
    return this.inSystem(async (executor) => {
      const [row] = await executor
        .select()
        .from(pluginApiKeys)
        .where(
          and(
            eq(pluginApiKeys.pluginId, pluginId),
            eq(pluginApiKeys.keyHash, hashKey(key)),
            isNull(pluginApiKeys.revokedAt)
          )
        )
        .limit(1);

      if (!row) return null;
      if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

      await executor
        .update(pluginApiKeys)
        .set({ lastUsedAt: new Date(), updatedAt: new Date() })
        .where(eq(pluginApiKeys.id, row.id));

      return row;
    });
  }
}

export function createPluginApiKeysCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginApiKeysOptions = {}
): PluginApiKeys {
  const repository = options.repository ?? new DbPluginApiKeysRepository();

  return {
    async create(input) {
      enforceCapabilityPermission(scope, Permission.ApiKeysWrite, 'ctx.apiKeys.create');
      const apiKeyScope = resolveScope(scope, 'ctx.apiKeys.create');
      const metadata = input.metadata ?? {};
      assertJsonSerializable(metadata, 'API key metadata');
      const resourceScope = normalizeResourceScope(scope, input.scope, 'ctx.apiKeys.create');
      await assertResourceScopeAccess(scope, resourceScope, 'manage', 'ctx.apiKeys.create');
      const result = await repository.create(apiKeyScope, {
        name: normalizeName(input.name),
        resourceScope,
        permissions: input.permissions ?? [],
        metadata,
        expiresAt: input.expiresAt,
      });
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.apiKeys.create`,
        { apiKeyId: result.row.id, scope: { type: result.row.scopeType, id: result.row.scopeId } },
        options.auditPort
      );
      return toCreateResult(result.row, result.cleartext);
    },

    async list(input = {}) {
      enforceCapabilityPermission(scope, Permission.ApiKeysRead, 'ctx.apiKeys.list');
      const apiKeyScope = resolveScope(scope, 'ctx.apiKeys.list');
      const resourceScope = input.scope
        ? normalizeResourceScope(scope, input.scope, 'ctx.apiKeys.list')
        : undefined;
      if (resourceScope) {
        await assertResourceScopeAccess(scope, resourceScope, 'manage', 'ctx.apiKeys.list');
      }
      const rows = await repository.list(apiKeyScope, {
        resourceScope,
      });
      return rows.map(toRecord);
    },

    async revoke(id) {
      enforceCapabilityPermission(scope, Permission.ApiKeysWrite, 'ctx.apiKeys.revoke');
      const apiKeyScope = resolveScope(scope, 'ctx.apiKeys.revoke');
      await repository.revoke(apiKeyScope, id);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.apiKeys.revoke`,
        { apiKeyId: id },
        options.auditPort
      );
    },
  };
}
