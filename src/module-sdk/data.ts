export type ModuleDataScope = 'user' | 'workspace' | 'product' | 'public-read' | 'system';

export type ModuleDocumentFieldType =
  | 'string'
  | 'string?'
  | 'text'
  | 'text?'
  | 'number'
  | 'number?'
  | 'integer'
  | 'integer?'
  | 'boolean'
  | 'boolean?'
  | 'date'
  | 'date?'
  | 'datetime'
  | 'datetime?'
  | 'json'
  | 'json?';

export interface ModuleDocumentFieldDefinition {
  type: ModuleDocumentFieldType;
  required?: boolean;
  maxLength?: number;
  enum?: readonly string[];
  default?: unknown;
}

export type ModuleDocumentField = ModuleDocumentFieldType | ModuleDocumentFieldDefinition;

export interface ModuleDocumentDefinition {
  scope?: ModuleDataScope;
  fields: Record<string, ModuleDocumentField>;
  indexes?: readonly {
    fields: readonly string[];
    unique?: boolean;
    order?: 'asc' | 'desc';
  }[];
}

export type ModuleColumnKind =
  | 'uuid'
  | 'text'
  | 'integer'
  | 'number'
  | 'boolean'
  | 'jsonb'
  | 'timestamp';

export interface ModuleColumnDefinition {
  kind: ModuleColumnKind;
  nullable?: boolean;
  primaryKey?: boolean;
  default?: unknown;
  defaultRandom?: boolean;
}

export interface ModuleRelationDefinition {
  table: string;
  local: string;
  foreign: string;
  onDelete?: 'cascade' | 'restrict' | 'set-null';
}

export interface ModuleTableDefinition {
  $$type: 'ploykit.data.table';
  scope: ModuleDataScope;
  columns: Record<string, ModuleColumnDefinition>;
  unique?: readonly (readonly string[])[];
  indexes?: readonly (readonly string[])[];
  relations?: Record<string, ModuleRelationDefinition>;
}

export interface ModuleDataViewDefinition {
  source: string;
  fields?: readonly string[];
  where?: Record<string, unknown>;
  scope?: ModuleDataScope;
}

export interface ModuleDataGrantDefinition {
  model: string;
  operations: readonly ('read' | 'write' | 'delete' | 'manage')[];
  roles?: readonly string[];
  entitlements?: readonly string[];
}

export interface ModuleDataCheckDefinition {
  model: string;
  kind: 'rls' | 'schema' | 'metadata' | 'custom';
  description?: string;
}

export interface ModuleDataDefinition {
  version: number;
  standardColumns?: boolean;
  documents?: Record<string, ModuleDocumentDefinition>;
  tables?: Record<string, ModuleTableDefinition>;
  views?: Record<string, ModuleDataViewDefinition>;
  grants?: Record<string, ModuleDataGrantDefinition>;
  checks?: Record<string, ModuleDataCheckDefinition>;
  migrations?: {
    mode: 'generated' | 'sql';
    dir: string;
    owns?: readonly string[];
  };
}

export type ModuleDataOrderDirection = 'asc' | 'desc';

export interface ModuleDataQuery<TRecord = Record<string, unknown>> {
  where?: Partial<TRecord> | Record<string, unknown>;
  orderBy?: Partial<Record<keyof TRecord & string, ModuleDataOrderDirection>>;
  limit?: number;
  offset?: number;
  lock?: 'update';
}

export interface ModuleDataWriteOptions {
  uniqueBy?: readonly string[];
}

export interface ModuleDataDocument<TRecord = Record<string, unknown>> {
  findMany(query?: ModuleDataQuery<TRecord>): Promise<TRecord[]>;
  findOne(query?: ModuleDataQuery<TRecord>): Promise<TRecord | null>;
  findById(id: string): Promise<TRecord | null>;
  insert(input: Partial<TRecord>): Promise<TRecord>;
  insertMany(input: readonly Partial<TRecord>[]): Promise<TRecord[]>;
  insertIfAbsent(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord>;
  upsert(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord>;
  update(id: string, input: Partial<TRecord>): Promise<TRecord>;
  updateWhere(query: ModuleDataQuery<TRecord>, input: Partial<TRecord>): Promise<number>;
  delete(id: string): Promise<void>;
  claim(query: ModuleDataQuery<TRecord>, patch: Partial<TRecord>): Promise<TRecord | null>;
  count(query?: ModuleDataQuery<TRecord>): Promise<number>;
  exists(query?: ModuleDataQuery<TRecord>): Promise<boolean>;
}

export interface ModuleDataTable<TRecord = Record<string, unknown>> extends Omit<
  ModuleDataDocument<TRecord>,
  'claim'
> {
  softDelete(id: string): Promise<TRecord>;
  restore(id: string): Promise<TRecord>;
}

export interface ModuleDataSqlFragment {
  readonly text: string;
  readonly values: readonly unknown[];
}

export interface ModuleDataSql {
  query<T = unknown>(statement: ModuleDataSqlFragment): Promise<T[]>;
  execute(statement: ModuleDataSqlFragment): Promise<{ rowCount: number }>;
}

export interface ModuleDataApi {
  document<TRecord = Record<string, unknown>>(name: string): ModuleDataDocument<TRecord>;
  table<TRecord = Record<string, unknown>>(name: string): ModuleDataTable<TRecord>;
  transaction<T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T>;
  tableRef(name: string): ModuleDataSqlFragment;
  viewRef(name: string): ModuleDataSqlFragment;
  sql: ModuleDataSql;
}

class ColumnBuilder {
  private readonly definition: ModuleColumnDefinition;

  constructor(kind: ModuleColumnKind) {
    this.definition = { kind };
  }

  notNull(): this {
    this.definition.nullable = false;
    return this;
  }

  nullable(): this {
    this.definition.nullable = true;
    return this;
  }

  primaryKey(): this {
    this.definition.primaryKey = true;
    return this;
  }

  default(value: unknown): this {
    this.definition.default = value;
    return this;
  }

  defaultRandom(): this {
    this.definition.defaultRandom = true;
    return this;
  }

  build(): ModuleColumnDefinition {
    return { ...this.definition };
  }
}

type ColumnInput = ColumnBuilder | ModuleColumnDefinition;

function normalizeColumns(
  columns: Record<string, ColumnInput>
): Record<string, ModuleColumnDefinition> {
  return Object.fromEntries(
    Object.entries(columns).map(([key, value]) => [
      key,
      value instanceof ColumnBuilder ? value.build() : value,
    ])
  );
}

export function table(
  definition: Omit<ModuleTableDefinition, '$$type' | 'columns'> & {
    columns: Record<string, ColumnInput>;
  }
): ModuleTableDefinition {
  return {
    ...definition,
    $$type: 'ploykit.data.table',
    columns: normalizeColumns(definition.columns),
  };
}

export function relation(
  tableName: string,
  definition: Omit<ModuleRelationDefinition, 'table'>
): ModuleRelationDefinition {
  return {
    table: tableName,
    ...definition,
  };
}

export const uuid = () => new ColumnBuilder('uuid');
export const text = () => new ColumnBuilder('text');
export const integer = () => new ColumnBuilder('integer');
export const number = () => new ColumnBuilder('number');
export const boolean = () => new ColumnBuilder('boolean');
export const jsonb = () => new ColumnBuilder('jsonb');
export const timestamp = () => new ColumnBuilder('timestamp');

export function sql(strings: TemplateStringsArray, ...values: unknown[]): ModuleDataSqlFragment {
  let textValue = '';
  const flatValues: unknown[] = [];

  strings.forEach((part, index) => {
    textValue += part;
    const value = values[index];
    if (value === undefined) {
      return;
    }

    if (typeof value === 'object' && value !== null && 'text' in value && 'values' in value) {
      const fragment = value as ModuleDataSqlFragment;
      textValue += fragment.text;
      flatValues.push(...fragment.values);
      return;
    }

    flatValues.push(value);
    textValue += `$${flatValues.length}`;
  });

  return { text: textValue, values: flatValues };
}
