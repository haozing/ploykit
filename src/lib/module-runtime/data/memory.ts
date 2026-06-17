import { randomUUID } from 'node:crypto';
import type {
  ModuleDataApi,
  ModuleDataDefinition,
  ModuleDataDocument,
  ModuleDataQuery,
  ModuleDataScope,
  ModuleDataSqlFragment,
  ModuleDataTable,
  ModuleDataWriteOptions,
  ModuleDocumentDefinition,
  ModuleTableDefinition,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import { moduleDataPhysicalTableName, moduleDataPhysicalViewName } from './naming';
import type { ModuleDataRuntimeSession } from './postgres';

type DataRecord = Record<string, unknown> & { id?: string };
type CollectionKind = 'document' | 'table';

export interface MemoryModuleDataStore {
  collections: Map<string, Map<string, DataRecord>>;
}

export interface CreateMemoryModuleDataApiOptions {
  contract: ModuleRuntimeContract;
  session: ModuleDataRuntimeSession;
  store: MemoryModuleDataStore;
  now?: () => Date;
  createId?: () => string;
}

interface ResolvedScope {
  type: ModuleDataScope;
  id: string | null;
}

const MANAGED_COLUMNS = new Set([
  'product_id',
  'module_id',
  'scope_type',
  'scope_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'created_by',
  'updated_by',
]);

const TABLE_META_COLUMNS = new Set(['id', ...MANAGED_COLUMNS]);
const DOCUMENT_META_COLUMNS = new Set(['id', ...MANAGED_COLUMNS, 'document_name']);

function clone<T>(value: T): T {
  if (typeof globalThis.structuredClone === 'function') {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertPlainWhere(where: ModuleDataQuery['where']): DataRecord {
  if (!where) {
    return {};
  }
  if (Array.isArray(where) || typeof where !== 'object') {
    throw new Error('MODULE_DATA_UNSUPPORTED_WHERE: where must be a plain object.');
  }
  return where as DataRecord;
}

function assertLimit(name: 'limit' | 'offset', value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `MODULE_DATA_INVALID_${name.toUpperCase()}: ${name} must be a positive integer.`
    );
  }
}

function assertWriteOptions(options: ModuleDataWriteOptions): readonly string[] {
  if (!options.uniqueBy || options.uniqueBy.length === 0) {
    throw new Error('MODULE_DATA_UNIQUE_BY_REQUIRED: uniqueBy must contain at least one field.');
  }
  return options.uniqueBy;
}

function resolveScope(
  scope: ModuleDataScope | undefined,
  session: ModuleDataRuntimeSession
): ResolvedScope {
  const scopeType = scope ?? 'user';
  switch (scopeType) {
    case 'user':
      if (!session.userId) {
        throw new Error('MODULE_DATA_USER_SCOPE_REQUIRED: user-scoped data requires session.userId.');
      }
      return { type: scopeType, id: session.userId };
    case 'workspace': {
      const scopeId = session.workspaceId ?? session.scopeId;
      if (!scopeId) {
        throw new Error(
          'MODULE_DATA_WORKSPACE_SCOPE_REQUIRED: workspace-scoped data requires session.workspaceId.'
        );
      }
      return { type: scopeType, id: scopeId };
    }
    case 'product':
      return { type: scopeType, id: session.productId };
    case 'public-read':
      return { type: scopeType, id: null };
    case 'system':
      return { type: scopeType, id: session.scopeId ?? 'system' };
    default:
      throw new Error(`MODULE_DATA_SCOPE_UNSUPPORTED: ${String(scopeType)}`);
  }
}

function collectionKey(input: {
  productId: string;
  moduleId: string;
  scope: ResolvedScope;
  kind: CollectionKind;
  name: string;
}): string {
  return [
    input.productId,
    input.moduleId,
    input.scope.type,
    input.scope.id ?? '',
    input.kind,
    input.name,
  ].join('\u001f');
}

function comparable(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left instanceof Date || right instanceof Date) {
    return comparable(left) === comparable(right);
  }
  return Object.is(left, right);
}

function getDataDefinition(contract: ModuleRuntimeContract): ModuleDataDefinition {
  return contract.definition.data ?? { version: 1 };
}

export function createMemoryModuleDataStore(): MemoryModuleDataStore {
  return { collections: new Map() };
}

function cloneCollections(
  collections: Map<string, Map<string, DataRecord>>
): Map<string, Map<string, DataRecord>> {
  return new Map(
    [...collections.entries()].map(([key, records]) => [
      key,
      new Map([...records.entries()].map(([id, record]) => [id, clone(record)])),
    ])
  );
}

class MemoryModuleDataRuntime {
  private readonly data: ModuleDataDefinition;
  private readonly now: () => Date;
  private readonly createId: () => string;

  constructor(private readonly options: CreateMemoryModuleDataApiOptions) {
    this.data = getDataDefinition(options.contract);
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => randomUUID());
  }

  get moduleId(): string {
    return this.options.contract.id;
  }

  get session(): ModuleDataRuntimeSession {
    return this.options.session;
  }

  createApi(): ModuleDataApi {
    return {
      document: <TRecord = DataRecord>(name: string) =>
        new MemoryDataCollection<TRecord>(
          this,
          'document',
          name,
          this.getDocumentDefinition(name)
        ),
      table: <TRecord = DataRecord>(name: string) =>
        new MemoryDataCollection<TRecord>(this, 'table', name, this.getTableDefinition(name)),
      transaction: async <T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> => {
        const snapshot = cloneCollections(this.options.store.collections);
        try {
          return await callback(this.createApi());
        } catch (error) {
          this.options.store.collections = snapshot;
          throw error;
        }
      },
      tableRef: (name: string): ModuleDataSqlFragment => ({
        text: `"${moduleDataPhysicalTableName(this.moduleId, name)}"`,
        values: [],
      }),
      viewRef: (name: string): ModuleDataSqlFragment => ({
        text: `"${moduleDataPhysicalViewName(this.moduleId, name)}"`,
        values: [],
      }),
      sql: {
        async query<TRecord = unknown>(): Promise<TRecord[]> {
          return [];
        },
        async execute(): Promise<{ rowCount: number }> {
          return { rowCount: 0 };
        },
      },
    };
  }

  getDocumentDefinition(name: string): ModuleDocumentDefinition {
    const definition = this.data.documents?.[name];
    if (!definition) {
      throw new Error(`MODULE_DATA_DOCUMENT_NOT_DECLARED: ${this.moduleId}.${name}`);
    }
    return definition;
  }

  getTableDefinition(name: string): ModuleTableDefinition {
    const definition = this.data.tables?.[name];
    if (!definition) {
      throw new Error(`MODULE_DATA_TABLE_NOT_DECLARED: ${this.moduleId}.${name}`);
    }
    return definition;
  }

  getCollection(kind: CollectionKind, name: string, scope: ResolvedScope): Map<string, DataRecord> {
    const key = collectionKey({
      productId: this.session.productId,
      moduleId: this.moduleId,
      scope,
      kind,
      name,
    });
    let collection = this.options.store.collections.get(key);
    if (!collection) {
      collection = new Map();
      this.options.store.collections.set(key, collection);
    }
    return collection;
  }

  nowIso(): string {
    return this.now().toISOString();
  }

  newId(): string {
    return this.createId();
  }
}

class MemoryDataCollection<TRecord>
  implements ModuleDataDocument<TRecord>, ModuleDataTable<TRecord>
{
  private readonly scope: ResolvedScope;
  private readonly declaredFields: Set<string>;
  private readonly metaFields: Set<string>;

  constructor(
    private readonly runtime: MemoryModuleDataRuntime,
    private readonly kind: CollectionKind,
    private readonly name: string,
    private readonly definition: ModuleDocumentDefinition | ModuleTableDefinition
  ) {
    this.scope = resolveScope(definition.scope, runtime.session);
    this.declaredFields =
      kind === 'table'
        ? new Set(Object.keys((definition as ModuleTableDefinition).columns))
        : new Set(Object.keys((definition as ModuleDocumentDefinition).fields));
    this.metaFields = kind === 'table' ? TABLE_META_COLUMNS : DOCUMENT_META_COLUMNS;
  }

  async findMany(query: ModuleDataQuery<TRecord> = {}): Promise<TRecord[]> {
    assertLimit('limit', query.limit);
    assertLimit('offset', query.offset);

    let rows = [...this.collection().values()]
      .filter((record) => record.deleted_at === null || record.deleted_at === undefined)
      .filter((record) => this.matchesWhere(record, query.where));

    for (const [field, direction] of Object.entries(query.orderBy ?? {}).reverse()) {
      this.assertReadableField(field);
      if (direction !== 'asc' && direction !== 'desc') {
        throw new Error(`MODULE_DATA_INVALID_ORDER_DIRECTION: ${field}`);
      }
      rows = rows.sort((left, right) => {
        const compare = comparable(left[field]).localeCompare(comparable(right[field]));
        return direction === 'desc' ? -compare : compare;
      });
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map((record) => clone(record as TRecord));
  }

  async findOne(query: ModuleDataQuery<TRecord> = {}): Promise<TRecord | null> {
    return (await this.findMany({ ...query, limit: 1 }))[0] ?? null;
  }

  async findById(id: string): Promise<TRecord | null> {
    return this.findOne({ where: { id } as Record<string, unknown> });
  }

  async insert(input: Partial<TRecord>): Promise<TRecord> {
    const record = this.prepareInsertRecord(input);
    this.collection().set(String(record.id), record);
    return clone(record as TRecord);
  }

  async insertMany(input: readonly Partial<TRecord>[]): Promise<TRecord[]> {
    const records: TRecord[] = [];
    for (const item of input) {
      records.push(await this.insert(item));
    }
    return records;
  }

  async insertIfAbsent(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const uniqueBy = assertWriteOptions(options);
    uniqueBy.forEach((field) => this.assertUniqueField(field));
    return (await this.findByUnique(input, uniqueBy)) ?? this.insert(input);
  }

  async upsert(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const uniqueBy = assertWriteOptions(options);
    uniqueBy.forEach((field) => this.assertUniqueField(field));
    const existing = await this.findByUnique(input, uniqueBy);
    const id = (existing as DataRecord | null)?.id;
    return id ? this.update(String(id), input) : this.insert(input);
  }

  async update(id: string, input: Partial<TRecord>): Promise<TRecord> {
    const existing = this.collection().get(id);
    if (!existing || existing.deleted_at) {
      throw new Error(`MODULE_DATA_RECORD_NOT_FOUND: ${this.runtime.moduleId}.${this.name}.${id}`);
    }

    const patch = this.pickPatch(input);
    const next = {
      ...existing,
      ...patch,
      id,
      updated_at: this.runtime.nowIso(),
      updated_by: this.actorId(),
    };
    this.collection().set(id, next);
    return clone(next as TRecord);
  }

  async updateWhere(query: ModuleDataQuery<TRecord>, input: Partial<TRecord>): Promise<number> {
    const rows = await this.findMany(query);
    for (const row of rows) {
      const id = (row as DataRecord).id;
      if (id) {
        await this.update(String(id), input);
      }
    }
    return rows.length;
  }

  async delete(id: string): Promise<void> {
    this.collection().delete(id);
  }

  async claim(query: ModuleDataQuery<TRecord>, patch: Partial<TRecord>): Promise<TRecord | null> {
    const record = await this.findOne({ ...query, lock: 'update' });
    const id = (record as DataRecord | null)?.id;
    return id ? this.update(String(id), patch) : null;
  }

  async count(query: ModuleDataQuery<TRecord> = {}): Promise<number> {
    return (await this.findMany(query)).length;
  }

  async exists(query?: ModuleDataQuery<TRecord>): Promise<boolean> {
    return (await this.count(query)) > 0;
  }

  async softDelete(id: string): Promise<TRecord> {
    return this.patchLifecycle(id, { deleted_at: this.runtime.nowIso() });
  }

  async restore(id: string): Promise<TRecord> {
    return this.patchLifecycle(id, { deleted_at: null });
  }

  private collection(): Map<string, DataRecord> {
    return this.runtime.getCollection(this.kind, this.name, this.scope);
  }

  private prepareInsertRecord(input: Partial<TRecord>): DataRecord {
    this.assertWritableFields(input, true);
    const now = this.runtime.nowIso();
    const actor = this.actorId();
    const inputRecord = input as DataRecord;
    const record: DataRecord = {
      id: String(inputRecord.id ?? this.runtime.newId()),
      product_id: this.runtime.session.productId,
      module_id: this.runtime.moduleId,
      scope_type: this.scope.type,
      scope_id: this.scope.id,
      created_at: now,
      updated_at: now,
      deleted_at: null,
      created_by: actor,
      updated_by: actor,
      ...(this.kind === 'document' ? { document_name: this.name } : {}),
    };

    for (const field of this.declaredFields) {
      const value = inputRecord[field];
      if (value !== undefined) {
        record[field] = value;
      }
    }

    return record;
  }

  private pickPatch(input: Partial<TRecord>): DataRecord {
    this.assertWritableFields(input, false);
    const patch: DataRecord = {};
    for (const [field, value] of Object.entries(input as DataRecord)) {
      if (field === 'id') {
        continue;
      }
      if (this.declaredFields.has(field) && value !== undefined) {
        patch[field] = value;
      }
    }
    if (Object.keys(patch).length === 0) {
      throw new Error('MODULE_DATA_EMPTY_UPDATE: update requires at least one data field.');
    }
    return patch;
  }

  private async patchLifecycle(id: string, patch: DataRecord): Promise<TRecord> {
    const existing = this.collection().get(id);
    if (!existing) {
      throw new Error(`MODULE_DATA_RECORD_NOT_FOUND: ${this.runtime.moduleId}.${this.name}.${id}`);
    }
    const next = {
      ...existing,
      ...patch,
      updated_at: this.runtime.nowIso(),
      updated_by: this.actorId(),
    };
    this.collection().set(id, next);
    return clone(next as TRecord);
  }

  private async findByUnique(
    input: Partial<TRecord>,
    uniqueBy: readonly string[]
  ): Promise<TRecord | null> {
    const inputRecord = input as DataRecord;
    const where = Object.fromEntries(uniqueBy.map((field) => [field, inputRecord[field]]));
    return this.findOne({ where } as ModuleDataQuery<TRecord>);
  }

  private matchesWhere(record: DataRecord, whereInput: ModuleDataQuery['where']): boolean {
    const where = assertPlainWhere(whereInput);
    for (const [field, value] of Object.entries(where)) {
      if (value === undefined) {
        throw new Error(`MODULE_DATA_UNDEFINED_WHERE: ${this.name}.${field}`);
      }
      this.assertReadableField(field);
      if (!valuesEqual(record[field], value)) {
        return false;
      }
    }
    return true;
  }

  private assertReadableField(field: string): void {
    if (!this.metaFields.has(field) && !this.declaredFields.has(field)) {
      throw new Error(
        `MODULE_DATA_${this.kind.toUpperCase()}_FIELD_NOT_DECLARED: ${this.runtime.moduleId}.${this.name}.${field}`
      );
    }
  }

  private assertWritableFields(input: Partial<TRecord>, allowId: boolean): void {
    for (const field of Object.keys(input as DataRecord)) {
      if (field === 'id' && allowId) {
        continue;
      }
      if (!this.declaredFields.has(field)) {
        throw new Error(
          `MODULE_DATA_${this.kind.toUpperCase()}_FIELD_NOT_DECLARED: ${this.runtime.moduleId}.${this.name}.${field}`
        );
      }
    }
  }

  private assertUniqueField(field: string): void {
    if (MANAGED_COLUMNS.has(field)) {
      throw new Error(
        `MODULE_DATA_UNIQUE_BY_MANAGED_FIELD: ${this.runtime.moduleId}.${this.name}.${field}`
      );
    }
    this.assertReadableField(field);
  }

  private actorId(): string | null {
    return this.runtime.session.actorId ?? this.runtime.session.userId ?? null;
  }
}

export function createMemoryModuleDataApi(options: CreateMemoryModuleDataApiOptions): ModuleDataApi {
  return new MemoryModuleDataRuntime(options).createApi();
}
