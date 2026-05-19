import { createHash, randomUUID } from 'crypto';
import {
  PluginError,
  type PluginCollectionDefinition,
  type PluginDataDefinition,
  type PluginStorage,
  type PluginStorageCollection,
  type PluginStorageClaimResult,
  type PluginStorageInsertIfAbsentResult,
  type PluginStorageInsertOptions,
  type PluginStorageQuery,
  type PluginStorageScopeInput,
} from '@ploykit/plugin-sdk';
import type { PluginCollectionIndexes, PluginRecordData } from '@/lib/db/schema/plugin-storage';
import { validatePluginRecordData, validatePluginStorageQuery } from './schema';

export interface PluginStorageScope {
  pluginId: string;
  userId?: string;
  scopeType: 'user' | 'workspace' | 'plugin' | 'product';
  scopeId: string;
  system?: boolean;
}

export type PluginStorageScopeAccessAction = 'read' | 'write' | 'delete';

export interface PluginStoredRecord {
  id: string;
  pluginId: string;
  collectionName: string;
  userId: string | null;
  scopeType: PluginStorageScope['scopeType'];
  scopeId: string;
  data: PluginRecordData;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date | null;
}

export interface EnsurePluginCollectionInput {
  pluginId: string;
  name: string;
  schemaVersion: number;
  schemaJson: PluginCollectionDefinition;
  schemaHash: string;
  indexesJson: PluginCollectionIndexes;
}

export interface InsertPluginRecordInput {
  id: string;
  pluginId: string;
  collectionName: string;
  userId: string | null;
  scopeType: PluginStorageScope['scopeType'];
  scopeId: string;
  data: PluginRecordData;
  uniqueKeys?: PluginRecordUniqueKeyInput[];
}

export interface UpdatePluginRecordInput {
  pluginId: string;
  collectionName: string;
  userId: string | null;
  scopeType: PluginStorageScope['scopeType'];
  scopeId: string;
  id: string;
  data: PluginRecordData;
  previousUniqueKeys?: PluginRecordUniqueKeyInput[];
  uniqueKeys?: PluginRecordUniqueKeyInput[];
}

export interface UpdatePluginRecordWhereInput {
  pluginId: string;
  collectionName: string;
  collection: PluginCollectionDefinition;
  userId: string | null;
  scopeType: PluginStorageScope['scopeType'];
  scopeId: string;
  query: PluginStorageQuery;
  data: PluginRecordData;
  buildUpdatedData: (record: PluginStoredRecord) => {
    data: PluginRecordData;
    previousUniqueKeys: PluginRecordUniqueKeyInput[];
    uniqueKeys: PluginRecordUniqueKeyInput[];
  };
}

export interface PluginRecordUniqueKeyInput {
  key: string;
  fields: string[];
}

export interface PluginStorageRepository {
  ensureCollection(input: EnsurePluginCollectionInput): Promise<void>;
  findMany(
    scope: PluginStorageScope,
    collectionName: string,
    collection: PluginCollectionDefinition,
    query?: PluginStorageQuery
  ): Promise<PluginStoredRecord[]>;
  findById(
    scope: PluginStorageScope,
    collectionName: string,
    id: string
  ): Promise<PluginStoredRecord | null>;
  insert(scope: PluginStorageScope, input: InsertPluginRecordInput): Promise<PluginStoredRecord>;
  insertIfAbsent(
    scope: PluginStorageScope,
    input: InsertPluginRecordInput
  ): Promise<PluginStorageInsertIfAbsentResult<PluginStoredRecord>>;
  update(scope: PluginStorageScope, input: UpdatePluginRecordInput): Promise<PluginStoredRecord>;
  updateWhere(
    scope: PluginStorageScope,
    input: UpdatePluginRecordWhereInput
  ): Promise<PluginStoredRecord | null>;
  softDelete(
    scope: PluginStorageScope,
    collectionName: string,
    id: string
  ): Promise<PluginStoredRecord | null>;
  transaction<T>(
    scope: PluginStorageScope,
    fn: (repository: PluginStorageRepository) => Promise<T>
  ): Promise<T>;
}

export interface CreatePluginStorageOptions {
  pluginId: string;
  userId?: string;
  productId?: string;
  system?: boolean;
  scope?: PluginStorageScope;
  data?: PluginDataDefinition;
  repository: PluginStorageRepository;
  enforceRead?: (capability: string) => void;
  enforceWrite?: (capability: string) => void;
  authorizeScope?: (
    scope: PluginStorageScope,
    action: PluginStorageScopeAccessAction,
    capability: string
  ) => Promise<void> | void;
}

type OutputRecord = Record<string, unknown>;

function createStorageError(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  statusCode = 400
): PluginError {
  return new PluginError({
    code,
    message,
    statusCode,
    details,
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left.localeCompare(right)
  );

  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(',')}}`;
}

function uniqueIndexes(collection: PluginCollectionDefinition): string[][] {
  return (collection.indexes ?? [])
    .filter((index) => index.unique)
    .map((index) => [...index.fields]);
}

function sameFields(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function assertDeclaredUniqueIndex(
  collection: PluginCollectionDefinition,
  fields: readonly string[],
  collectionName: string
): void {
  if (fields.length === 0) {
    throw createStorageError(
      'PLUGIN_STORAGE_UNIQUE_FIELDS_REQUIRED',
      `Collection "${collectionName}" unique operation requires at least one field.`,
      { collection: collectionName }
    );
  }

  for (const field of fields) {
    if (!collection.fields[field]) {
      throw createStorageError(
        'PLUGIN_STORAGE_UNIQUE_FIELD_UNKNOWN',
        `Collection "${collectionName}" does not declare unique field "${field}".`,
        { collection: collectionName, field }
      );
    }
  }

  if (!uniqueIndexes(collection).some((indexFields) => sameFields(indexFields, fields))) {
    throw createStorageError(
      'PLUGIN_STORAGE_UNIQUE_INDEX_UNDECLARED',
      `Collection "${collectionName}" must declare a matching unique index before using unique writes.`,
      { collection: collectionName, fields }
    );
  }
}

function buildUniqueKey(
  fields: readonly string[],
  data: PluginRecordData,
  options: { requireValues: boolean },
  collectionName: string
): PluginRecordUniqueKeyInput | null {
  const missingField = fields.find((field) => data[field] === undefined || data[field] === null);
  if (missingField) {
    if (options.requireValues) {
      throw createStorageError(
        'PLUGIN_STORAGE_UNIQUE_FIELD_VALUE_REQUIRED',
        `Collection "${collectionName}" unique operation requires field "${missingField}" to be present and non-null.`,
        { collection: collectionName, field: missingField }
      );
    }
    return null;
  }

  const values = fields.map((field) => [field, data[field]] as const);
  const key = createHash('sha256').update(stableStringify(values)).digest('hex');
  return { key, fields: [...fields] };
}

function buildUniqueKeys(
  collection: PluginCollectionDefinition,
  data: PluginRecordData,
  collectionName: string,
  uniqueBy?: readonly string[],
  options: { requireValues?: boolean } = {}
): PluginRecordUniqueKeyInput[] {
  const indexes = uniqueBy ? [uniqueBy] : uniqueIndexes(collection);
  return indexes.flatMap((fields) => {
    assertDeclaredUniqueIndex(collection, fields, collectionName);
    const uniqueKey = buildUniqueKey(
      fields,
      data,
      {
        requireValues: Boolean(options.requireValues),
      },
      collectionName
    );
    return uniqueKey ? [uniqueKey] : [];
  });
}

export function createPluginCollectionSchemaHash(collection: PluginCollectionDefinition): string {
  return createHash('sha256').update(stableStringify(collection)).digest('hex');
}

function mapRecord(record: PluginStoredRecord): OutputRecord {
  return {
    id: record.id,
    ...record.data,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function recordUserId(scope: PluginStorageScope): string | null {
  return scope.scopeType === 'user' ? scope.scopeId : (scope.userId ?? null);
}

function ensureScope(scope: PluginStorageScope): void {
  if (!scope.pluginId.trim()) {
    throw createStorageError(
      'PLUGIN_STORAGE_PLUGIN_ID_REQUIRED',
      'Plugin storage requires pluginId.'
    );
  }

  if (!scope.scopeType || !scope.scopeId.trim()) {
    throw createStorageError(
      'PLUGIN_STORAGE_SCOPE_REQUIRED',
      'Plugin storage requires a concrete scope.'
    );
  }

  if (scope.scopeType === 'user' && !scope.userId && !scope.system) {
    throw createStorageError(
      'PLUGIN_STORAGE_USER_REQUIRED',
      'User-scoped plugin storage requires userId outside system context.'
    );
  }
}

function resolveDefaultScope(options: CreatePluginStorageOptions): PluginStorageScope {
  if (options.scope) {
    return options.scope;
  }

  if (options.userId) {
    return {
      pluginId: options.pluginId,
      userId: options.userId,
      scopeType: 'user',
      scopeId: options.userId,
      system: options.system,
    };
  }

  return {
    pluginId: options.pluginId,
    userId: options.userId,
    scopeType: 'plugin',
    scopeId: options.pluginId,
    system: options.system,
  };
}

function resolveStorageScope(
  current: PluginStorageScope,
  input: PluginStorageScopeInput,
  productId?: string
): PluginStorageScope {
  if (input.type === 'user') {
    const id = input.id ?? current.userId;
    if (!id) {
      throw createStorageError(
        'PLUGIN_STORAGE_USER_REQUIRED',
        'User-scoped plugin storage requires a user id.'
      );
    }
    return {
      pluginId: current.pluginId,
      userId: current.userId,
      scopeType: 'user',
      scopeId: id,
      system: current.system,
    };
  }

  if (input.type === 'workspace') {
    return {
      pluginId: current.pluginId,
      userId: current.userId,
      scopeType: 'workspace',
      scopeId: input.id,
      system: current.system,
    };
  }

  if (input.type === 'plugin') {
    return {
      pluginId: current.pluginId,
      userId: current.userId,
      scopeType: 'plugin',
      scopeId: input.id ?? current.pluginId,
      system: current.system,
    };
  }

  return {
    pluginId: current.pluginId,
    userId: current.userId,
    scopeType: 'product',
    scopeId: input.id ?? productId ?? 'default',
    system: current.system,
  };
}

class RuntimePluginStorageCollection<
  TRecord extends OutputRecord,
> implements PluginStorageCollection<TRecord> {
  constructor(
    private readonly scope: PluginStorageScope,
    private readonly name: string,
    private readonly definition: PluginCollectionDefinition,
    private readonly repository: PluginStorageRepository,
    private readonly enforceReadPermission?: (capability: string) => void,
    private readonly enforceWritePermission?: (capability: string) => void,
    private readonly authorizeScope?: CreatePluginStorageOptions['authorizeScope']
  ) {}

  async findMany(query?: PluginStorageQuery): Promise<TRecord[]> {
    ensureScope(this.scope);
    const capability = this.capability('findMany');
    this.enforceRead(capability);
    await this.authorize('read', capability);

    validatePluginStorageQuery(this.definition, query, { collectionName: this.name });
    const records = await this.repository.findMany(this.scope, this.name, this.definition, query);
    return records.map((record) => mapRecord(record) as TRecord);
  }

  async findById(id: string): Promise<TRecord | null> {
    ensureScope(this.scope);
    const capability = this.capability('findById');
    this.enforceRead(capability);
    await this.authorize('read', capability);

    const record = await this.repository.findById(this.scope, this.name, id);
    return record ? (mapRecord(record) as TRecord) : null;
  }

  async insert(
    data: Partial<Omit<TRecord, 'id' | 'createdAt' | 'updatedAt'>>,
    options: PluginStorageInsertOptions = {}
  ): Promise<TRecord> {
    ensureScope(this.scope);
    const capability = this.capability('insert');
    this.enforceWrite(capability);
    await this.authorize('write', capability);

    const normalizedData = validatePluginRecordData(
      this.definition,
      data as Record<string, unknown>,
      {
        collectionName: this.name,
      }
    );

    const record = await this.repository.insert(this.scope, {
      id: options.id ?? randomUUID(),
      pluginId: this.scope.pluginId,
      collectionName: this.name,
      userId: recordUserId(this.scope),
      scopeType: this.scope.scopeType,
      scopeId: this.scope.scopeId,
      data: normalizedData,
      uniqueKeys: buildUniqueKeys(this.definition, normalizedData, this.name, options.uniqueBy, {
        requireValues: Boolean(options.uniqueBy),
      }),
    });

    return mapRecord(record) as TRecord;
  }

  async insertIfAbsent(
    data: Partial<Omit<TRecord, 'id' | 'createdAt' | 'updatedAt'>>,
    options: Omit<PluginStorageInsertOptions, 'conflict'> & { uniqueBy: readonly string[] }
  ): Promise<PluginStorageInsertIfAbsentResult<TRecord>> {
    ensureScope(this.scope);
    const capability = this.capability('insertIfAbsent');
    this.enforceWrite(capability);
    await this.authorize('write', capability);

    const normalizedData = validatePluginRecordData(
      this.definition,
      data as Record<string, unknown>,
      {
        collectionName: this.name,
      }
    );

    const result = await this.repository.insertIfAbsent(this.scope, {
      id: options.id ?? randomUUID(),
      pluginId: this.scope.pluginId,
      collectionName: this.name,
      userId: recordUserId(this.scope),
      scopeType: this.scope.scopeType,
      scopeId: this.scope.scopeId,
      data: normalizedData,
      uniqueKeys: buildUniqueKeys(this.definition, normalizedData, this.name, options.uniqueBy, {
        requireValues: true,
      }),
    });

    return {
      record: mapRecord(result.record) as TRecord,
      inserted: result.inserted,
    };
  }

  async update(id: string, data: Partial<TRecord>): Promise<TRecord> {
    ensureScope(this.scope);
    const capability = this.capability('update');
    this.enforceWrite(capability);
    await this.authorize('write', capability);

    const existing = await this.repository.findById(this.scope, this.name, id);
    if (!existing) {
      throw createStorageError(
        'PLUGIN_STORAGE_RECORD_NOT_FOUND',
        `Record "${id}" was not found in collection "${this.name}".`,
        { collection: this.name, id },
        404
      );
    }

    const normalizedPatch = validatePluginRecordData(
      this.definition,
      data as Record<string, unknown>,
      {
        collectionName: this.name,
        partial: true,
      }
    );
    const mergedData = {
      ...existing.data,
      ...normalizedPatch,
    };

    const record = await this.repository.update(this.scope, {
      pluginId: this.scope.pluginId,
      collectionName: this.name,
      userId: existing.userId,
      scopeType: existing.scopeType,
      scopeId: existing.scopeId,
      id,
      data: mergedData,
      previousUniqueKeys: buildUniqueKeys(this.definition, existing.data, this.name),
      uniqueKeys: buildUniqueKeys(this.definition, mergedData, this.name),
    });

    return mapRecord(record) as TRecord;
  }

  async updateWhere(query: PluginStorageQuery, data: Partial<TRecord>): Promise<TRecord | null> {
    ensureScope(this.scope);
    const capability = this.capability('updateWhere');
    this.enforceWrite(capability);
    await this.authorize('write', capability);
    validatePluginStorageQuery(this.definition, query, { collectionName: this.name });

    const normalizedPatch = validatePluginRecordData(
      this.definition,
      data as Record<string, unknown>,
      {
        collectionName: this.name,
        partial: true,
      }
    );

    const record = await this.repository.updateWhere(this.scope, {
      pluginId: this.scope.pluginId,
      collectionName: this.name,
      collection: this.definition,
      userId: recordUserId(this.scope),
      scopeType: this.scope.scopeType,
      scopeId: this.scope.scopeId,
      query,
      data: normalizedPatch,
      buildUpdatedData: (existing) => {
        const mergedData = {
          ...existing.data,
          ...normalizedPatch,
        };
        return {
          data: mergedData,
          previousUniqueKeys: buildUniqueKeys(this.definition, existing.data, this.name),
          uniqueKeys: buildUniqueKeys(this.definition, mergedData, this.name),
        };
      },
    });

    return record ? (mapRecord(record) as TRecord) : null;
  }

  async claim(
    query: PluginStorageQuery,
    data: Partial<TRecord>
  ): Promise<PluginStorageClaimResult<TRecord>> {
    const record = await this.updateWhere(query, data);
    return {
      record,
      claimed: Boolean(record),
    };
  }

  async delete(id: string): Promise<void> {
    ensureScope(this.scope);
    const capability = this.capability('delete');
    this.enforceWrite(capability);
    await this.authorize('delete', capability);

    const deleted = await this.repository.softDelete(this.scope, this.name, id);
    if (!deleted) {
      throw createStorageError(
        'PLUGIN_STORAGE_RECORD_NOT_FOUND',
        `Record "${id}" was not found in collection "${this.name}".`,
        { collection: this.name, id },
        404
      );
    }
  }

  private capability(operation: string): string {
    return `ctx.storage.collection("${this.name}").${operation}`;
  }

  private enforceRead(capability: string): void {
    this.enforceReadPermission?.(capability);
  }

  private enforceWrite(capability: string): void {
    this.enforceWritePermission?.(capability);
  }

  private async authorize(
    action: PluginStorageScopeAccessAction,
    capability: string
  ): Promise<void> {
    await this.authorizeScope?.(this.scope, action, capability);
  }
}

class RuntimePluginStorage implements PluginStorage {
  private readonly currentScope: PluginStorageScope;
  private readonly collections: Record<string, PluginCollectionDefinition>;

  constructor(private readonly options: CreatePluginStorageOptions) {
    this.currentScope = resolveDefaultScope(options);
    this.collections = options.data?.collections ?? {};
  }

  collection<TRecord extends OutputRecord = OutputRecord>(
    name: string
  ): PluginStorageCollection<TRecord> {
    const definition = this.collections[name];
    if (!definition) {
      throw createStorageError(
        'PLUGIN_STORAGE_COLLECTION_UNKNOWN',
        `Collection "${name}" is not declared by plugin "${this.currentScope.pluginId}".`,
        { pluginId: this.currentScope.pluginId, collection: name },
        404
      );
    }

    return new RuntimePluginStorageCollection<TRecord>(
      this.currentScope,
      name,
      definition,
      this.options.repository,
      this.options.enforceRead,
      this.options.enforceWrite,
      this.options.authorizeScope
    );
  }

  scope(scopeInput: PluginStorageScopeInput): PluginStorage {
    return new RuntimePluginStorage({
      ...this.options,
      scope: resolveStorageScope(this.currentScope, scopeInput, this.options.productId),
    });
  }

  async ensureCollections(): Promise<void> {
    ensureScope(this.currentScope);
    this.options.enforceWrite?.('ctx.storage.ensureCollections');

    for (const [name, definition] of Object.entries(this.collections)) {
      await this.options.repository.ensureCollection({
        pluginId: this.currentScope.pluginId,
        name,
        schemaVersion: this.options.data?.version ?? 1,
        schemaJson: definition,
        schemaHash: createPluginCollectionSchemaHash(definition),
        indexesJson: definition.indexes ? [...definition.indexes] : [],
      });
    }
  }

  async transaction<T>(fn: (storage: PluginStorage) => Promise<T>): Promise<T> {
    ensureScope(this.currentScope);
    this.options.enforceWrite?.('ctx.storage.transaction');

    return this.options.repository.transaction(this.currentScope, async (repository) =>
      fn(
        new RuntimePluginStorage({
          ...this.options,
          repository,
          scope: this.currentScope,
        })
      )
    );
  }
}

export function createPluginStorage(options: CreatePluginStorageOptions): PluginStorage {
  return new RuntimePluginStorage(options);
}
