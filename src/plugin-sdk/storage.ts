export type PluginCollectionFieldBase =
  | 'string'
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'datetime'
  | 'json';

export type PluginCollectionFieldType = PluginCollectionFieldBase | `${PluginCollectionFieldBase}?`;

export interface PluginCollectionFieldDefinition {
  type: PluginCollectionFieldType;
  required?: boolean;
  default?: unknown;
  maxLength?: number;
  enum?: readonly string[];
}

export type PluginCollectionField = PluginCollectionFieldType | PluginCollectionFieldDefinition;

export interface PluginCollectionDefinition {
  fields: Record<string, PluginCollectionField>;
  indexes?: Array<{
    fields: readonly string[];
    unique?: boolean;
    order?: 'asc' | 'desc';
  }>;
}

export interface PluginDataDefinition {
  version?: number;
  collections?: Record<string, PluginCollectionDefinition>;
}

export type PluginStorageScalar = string | number | boolean | null | Date;

export interface PluginStorageFieldOperators {
  eq?: PluginStorageScalar;
  ne?: PluginStorageScalar;
  in?: readonly PluginStorageScalar[];
  contains?: string | number | boolean;
  gt?: PluginStorageScalar;
  gte?: PluginStorageScalar;
  lt?: PluginStorageScalar;
  lte?: PluginStorageScalar;
  startsWith?: string;
}

export type PluginStorageFilterValue = PluginStorageScalar | PluginStorageFieldOperators;

export interface PluginStorageQuery {
  where?: Record<string, PluginStorageFilterValue>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  limit?: number;
  offset?: number;
}

export interface PluginStorageCollection<
  TRecord extends Record<string, unknown> = Record<string, unknown>,
> {
  findMany(query?: PluginStorageQuery): Promise<TRecord[]>;
  findById(id: string): Promise<TRecord | null>;
  insert(data: Partial<Omit<TRecord, 'id' | 'createdAt' | 'updatedAt'>>): Promise<TRecord>;
  update(id: string, data: Partial<TRecord>): Promise<TRecord>;
  delete(id: string): Promise<void>;
}

export interface PluginStorage {
  collection<TRecord extends Record<string, unknown> = Record<string, unknown>>(
    name: string
  ): PluginStorageCollection<TRecord>;
  ensureCollections(): Promise<void>;
  transaction<T>(fn: (storage: PluginStorage) => Promise<T>): Promise<T>;
}
