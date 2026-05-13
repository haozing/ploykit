import { and, eq, sql } from 'drizzle-orm';
import { Permission, type PluginSecrets } from '@ploykit/plugin-sdk';
import { db, type Database } from '@/lib/db/client.server';
import { pluginSecrets } from '@/lib/db/schema/plugin-capabilities';
import type { AuditPort } from '@/lib/audit/audit-port.server';
import {
  assertName,
  enforceCapabilityPermission,
  requireUserOrSystem,
  type PluginCapabilityScope,
} from './guards.server';
import { recordCapabilityAudit } from './audit-helper.server';
import {
  decryptPluginSecret,
  encryptPluginSecret,
  PLUGIN_SECRET_ENCODING,
} from './secret-crypto.server';

export interface PluginSecretScope {
  pluginId: string;
  userId: string;
  system?: boolean;
}

export interface PluginSecretsRepository {
  get(scope: PluginSecretScope, name: string): Promise<string | null>;
  set(scope: PluginSecretScope, name: string, value: string): Promise<void>;
  delete(scope: PluginSecretScope, name: string): Promise<void>;
}

interface PluginSecretStoredValue {
  valueCiphertext: string;
  encoding: string;
}

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

function scopeContextUserId(scope: PluginSecretScope): string {
  return scope.system ? 'system' : scope.userId;
}

function secretWhere(scope: PluginSecretScope, name: string) {
  return and(
    eq(pluginSecrets.pluginId, scope.pluginId),
    eq(pluginSecrets.userId, scope.userId),
    eq(pluginSecrets.name, name)
  );
}

export class DbPluginSecretsRepository implements PluginSecretsRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inContext<T>(
    scope: PluginSecretScope,
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

  async get(scope: PluginSecretScope, name: string): Promise<string | null> {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .select()
        .from(pluginSecrets)
        .where(secretWhere(scope, name))
        .limit(1);

      const record = rows[0];
      if (!record) {
        return null;
      }

      return decryptPluginSecret(record.valueCiphertext, record.encoding, {
        pluginId: scope.pluginId,
        userId: scope.userId,
        name,
      });
    });
  }

  async set(scope: PluginSecretScope, name: string, value: string): Promise<void> {
    const encrypted = encryptPluginSecret(value, {
      pluginId: scope.pluginId,
      userId: scope.userId,
      name,
    });

    await this.inContext(scope, async (executor) => {
      await executor
        .insert(pluginSecrets)
        .values({
          id: `${scope.pluginId}:${scope.userId}:${name}`,
          pluginId: scope.pluginId,
          userId: scope.userId,
          name,
          valueCiphertext: encrypted.valueCiphertext,
          encoding: encrypted.encoding,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [pluginSecrets.pluginId, pluginSecrets.userId, pluginSecrets.name],
          set: {
            valueCiphertext: encrypted.valueCiphertext,
            encoding: encrypted.encoding,
            updatedAt: new Date(),
          },
        });
    });
  }

  async getStoredValue(
    scope: PluginSecretScope,
    name: string
  ): Promise<PluginSecretStoredValue | null> {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .select({
          valueCiphertext: pluginSecrets.valueCiphertext,
          encoding: pluginSecrets.encoding,
        })
        .from(pluginSecrets)
        .where(secretWhere(scope, name))
        .limit(1);

      return rows[0] ?? null;
    });
  }

  async delete(scope: PluginSecretScope, name: string): Promise<void> {
    await this.inContext(scope, async (executor) => {
      await executor.delete(pluginSecrets).where(secretWhere(scope, name));
    });
  }
}

export interface CreatePluginSecretsOptions {
  repository?: PluginSecretsRepository;
  auditPort?: AuditPort;
}

function createSecretScope(scope: PluginCapabilityScope): PluginSecretScope {
  return {
    pluginId: scope.contract.id,
    userId: scope.system ? '' : (scope.user?.id ?? ''),
    system: scope.system,
  };
}

export function createPluginSecretsCapability(
  scope: PluginCapabilityScope,
  options: CreatePluginSecretsOptions = {}
): PluginSecrets {
  const repository = options.repository ?? new DbPluginSecretsRepository();
  const secretScope = createSecretScope(scope);

  return {
    async get(name: string): Promise<string | null> {
      enforceCapabilityPermission(scope, Permission.SecretsRead, 'ctx.secrets.get');
      requireUserOrSystem(scope, 'ctx.secrets.get');
      assertName(name, 'Secret name');

      return repository.get(secretScope, name);
    },

    async set(name: string, value: string): Promise<void> {
      enforceCapabilityPermission(scope, Permission.SecretsWrite, 'ctx.secrets.set');
      requireUserOrSystem(scope, 'ctx.secrets.set');
      assertName(name, 'Secret name');

      await repository.set(secretScope, name, value);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.secrets.set`,
        { name, encoding: PLUGIN_SECRET_ENCODING },
        options.auditPort
      );
    },

    async delete(name: string): Promise<void> {
      enforceCapabilityPermission(scope, Permission.SecretsWrite, 'ctx.secrets.delete');
      requireUserOrSystem(scope, 'ctx.secrets.delete');
      assertName(name, 'Secret name');

      await repository.delete(secretScope, name);
      await recordCapabilityAudit(
        scope,
        `${scope.contract.id}.secrets.delete`,
        { name },
        options.auditPort
      );
    },
  };
}
