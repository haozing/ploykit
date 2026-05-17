import { createHash, randomUUID } from 'crypto';
import {
  PluginError,
  type PluginCollectionDefinition,
  type PluginDataDefinition,
  type PluginStorage,
  type PluginStorageCollection,
  type PluginStorageQuery,
} from '@ploykit/plugin-sdk';
import type { PluginCollectionIndexes, PluginRecordData } from '@/lib/db/schema/plugin-storage';
import { validatePluginRecordData, validatePluginStorageQuery } from './schema';

export interface PluginStorageScope {
  pluginId: string;
  userId?: string;
  system?: boolean;
}

export interface PluginStoredRecord {
  id: string;
  pluginId: string;
  collectionName: string;
  userId: string | null;
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
  data: PluginRecordData;
}

export interface UpdatePluginRecordInput {
  pluginId: string;
  collectionName: string;
  userId: string | null;
  id: string;
  data: PluginRecordData;
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
  update(scope: PluginStorageScope, input: UpdatePluginRecordInput): Promise<PluginStoredRecord>;
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
  system?: boolean;
  data?: PluginDataDefinition;
  repository: PluginStorageRepository;
  enforceRead?: (capability: string) => void;
  enforceWrite?: (capability: string) => void;
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

function ensureScope(scope: PluginStorageScope): void {
  if (!scope.pluginId.trim()) {
    throw createStorageError(
      'PLUGIN_STORAGE_PLUGIN_ID_REQUIRED',
      'Plugin storage requires pluginId.'
    );
  }

  if (!scope.system && !scope.userId) {
    throw createStorageError(
      'PLUGIN_STORAGE_USER_REQUIRED',
      'Plugin storage requires userId outside system context.'
    );
  }
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
    private readonly enforceWritePermission?: (capability: string) => void
  ) {}

  async findMany(query?: PluginStorageQuery): Promise<TRecord[]> {
    ensureScope(this.scope);
    this.enforceRead('findMany');

    validatePluginStorageQuery(this.definition, query, { collectionName: this.name });
    const records = await this.repository.findMany(this.scope, this.name, this.definition, query);
    return records.map((record) => mapRecord(record) as TRecord);
  }

  async findById(id: string): Promise<TRecord | null> {
    ensureScope(this.scope);
    this.enforceRead('findById');

    const record = await this.repository.findById(this.scope, this.name, id);
    return record ? (mapRecord(record) as TRecord) : null;
  }

  async insert(data: Partial<Omit<TRecord, 'id' | 'createdAt' | 'updatedAt'>>): Promise<TRecord> {
    ensureScope(this.scope);
    this.enforceWrite('insert');

    const normalizedData = validatePluginRecordData(
      this.definition,
      data as Record<string, unknown>,
      {
        collectionName: this.name,
      }
    );

    const record = await this.repository.insert(this.scope, {
      id: randomUUID(),
      pluginId: this.scope.pluginId,
      collectionName: this.name,
      userId: this.scope.system ? (this.scope.userId ?? null) : (this.scope.userId ?? null),
      data: normalizedData,
    });

    return mapRecord(record) as TRecord;
  }

  async update(id: string, data: Partial<TRecord>): Promise<TRecord> {
    ensureScope(this.scope);
    this.enforceWrite('update');

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
      id,
      data: mergedData,
    });

    return mapRecord(record) as TRecord;
  }

  async delete(id: string): Promise<void> {
    ensureScope(this.scope);
    this.enforceWrite('delete');

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

  private enforceRead(operation: string): void {
    this.enforceReadPermission?.(`ctx.storage.collection("${this.name}").${operation}`);
  }

  private enforceWrite(operation: string): void {
    this.enforceWritePermission?.(`ctx.storage.collection("${this.name}").${operation}`);
  }
}

class RuntimePluginStorage implements PluginStorage {
  private readonly scope: PluginStorageScope;
  private readonly collections: Record<string, PluginCollectionDefinition>;

  constructor(private readonly options: CreatePluginStorageOptions) {
    this.scope = {
      pluginId: options.pluginId,
      userId: options.userId,
      system: options.system,
    };
    this.collections = options.data?.collections ?? {};
  }

  collection<TRecord extends OutputRecord = OutputRecord>(
    name: string
  ): PluginStorageCollection<TRecord> {
    const definition = this.collections[name];
    if (!definition) {
      throw createStorageError(
        'PLUGIN_STORAGE_COLLECTION_UNKNOWN',
        `Collection "${name}" is not declared by plugin "${this.scope.pluginId}".`,
        { pluginId: this.scope.pluginId, collection: name },
        404
      );
    }

    return new RuntimePluginStorageCollection<TRecord>(
      this.scope,
      name,
      definition,
      this.options.repository,
      this.options.enforceRead,
      this.options.enforceWrite
    );
  }

  async ensureCollections(): Promise<void> {
    ensureScope(this.scope);
    this.options.enforceWrite?.('ctx.storage.ensureCollections');

    for (const [name, definition] of Object.entries(this.collections)) {
      await this.options.repository.ensureCollection({
        pluginId: this.scope.pluginId,
        name,
        schemaVersion: this.options.data?.version ?? 1,
        schemaJson: definition,
        schemaHash: createPluginCollectionSchemaHash(definition),
        indexesJson: definition.indexes ? [...definition.indexes] : [],
      });
    }
  }

  async transaction<T>(fn: (storage: PluginStorage) => Promise<T>): Promise<T> {
    ensureScope(this.scope);
    this.options.enforceWrite?.('ctx.storage.transaction');

    return this.options.repository.transaction(this.scope, async (repository) =>
      fn(
        new RuntimePluginStorage({
          ...this.options,
          repository,
        })
      )
    );
  }
}

export function createPluginStorage(options: CreatePluginStorageOptions): PluginStorage {
  return new RuntimePluginStorage(options);
}
