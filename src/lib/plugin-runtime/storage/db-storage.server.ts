import { randomUUID } from 'crypto';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { db, type Database } from '@/lib/db/client.server';
import {
  pluginCollections,
  pluginRecordUniqueKeys,
  pluginRecords,
  type PluginRecord,
} from '@/lib/db/schema/plugin-storage';
import {
  PluginError,
  type PluginCollectionDefinition,
  type PluginStorageScalar,
} from '@ploykit/plugin-sdk';
import { normalizePluginStorageQuery } from './query';
import { normalizeCollectionDefinition, type NormalizedPluginCollectionFieldType } from './schema';
import {
  createPluginStorage,
  type CreatePluginStorageOptions,
  type EnsurePluginCollectionInput,
  type InsertPluginRecordInput,
  type PluginRecordUniqueKeyInput,
  type PluginStorageRepository,
  type PluginStorageScope,
  type PluginStoredRecord,
  type UpdatePluginRecordInput,
  type UpdatePluginRecordWhereInput,
} from './runtime';

type TransactionDatabase = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Database | TransactionDatabase;
type StorageColumnType = NormalizedPluginCollectionFieldType | 'id' | 'timestamp';

function mapRecord(row: PluginRecord): PluginStoredRecord {
  return {
    id: row.id,
    pluginId: row.pluginId,
    collectionName: row.collectionName,
    userId: row.userId,
    scopeType: row.scopeType as PluginStorageScope['scopeType'],
    scopeId: row.scopeId,
    data: row.data,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function jsonTextField(field: string): SQL<string> {
  return sql`${pluginRecords.data}->>${field}`;
}

function jsonFieldExpression(field: string, type: StorageColumnType): SQL {
  const textField = jsonTextField(field);

  if (type === 'number' || type === 'integer') {
    return sql`(${textField})::numeric`;
  }

  if (type === 'boolean') {
    return sql`(${textField})::boolean`;
  }

  if (type === 'date' || type === 'datetime') {
    return sql`(${textField})::timestamptz`;
  }

  return textField;
}

function storageFieldType(
  collection: PluginCollectionDefinition,
  field: string
): StorageColumnType {
  if (field === 'id') return 'id';
  if (field === 'createdAt' || field === 'updatedAt') return 'timestamp';

  const normalized = normalizeCollectionDefinition(collection);
  return normalized.fields[field]?.type ?? 'text';
}

function storageExpression(collection: PluginCollectionDefinition, field: string): SQL {
  if (field === 'id') return sql`${pluginRecords.id}`;
  if (field === 'createdAt') return sql`${pluginRecords.createdAt}`;
  if (field === 'updatedAt') return sql`${pluginRecords.updatedAt}`;
  return jsonFieldExpression(field, storageFieldType(collection, field));
}

function normalizeScalarValue(
  value: PluginStorageScalar | undefined,
  type: StorageColumnType
): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return type === 'date' || type === 'datetime' || type === 'timestamp'
      ? value
      : value.toISOString();
  }

  if (type === 'number' || type === 'integer') {
    return typeof value === 'number' ? value : Number(value);
  }

  if (type === 'boolean') {
    return typeof value === 'boolean' ? value : value === 'true';
  }

  if (type === 'date' || type === 'datetime' || type === 'timestamp') {
    return typeof value === 'string' ? new Date(value) : value;
  }

  return String(value);
}

function storageEqPredicate(
  column: SQL,
  value: PluginStorageScalar | undefined,
  type: StorageColumnType
): SQL {
  const normalized = normalizeScalarValue(value, type);
  return normalized === null ? isNull(column) : eq(column, normalized);
}

function storageNePredicate(
  column: SQL,
  value: PluginStorageScalar | undefined,
  type: StorageColumnType
): SQL {
  const normalized = normalizeScalarValue(value, type);
  return normalized === null ? isNotNull(column) : ne(column, normalized);
}

function storageInPredicate(column: SQL, values: readonly unknown[], type: StorageColumnType): SQL {
  const normalizedValues = values.map((value) =>
    normalizeScalarValue(value as PluginStorageScalar, type)
  );
  const nonNullValues = normalizedValues.filter((value) => value !== null);
  const predicates: SQL[] = [];

  if (nonNullValues.length > 0) {
    predicates.push(inArray(column, nonNullValues));
  }

  if (normalizedValues.length !== nonNullValues.length) {
    predicates.push(isNull(column));
  }

  if (predicates.length === 0) {
    return sql`false`;
  }

  if (predicates.length === 1) {
    return predicates[0];
  }

  return or(...predicates) ?? sql`false`;
}

function storageFieldPredicate(
  collection: PluginCollectionDefinition,
  field: string,
  filter: unknown
): SQL | null {
  const fieldType = storageFieldType(collection, field);
  const column = storageExpression(collection, field);

  if (!filter || typeof filter !== 'object' || filter instanceof Date || Array.isArray(filter)) {
    return storageEqPredicate(column, filter as PluginStorageScalar, fieldType);
  }

  const operators = filter as Record<string, unknown>;
  const predicates: SQL[] = [];

  if (operators.eq !== undefined) {
    predicates.push(storageEqPredicate(column, operators.eq as PluginStorageScalar, fieldType));
  }
  if (operators.ne !== undefined) {
    predicates.push(storageNePredicate(column, operators.ne as PluginStorageScalar, fieldType));
  }
  if (operators.in !== undefined && Array.isArray(operators.in)) {
    predicates.push(storageInPredicate(column, operators.in, fieldType));
  }
  if (operators.gt !== undefined) {
    predicates.push(
      gt(column, normalizeScalarValue(operators.gt as PluginStorageScalar, fieldType))
    );
  }
  if (operators.gte !== undefined) {
    predicates.push(
      gte(column, normalizeScalarValue(operators.gte as PluginStorageScalar, fieldType))
    );
  }
  if (operators.lt !== undefined) {
    predicates.push(
      lt(column, normalizeScalarValue(operators.lt as PluginStorageScalar, fieldType))
    );
  }
  if (operators.lte !== undefined) {
    predicates.push(
      lte(column, normalizeScalarValue(operators.lte as PluginStorageScalar, fieldType))
    );
  }
  if (operators.startsWith !== undefined) {
    predicates.push(sql`${jsonTextField(field)} LIKE ${`${String(operators.startsWith)}%`}`);
  }
  if (operators.contains !== undefined) {
    if (fieldType === 'json') {
      predicates.push(
        sql`${pluginRecords.data}->${field} @> ${JSON.stringify([operators.contains])}::jsonb`
      );
    } else {
      predicates.push(sql`${jsonTextField(field)} LIKE ${`%${String(operators.contains)}%`}`);
    }
  }

  if (predicates.length === 0) {
    return null;
  }

  if (predicates.length === 1) {
    return predicates[0] ?? null;
  }

  return and(...predicates) ?? null;
}

function storageQueryPredicates(
  collection: PluginCollectionDefinition,
  query: Parameters<PluginStorageRepository['findMany']>[3]
) {
  const normalized = normalizePluginStorageQuery(query);
  return Object.entries(normalized.where)
    .map(([field, filter]) => storageFieldPredicate(collection, field, filter))
    .filter((predicate): predicate is SQL => predicate !== null);
}

function storageQueryOrderBy(
  collection: PluginCollectionDefinition,
  query: Parameters<PluginStorageRepository['findMany']>[3]
) {
  const normalized = normalizePluginStorageQuery(query);
  const entries = Object.entries(normalized.orderBy);

  if (entries.length === 0) {
    return [desc(pluginRecords.createdAt), desc(pluginRecords.id)];
  }

  const expressions = entries.map(([field, direction]) => {
    const expression = storageExpression(collection, field);
    return direction === 'desc' ? desc(expression) : asc(expression);
  });

  return [...expressions, desc(pluginRecords.id)];
}

function scopeContextUserId(scope: PluginStorageScope): string {
  return scope.system ? 'system' : (scope.userId ?? '');
}

function baseRecordWhere(scope: PluginStorageScope, collectionName: string) {
  const filters = [
    eq(pluginRecords.pluginId, scope.pluginId),
    eq(pluginRecords.collectionName, collectionName),
    eq(pluginRecords.scopeType, scope.scopeType),
    eq(pluginRecords.scopeId, scope.scopeId),
    isNull(pluginRecords.deletedAt),
  ];

  return and(...filters);
}

export class DbPluginStorageRepository implements PluginStorageRepository {
  constructor(private readonly executor: Executor = db) {}

  private createUniqueConflictError(
    input: InsertPluginRecordInput | UpdatePluginRecordInput,
    uniqueKey: PluginRecordUniqueKeyInput
  ): PluginError {
    return new PluginError({
      code: 'PLUGIN_STORAGE_UNIQUE_CONFLICT',
      message: `Unique storage key already exists in collection "${input.collectionName}".`,
      statusCode: 409,
      details: {
        pluginId: input.pluginId,
        collection: input.collectionName,
        fields: uniqueKey.fields,
      },
    });
  }

  private async findExistingByUniqueKey(
    executor: Executor,
    input: InsertPluginRecordInput | UpdatePluginRecordInput
  ): Promise<PluginStoredRecord | null> {
    for (const uniqueKey of input.uniqueKeys ?? []) {
      const [keyRow] = await executor
        .select()
        .from(pluginRecordUniqueKeys)
        .where(
          and(
            eq(pluginRecordUniqueKeys.pluginId, input.pluginId),
            eq(pluginRecordUniqueKeys.collectionName, input.collectionName),
            eq(pluginRecordUniqueKeys.scopeType, input.scopeType),
            eq(pluginRecordUniqueKeys.scopeId, input.scopeId),
            eq(pluginRecordUniqueKeys.uniqueKey, uniqueKey.key),
            isNull(pluginRecordUniqueKeys.deletedAt)
          )
        )
        .limit(1);

      if (!keyRow) {
        continue;
      }

      const [record] = await executor
        .select()
        .from(pluginRecords)
        .where(
          and(
            eq(pluginRecords.pluginId, input.pluginId),
            eq(pluginRecords.collectionName, input.collectionName),
            eq(pluginRecords.scopeType, input.scopeType),
            eq(pluginRecords.scopeId, input.scopeId),
            eq(pluginRecords.id, keyRow.recordId),
            isNull(pluginRecords.deletedAt)
          )
        )
        .limit(1);

      if (record) {
        return mapRecord(record);
      }
    }

    return null;
  }

  private async reserveUniqueKeys(
    executor: Executor,
    input: InsertPluginRecordInput | UpdatePluginRecordInput,
    uniqueKeys: PluginRecordUniqueKeyInput[],
    returnExisting = false
  ): Promise<PluginStoredRecord | null> {
    for (const uniqueKey of uniqueKeys) {
      const [inserted] = await executor
        .insert(pluginRecordUniqueKeys)
        .values({
          id: `${input.pluginId}:${input.collectionName}:${input.id}:${uniqueKey.key}:${randomUUID()}`,
          pluginId: input.pluginId,
          collectionName: input.collectionName,
          userId: input.userId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          uniqueKey: uniqueKey.key,
          recordId: input.id,
          fieldsJson: uniqueKey.fields,
        })
        .onConflictDoNothing({
          target: [
            pluginRecordUniqueKeys.pluginId,
            pluginRecordUniqueKeys.collectionName,
            pluginRecordUniqueKeys.scopeType,
            pluginRecordUniqueKeys.scopeId,
            pluginRecordUniqueKeys.uniqueKey,
          ],
          where: sql`${pluginRecordUniqueKeys.deletedAt} IS NULL`,
        })
        .returning();

      if (inserted) {
        continue;
      }

      const existing = await this.findExistingByUniqueKey(executor, {
        ...input,
        uniqueKeys: [uniqueKey],
      });
      if (returnExisting && existing) {
        return existing;
      }
      throw this.createUniqueConflictError(input, uniqueKey);
    }

    return null;
  }

  private async replaceUniqueKeys(
    executor: Executor,
    input: UpdatePluginRecordInput
  ): Promise<void> {
    const previousKeys = input.previousUniqueKeys ?? [];
    if (previousKeys.length > 0) {
      await executor
        .update(pluginRecordUniqueKeys)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pluginRecordUniqueKeys.pluginId, input.pluginId),
            eq(pluginRecordUniqueKeys.collectionName, input.collectionName),
            eq(pluginRecordUniqueKeys.recordId, input.id),
            isNull(pluginRecordUniqueKeys.deletedAt)
          )
        );
    }

    await this.reserveUniqueKeys(executor, input, input.uniqueKeys ?? []);
  }

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

    await this.inContext(
      {
        pluginId: input.pluginId,
        scopeType: 'plugin',
        scopeId: input.pluginId,
        system: true,
      },
      async (executor) => {
        await executor
          .insert(pluginCollections)
          .values({
            id: `${input.pluginId}:${input.name}`,
            pluginId: input.pluginId,
            name: input.name,
            schemaVersion: input.schemaVersion,
            schemaJson: input.schemaJson as unknown as Record<string, unknown>,
            schemaHash: input.schemaHash,
            indexesJson: input.indexesJson as Array<Record<string, unknown>>,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [pluginCollections.pluginId, pluginCollections.name],
            set: {
              schemaJson: input.schemaJson as unknown as Record<string, unknown>,
              schemaVersion: input.schemaVersion,
              schemaHash: input.schemaHash,
              indexesJson: input.indexesJson as Array<Record<string, unknown>>,
              updatedAt: now,
            },
          });
      }
    );
  }

  async findMany(
    scope: PluginStorageScope,
    collectionName: string,
    collection: PluginCollectionDefinition,
    query?: Parameters<PluginStorageRepository['findMany']>[3]
  ): Promise<PluginStoredRecord[]> {
    return this.inContext(scope, async (executor) => {
      const normalizedQuery = normalizePluginStorageQuery(query);
      const queryPredicates = storageQueryPredicates(collection, query);
      const rows = await executor
        .select()
        .from(pluginRecords)
        .where(and(baseRecordWhere(scope, collectionName), ...queryPredicates))
        .orderBy(...storageQueryOrderBy(collection, query))
        .limit(normalizedQuery.limit)
        .offset(normalizedQuery.offset);

      return rows.map(mapRecord);
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
      await this.reserveUniqueKeys(executor, input, input.uniqueKeys ?? []);
      const rows = await executor
        .insert(pluginRecords)
        .values({
          id: input.id,
          pluginId: input.pluginId,
          collectionName: input.collectionName,
          userId: input.userId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          data: input.data,
        })
        .returning();

      return mapRecord(rows[0]);
    });
  }

  async insertIfAbsent(
    scope: PluginStorageScope,
    input: InsertPluginRecordInput
  ): Promise<{ record: PluginStoredRecord; inserted: boolean }> {
    return this.inContext(scope, async (executor) => {
      const existing = await this.findExistingByUniqueKey(executor, input);
      if (existing) {
        return { record: existing, inserted: false };
      }

      const racedExisting = await this.reserveUniqueKeys(
        executor,
        input,
        input.uniqueKeys ?? [],
        true
      );
      if (racedExisting) {
        return { record: racedExisting, inserted: false };
      }
      const rows = await executor
        .insert(pluginRecords)
        .values({
          id: input.id,
          pluginId: input.pluginId,
          collectionName: input.collectionName,
          userId: input.userId,
          scopeType: input.scopeType,
          scopeId: input.scopeId,
          data: input.data,
        })
        .returning();

      return { record: mapRecord(rows[0]), inserted: true };
    });
  }

  async update(
    scope: PluginStorageScope,
    input: UpdatePluginRecordInput
  ): Promise<PluginStoredRecord> {
    return this.inContext(scope, async (executor) => {
      await this.replaceUniqueKeys(executor, input);
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

  async updateWhere(
    scope: PluginStorageScope,
    input: UpdatePluginRecordWhereInput
  ): Promise<PluginStoredRecord | null> {
    return this.inContext(scope, async (executor) => {
      const queryPredicates = storageQueryPredicates(input.collection, input.query);
      const [existingRow] = await executor
        .select()
        .from(pluginRecords)
        .where(and(baseRecordWhere(scope, input.collectionName), ...queryPredicates))
        .orderBy(...storageQueryOrderBy(input.collection, input.query))
        .for('update')
        .limit(1);

      if (!existingRow) {
        return null;
      }

      const existing = mapRecord(existingRow);
      const update = input.buildUpdatedData(existing);
      await this.replaceUniqueKeys(executor, {
        pluginId: input.pluginId,
        collectionName: input.collectionName,
        userId: existing.userId,
        scopeType: existing.scopeType,
        scopeId: existing.scopeId,
        id: existing.id,
        data: update.data,
        previousUniqueKeys: update.previousUniqueKeys,
        uniqueKeys: update.uniqueKeys,
      });

      const rows = await executor
        .update(pluginRecords)
        .set({
          data: update.data,
          updatedAt: new Date(),
        })
        .where(and(baseRecordWhere(scope, input.collectionName), eq(pluginRecords.id, existing.id)))
        .returning();

      return rows[0] ? mapRecord(rows[0]) : null;
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

      if (rows[0]) {
        await executor
          .update(pluginRecordUniqueKeys)
          .set({
            deletedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(pluginRecordUniqueKeys.pluginId, scope.pluginId),
              eq(pluginRecordUniqueKeys.collectionName, collectionName),
              eq(pluginRecordUniqueKeys.recordId, id),
              isNull(pluginRecordUniqueKeys.deletedAt)
            )
          );
      }

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
    tables: ['plugin_collections', 'plugin_records', 'plugin_record_unique_keys'],
    rls: ['plugin_id', 'scope_type', 'scope_id'],
    queryMode: 'database-filtered-jsonb',
  };
}
