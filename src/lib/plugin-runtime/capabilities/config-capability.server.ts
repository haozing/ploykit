import { and, eq, sql } from 'drizzle-orm';
import { Permission, type PluginConfig } from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import { pluginConfig } from '@/lib/db/schema/plugin-capabilities';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import {
  assertJsonSerializable,
  assertName,
  enforceCapabilityPermission,
  requireUserOrSystem,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';

export interface PluginConfigScope {
  pluginId: string;
  userId: string;
  system?: boolean;
}

export interface PluginConfigRepository {
  get(scope: PluginConfigScope, key: string): Promise<unknown | null>;
  set(scope: PluginConfigScope, key: string, value: unknown): Promise<void>;
  delete(scope: PluginConfigScope, key: string): Promise<void>;
}

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

function scopeContextUserId(scope: PluginConfigScope): string {
  return scope.system ? 'system' : scope.userId;
}

function configWhere(scope: PluginConfigScope, key: string) {
  return and(
    eq(pluginConfig.pluginId, scope.pluginId),
    eq(pluginConfig.userId, scope.userId),
    eq(pluginConfig.key, key)
  );
}

export class DbPluginConfigRepository implements PluginConfigRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inContext<T>(
    scope: PluginConfigScope,
    fn: (executor: Executor) => Promise<T>
  ): Promise<T> {
    if (this.executor !== db) {
      await this.executor.execute(
        sql`SELECT set_config('app.current_user_id', ${scopeContextUserId(scope)}, true)`
      );
      await this.executor.execute(
        sql`SELECT set_config('app.current_plugin_id', ${scope.pluginId}, true)`
      );
      return fn(this.executor);
    }

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_user_id', ${scopeContextUserId(scope)}, true)`
      );
      await tx.execute(sql`SELECT set_config('app.current_plugin_id', ${scope.pluginId}, true)`);
      return fn(tx);
    });
  }

  async get(scope: PluginConfigScope, key: string): Promise<unknown | null> {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .select()
        .from(pluginConfig)
        .where(configWhere(scope, key))
        .limit(1);

      return rows[0]?.value ?? null;
    });
  }

  async set(scope: PluginConfigScope, key: string, value: unknown): Promise<void> {
    await this.inContext(scope, async (executor) => {
      await executor
        .insert(pluginConfig)
        .values({
          id: `${scope.pluginId}:${scope.userId}:${key}`,
          pluginId: scope.pluginId,
          userId: scope.userId,
          key,
          value,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [pluginConfig.pluginId, pluginConfig.userId, pluginConfig.key],
          set: {
            value,
            updatedAt: new Date(),
          },
        });
    });
  }

  async delete(scope: PluginConfigScope, key: string): Promise<void> {
    await this.inContext(scope, async (executor) => {
      await executor.delete(pluginConfig).where(configWhere(scope, key));
    });
  }
}

export interface CreatePluginConfigOptions {
  repository?: PluginConfigRepository;
  auditPort?: AuditPort;
}

function createConfigScope(scope: PluginCapabilityScope): PluginConfigScope {
  return {
    pluginId: scope.contract.id,
    userId: scope.system ? '' : (scope.user?.id ?? ''),
    system: scope.system,
  };
}

export function createPluginConfigCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginConfigOptions = {}
): PluginConfig {
  const repository = options.repository ?? new DbPluginConfigRepository();
  const configScope = createConfigScope(scope);

  return {
    async get<T = unknown>(key: string): Promise<T | null> {
      enforceCapabilityPermission(scope, Permission.ConfigRead, 'ctx.config.get');
      assertName(key, 'Config key');

      const defaultValue = scope.contract.definition.config?.defaults?.[key] as T | undefined;
      if (!scope.user && !scope.system) {
        return defaultValue ?? null;
      }

      const value = await repository.get(configScope, key);
      return (value as T | null) ?? defaultValue ?? null;
    },

    async set<T = unknown>(key: string, value: T): Promise<void> {
      enforceCapabilityPermission(scope, Permission.ConfigWrite, 'ctx.config.set');
      requireUserOrSystem(scope, 'ctx.config.set');
      assertName(key, 'Config key');
      assertJsonSerializable(value, 'Config value');

      await repository.set(configScope, key, value);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.config.set`,
        { key },
        options.auditPort
      );
    },

    async delete(key: string): Promise<void> {
      enforceCapabilityPermission(scope, Permission.ConfigWrite, 'ctx.config.delete');
      requireUserOrSystem(scope, 'ctx.config.delete');
      assertName(key, 'Config key');

      await repository.delete(configScope, key);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.config.delete`,
        { key },
        options.auditPort
      );
    },
  };
}
