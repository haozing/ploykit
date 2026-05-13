import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginCollections,
  pluginRecords,
  type PluginRecord,
} from '@/lib/db/schema/plugin-storage';
import { applyPluginStorageQuery } from './query';
import {
  createPluginStorage,
  type CreatePluginStorageOptions,
  type EnsurePluginCollectionInput,
  type InsertPluginRecordInput,
  type PluginStorageRepository,
  type PluginStorageScope,
  type PluginStoredRecord,
  type UpdatePluginRecordInput,
} from './runtime';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;

const QUERY_SCAN_LIMIT = 2_000;

function mapRecord(row: PluginRecord): PluginStoredRecord {
  return {
    id: row.id,
    pluginId: row.pluginId,
    collectionName: row.collectionName,
    userId: row.userId,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function scopeContextUserId(scope: PluginStorageScope): string {
  return scope.system ? 'system' : (scope.userId ?? '');
}

function baseRecordWhere(scope: PluginStorageScope, collectionName: string) {
  const filters = [
    eq(pluginRecords.pluginId, scope.pluginId),
    eq(pluginRecords.collectionName, collectionName),
    isNull(pluginRecords.deletedAt),
  ];

  if (!scope.system) {
    filters.push(eq(pluginRecords.userId, scope.userId ?? ''));
  } else if (scope.userId) {
    filters.push(eq(pluginRecords.userId, scope.userId));
  }

  return and(...filters);
}

export class DbPluginStorageRepository implements PluginStorageRepository {
  constructor(private readonly executor: Executor = db) {}

  private async inContext<T>(
    scope: PluginStorageScope,
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

  async ensureCollection(input: EnsurePluginCollectionInput): Promise<void> {
    const now = new Date();

    await this.inContext({ pluginId: input.pluginId, system: true }, async (executor) => {
      await executor
        .insert(pluginCollections)
        .values({
          id: `${input.pluginId}:${input.name}`,
          pluginId: input.pluginId,
          name: input.name,
          schemaJson: input.schemaJson as unknown as Record<string, unknown>,
          schemaHash: input.schemaHash,
          indexesJson: input.indexesJson as Array<Record<string, unknown>>,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [pluginCollections.pluginId, pluginCollections.name],
          set: {
            schemaJson: input.schemaJson as unknown as Record<string, unknown>,
            schemaHash: input.schemaHash,
            indexesJson: input.indexesJson as Array<Record<string, unknown>>,
            updatedAt: now,
          },
        });
    });
  }

  async findMany(
    scope: PluginStorageScope,
    collectionName: string,
    query?: Parameters<PluginStorageRepository['findMany']>[2]
  ): Promise<PluginStoredRecord[]> {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .select()
        .from(pluginRecords)
        .where(baseRecordWhere(scope, collectionName))
        .orderBy(pluginRecords.createdAt)
        .limit(QUERY_SCAN_LIMIT);

      return applyPluginStorageQuery(rows.map(mapRecord), query);
    });
  }

  async findById(
    scope: PluginStorageScope,
    collectionName: string,
    id: string
  ): Promise<PluginStoredRecord | null> {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .select()
        .from(pluginRecords)
        .where(and(baseRecordWhere(scope, collectionName), eq(pluginRecords.id, id)))
        .limit(1);

      return rows[0] ? mapRecord(rows[0]) : null;
    });
  }

  async insert(
    scope: PluginStorageScope,
    input: InsertPluginRecordInput
  ): Promise<PluginStoredRecord> {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .insert(pluginRecords)
        .values({
          id: input.id,
          pluginId: input.pluginId,
          collectionName: input.collectionName,
          userId: input.userId,
          data: input.data,
        })
        .returning();

      return mapRecord(rows[0]);
    });
  }

  async update(
    scope: PluginStorageScope,
    input: UpdatePluginRecordInput
  ): Promise<PluginStoredRecord> {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .update(pluginRecords)
        .set({
          data: input.data,
          updatedAt: new Date(),
        })
        .where(and(baseRecordWhere(scope, input.collectionName), eq(pluginRecords.id, input.id)))
        .returning();

      return mapRecord(rows[0]);
    });
  }

  async softDelete(
    scope: PluginStorageScope,
    collectionName: string,
    id: string
  ): Promise<PluginStoredRecord | null> {
    return this.inContext(scope, async (executor) => {
      const rows = await executor
        .update(pluginRecords)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(and(baseRecordWhere(scope, collectionName), eq(pluginRecords.id, id)))
        .returning();

      return rows[0] ? mapRecord(rows[0]) : null;
    });
  }

  async transaction<T>(
    scope: PluginStorageScope,
    fn: (repository: PluginStorageRepository) => Promise<T>
  ): Promise<T> {
    if (this.executor !== db) {
      return fn(new DbPluginStorageRepository(this.executor));
    }

    return db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_user_id', ${scopeContextUserId(scope)}, true)`
      );
      await tx.execute(sql`SELECT set_config('app.current_plugin_id', ${scope.pluginId}, true)`);
      return fn(new DbPluginStorageRepository(tx));
    });
  }
}

export function createPluginStorageRuntime(
  options: Omit<CreatePluginStorageOptions, 'repository'> & {
    repository?: PluginStorageRepository;
  }
) {
  return createPluginStorage({
    ...options,
    repository: options.repository ?? new DbPluginStorageRepository(),
  });
}

export function describePluginStorageRuntime() {
  return {
    driver: 'postgres',
    tables: ['plugin_collections', 'plugin_records'],
    rls: ['plugin_id', 'user_id'],
    queryScanLimit: QUERY_SCAN_LIMIT,
  };
}
