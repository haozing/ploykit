import type {
  ModuleDataApi,
  ModuleDataDefinition,
  ModuleDataDocument,
  ModuleDataQuery,
  ModuleDataScope,
  ModuleDataSql,
  ModuleDataSqlFragment,
  ModuleDataTable,
  ModuleDataWriteOptions,
  ModuleDocumentDefinition,
  ModuleTableDefinition,
} from '@ploykit/module-sdk';
import type { ModuleRuntimeContract } from '../contract';
import { moduleDataPhysicalTableName, moduleDataPhysicalViewName } from './naming';

type DataRecord = Record<string, unknown>;

export interface ModuleDataPostgresQueryResult<TRecord = DataRecord> {
  rows: TRecord[];
  rowCount?: number | null;
}

export interface ModuleDataPostgresExecutor {
  query<TRecord = DataRecord>(
    text: string,
    values?: readonly unknown[]
  ): Promise<ModuleDataPostgresQueryResult<TRecord>>;
  transaction?<TResult>(
    callback: (tx: ModuleDataPostgresExecutor) => Promise<TResult>
  ): Promise<TResult>;
}

export interface ModuleDataRuntimeSession {
  productId: string;
  workspaceId?: string | null;
  scopeId?: string | null;
  userId?: string | null;
  actorId?: string | null;
  allowPublicWrite?: boolean;
}

export interface CreatePostgresModuleDataApiOptions {
  contract: ModuleRuntimeContract;
  database: ModuleDataPostgresExecutor;
  session: ModuleDataRuntimeSession;
  schema?: string;
  useRlsSession?: boolean;
  wrapOperationsInTransaction?: boolean;
  unsafeAllowRlsBypass?: boolean;
}

interface ResolvedScope {
  type: ModuleDataScope;
  id: string | null;
}

interface RuntimeOptions extends CreatePostgresModuleDataApiOptions {
  inTransaction: boolean;
}

const MANAGED_TABLE_COLUMNS = new Set([
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

const TABLE_META_COLUMNS = new Set(['id', ...MANAGED_TABLE_COLUMNS]);
const DOCUMENT_META_COLUMNS = new Set(['id', ...MANAGED_TABLE_COLUMNS, 'document_name']);
const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

function getDataDefinition(contract: ModuleRuntimeContract): ModuleDataDefinition {
  return contract.definition.data ?? { version: 1 };
}

function quoteIdentifier(identifier: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new Error(`MODULE_DATA_INVALID_IDENTIFIER: ${identifier}`);
  }

  return `"${identifier}"`;
}

function quoteQualified(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function quoteStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function pushValue(values: unknown[], value: unknown): string {
  values.push(value);
  return `$${values.length}`;
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

function resolveScope(
  scope: ModuleDataScope | undefined,
  session: ModuleDataRuntimeSession
): ResolvedScope {
  const scopeType = scope ?? 'user';

  switch (scopeType) {
    case 'user': {
      if (!session.userId) {
        throw new Error(
          'MODULE_DATA_USER_SCOPE_REQUIRED: user-scoped data requires session.userId.'
        );
      }
      return { type: scopeType, id: session.userId };
    }
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

function appendScopeWhere(
  parts: string[],
  values: unknown[],
  moduleId: string,
  session: ModuleDataRuntimeSession,
  scope: ResolvedScope
): void {
  parts.push(`${quoteIdentifier('product_id')} = ${pushValue(values, session.productId)}`);
  parts.push(`${quoteIdentifier('module_id')} = ${pushValue(values, moduleId)}`);
  parts.push(`${quoteIdentifier('scope_type')} = ${pushValue(values, scope.type)}`);

  if (scope.id === null) {
    parts.push(`${quoteIdentifier('scope_id')} is null`);
  } else {
    parts.push(`${quoteIdentifier('scope_id')} = ${pushValue(values, scope.id)}`);
  }
}

function appendDeletedFilter(parts: string[], includeDeleted: boolean): void {
  if (!includeDeleted) {
    parts.push(`${quoteIdentifier('deleted_at')} is null`);
  }
}

function buildOrderBy(
  orderBy: ModuleDataQuery['orderBy'],
  columnExpression: (field: string) => string
): string {
  const entries = Object.entries(orderBy ?? {});
  if (entries.length === 0) {
    return '';
  }

  const fragments = entries.map(([field, direction]) => {
    if (direction !== 'asc' && direction !== 'desc') {
      throw new Error(`MODULE_DATA_INVALID_ORDER_DIRECTION: ${field}`);
    }
    return `${columnExpression(field)} ${direction}`;
  });

  return ` order by ${fragments.join(', ')}`;
}

function buildLimitOffset(query: ModuleDataQuery): string {
  assertLimit('limit', query.limit);
  assertLimit('offset', query.offset);

  let fragment = '';
  if (query.limit !== undefined) {
    fragment += ` limit ${query.limit}`;
  }
  if (query.offset !== undefined) {
    fragment += ` offset ${query.offset}`;
  }
  if (query.lock === 'update') {
    fragment += ' for update';
  }
  return fragment;
}

function rowCount(result: ModuleDataPostgresQueryResult): number {
  return result.rowCount ?? result.rows.length;
}

function resultRows<TRecord>(result: ModuleDataPostgresQueryResult<TRecord>): TRecord[] {
  return result.rows;
}

function assertWriteOptions(options: ModuleDataWriteOptions): readonly string[] {
  if (!options.uniqueBy || options.uniqueBy.length === 0) {
    throw new Error('MODULE_DATA_UNIQUE_BY_REQUIRED: uniqueBy must contain at least one field.');
  }
  return options.uniqueBy;
}

function formatDocumentRow<TRecord>(row: DataRecord): TRecord {
  const data =
    typeof row.data === 'object' && row.data !== null && !Array.isArray(row.data)
      ? (row.data as DataRecord)
      : {};

  return {
    ...data,
    id: row.id,
  } as TRecord;
}

function assertPostgresDataRuntimeSafety(options: CreatePostgresModuleDataApiOptions): void {
  if (options.useRlsSession === false && options.unsafeAllowRlsBypass !== true) {
    throw new Error(
      'MODULE_DATA_RLS_SESSION_DISABLED: disabling Postgres RLS session context requires unsafeAllowRlsBypass=true.'
    );
  }

  if (
    options.wrapOperationsInTransaction === false &&
    options.useRlsSession !== false &&
    options.unsafeAllowRlsBypass !== true
  ) {
    throw new Error(
      'MODULE_DATA_RLS_TRANSACTION_REQUIRED: Postgres RLS session context must run inside transactions unless unsafeAllowRlsBypass=true.'
    );
  }
}

async function applyRlsSession(
  database: ModuleDataPostgresExecutor,
  moduleId: string,
  session: ModuleDataRuntimeSession,
  scope: ResolvedScope | null
): Promise<void> {
  const scopeId =
    scope?.id ?? session.scopeId ?? session.workspaceId ?? session.userId ?? session.productId;
  const settings: readonly (readonly [string, string])[] = [
    ['ploykit.module_id', moduleId],
    ['ploykit.product_id', session.productId],
    ['ploykit.scope_type', scope?.type ?? 'product'],
    ['ploykit.scope_id', scopeId],
    ['ploykit.user_id', session.userId ?? ''],
    ['ploykit.allow_public_write', session.allowPublicWrite ? 'true' : 'false'],
  ];

  for (const [key, value] of settings) {
    await database.query('select set_config($1, $2, true)', [key, value]);
  }
}

class PostgresModuleDataRuntime {
  private readonly data: ModuleDataDefinition;
  private readonly schema: string;
  private readonly useRlsSession: boolean;
  private readonly wrapOperationsInTransaction: boolean;

  constructor(private readonly options: RuntimeOptions) {
    assertPostgresDataRuntimeSafety(options);
    this.data = getDataDefinition(options.contract);
    this.schema = options.schema ?? 'public';
    this.useRlsSession = options.useRlsSession ?? true;
    this.wrapOperationsInTransaction = options.wrapOperationsInTransaction ?? true;
  }

  get moduleId(): string {
    return this.options.contract.id;
  }

  get session(): ModuleDataRuntimeSession {
    return this.options.session;
  }

  createApi(): ModuleDataApi {
    const runtime = this;
    const sqlApi: ModuleDataSql = {
      async query<TRecord = unknown>(statement: ModuleDataSqlFragment): Promise<TRecord[]> {
        return runtime.execute(null, async (database) =>
          resultRows(await database.query<TRecord>(statement.text, statement.values))
        );
      },
      async execute(statement: ModuleDataSqlFragment): Promise<{ rowCount: number }> {
        return runtime.execute(null, async (database) => ({
          rowCount: rowCount(await database.query(statement.text, statement.values)),
        }));
      },
    };

    return {
      document<TRecord = DataRecord>(name: string) {
        return new PostgresDocumentRepository<TRecord>(runtime, name);
      },
      table<TRecord = DataRecord>(name: string) {
        return new PostgresTableRepository<TRecord>(runtime, name);
      },
      transaction<T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> {
        return runtime.transaction(callback);
      },
      tableRef: (name: string) => ({
        text: quoteQualified(this.schema, moduleDataPhysicalTableName(this.moduleId, name)),
        values: [],
      }),
      viewRef: (name: string) => ({
        text: quoteQualified(this.schema, moduleDataPhysicalViewName(this.moduleId, name)),
        values: [],
      }),
      sql: sqlApi,
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

  tableName(name: string): string {
    return quoteQualified(this.schema, moduleDataPhysicalTableName(this.moduleId, name));
  }

  documentsTableName(): string {
    return quoteQualified(this.schema, 'module_documents');
  }

  async execute<TResult>(
    scope: ResolvedScope | null,
    callback: (database: ModuleDataPostgresExecutor) => Promise<TResult>
  ): Promise<TResult> {
    const run = async (database: ModuleDataPostgresExecutor): Promise<TResult> => {
      if (this.useRlsSession) {
        await applyRlsSession(database, this.moduleId, this.session, scope);
      }
      return callback(database);
    };

    if (this.options.inTransaction) {
      return run(this.options.database);
    }

    if (this.wrapOperationsInTransaction) {
      if (!this.options.database.transaction) {
        throw new Error(
          'MODULE_DATA_TRANSACTION_EXECUTOR_REQUIRED: Postgres data runtime needs database.transaction for RLS-safe operations.'
        );
      }
      return this.options.database.transaction(run);
    }

    return run(this.options.database);
  }

  async transaction<T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> {
    if (this.options.inTransaction) {
      return callback(this.createApi());
    }

    if (!this.options.database.transaction) {
      throw new Error(
        'MODULE_DATA_TRANSACTION_UNAVAILABLE: database.transaction is required for ctx.data.transaction.'
      );
    }

    return this.options.database.transaction(async (tx) => {
      const child = new PostgresModuleDataRuntime({
        ...this.options,
        database: tx,
        inTransaction: true,
      });
      return callback(child.createApi());
    });
  }
}

class PostgresDocumentRepository<TRecord> implements ModuleDataDocument<TRecord> {
  private readonly definition: ModuleDocumentDefinition;
  private readonly scope: ResolvedScope;

  constructor(
    private readonly runtime: PostgresModuleDataRuntime,
    private readonly name: string
  ) {
    this.definition = runtime.getDocumentDefinition(name);
    this.scope = resolveScope(this.definition.scope, runtime.session);
  }

  async findMany(query: ModuleDataQuery<TRecord> = {}): Promise<TRecord[]> {
    const values: unknown[] = [];
    const where = this.buildWhere(values, query, false);
    const orderBy = buildOrderBy(query.orderBy, (field) => this.orderExpression(field));
    const limitOffset = buildLimitOffset(query);
    const statement = `select * from ${this.runtime.documentsTableName()} where ${where.join(
      ' and '
    )}${orderBy}${limitOffset}`;

    return this.runtime.execute(this.scope, async (database) =>
      resultRows(await database.query<DataRecord>(statement, values)).map(
        formatDocumentRow<TRecord>
      )
    );
  }

  async findOne(query: ModuleDataQuery<TRecord> = {}): Promise<TRecord | null> {
    return (await this.findMany({ ...query, limit: 1 }))[0] ?? null;
  }

  async findById(id: string): Promise<TRecord | null> {
    return this.findOne({ where: { id } as unknown as Partial<TRecord> });
  }

  async insert(input: Partial<TRecord>): Promise<TRecord> {
    const values: unknown[] = [];
    const data = this.pickDataFields(input);
    const columns = [
      'product_id',
      'module_id',
      'scope_type',
      'scope_id',
      'document_name',
      'data',
      'created_by',
      'updated_by',
    ];
    const placeholders = [
      pushValue(values, this.runtime.session.productId),
      pushValue(values, this.runtime.moduleId),
      pushValue(values, this.scope.type),
      pushValue(values, this.scope.id),
      pushValue(values, this.name),
      `${pushValue(values, JSON.stringify(data))}::jsonb`,
      pushValue(values, this.runtime.session.actorId ?? this.runtime.session.userId ?? null),
      pushValue(values, this.runtime.session.actorId ?? this.runtime.session.userId ?? null),
    ];

    if (Object.prototype.hasOwnProperty.call(input, 'id')) {
      columns.unshift('id');
      placeholders.unshift(pushValue(values, (input as DataRecord).id));
    }

    const statement = `insert into ${this.runtime.documentsTableName()} (${columns
      .map(quoteIdentifier)
      .join(', ')}) values (${placeholders.join(', ')}) returning *`;

    return this.runtime.execute(this.scope, async (database) =>
      formatDocumentRow<TRecord>((await database.query<DataRecord>(statement, values)).rows[0])
    );
  }

  async insertMany(input: readonly Partial<TRecord>[]): Promise<TRecord[]> {
    const rows: TRecord[] = [];
    await this.runtime.transaction(async (tx) => {
      const repository = tx.document<TRecord>(this.name);
      for (const item of input) {
        rows.push(await repository.insert(item));
      }
      return rows;
    });
    return rows;
  }

  async insertIfAbsent(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const uniqueBy = assertWriteOptions(options);
    const existing = await this.findByUnique(input, uniqueBy);
    return existing ?? this.insert(input);
  }

  async upsert(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const uniqueBy = assertWriteOptions(options);
    const existing = await this.findByUnique(input, uniqueBy);
    if (!existing || !(existing as DataRecord).id) {
      return this.insert(input);
    }
    return this.update(String((existing as DataRecord).id), input);
  }

  async update(id: string, input: Partial<TRecord>): Promise<TRecord> {
    const values: unknown[] = [];
    const data = this.pickDataFields(input);
    if (Object.keys(data).length === 0) {
      throw new Error(
        'MODULE_DATA_EMPTY_UPDATE: document update requires at least one data field.'
      );
    }

    const where = this.buildBaseWhere(values, false);
    where.push(`${quoteIdentifier('id')} = ${pushValue(values, id)}`);
    const actor = this.runtime.session.actorId ?? this.runtime.session.userId ?? null;
    const statement = `update ${this.runtime.documentsTableName()} set ${quoteIdentifier(
      'data'
    )} = ${quoteIdentifier('data')} || ${pushValue(values, JSON.stringify(data))}::jsonb,
      ${quoteIdentifier('updated_at')} = now(),
      ${quoteIdentifier('updated_by')} = ${pushValue(values, actor)}
      where ${where.join(' and ')}
      returning *`;

    return this.runtime.execute(this.scope, async (database) => {
      const row = (await database.query<DataRecord>(statement, values)).rows[0];
      if (!row) {
        throw new Error(
          `MODULE_DATA_DOCUMENT_NOT_FOUND: ${this.runtime.moduleId}.${this.name}.${id}`
        );
      }
      return formatDocumentRow<TRecord>(row);
    });
  }

  async updateWhere(query: ModuleDataQuery<TRecord>, input: Partial<TRecord>): Promise<number> {
    const values: unknown[] = [];
    const data = this.pickDataFields(input);
    if (Object.keys(data).length === 0) {
      throw new Error(
        'MODULE_DATA_EMPTY_UPDATE: document update requires at least one data field.'
      );
    }

    const where = this.buildWhere(values, query, false);
    const actor = this.runtime.session.actorId ?? this.runtime.session.userId ?? null;
    const statement = `update ${this.runtime.documentsTableName()} set ${quoteIdentifier(
      'data'
    )} = ${quoteIdentifier('data')} || ${pushValue(values, JSON.stringify(data))}::jsonb,
      ${quoteIdentifier('updated_at')} = now(),
      ${quoteIdentifier('updated_by')} = ${pushValue(values, actor)}
      where ${where.join(' and ')}`;

    return this.runtime.execute(this.scope, async (database) =>
      rowCount(await database.query(statement, values))
    );
  }

  async delete(id: string): Promise<void> {
    const values: unknown[] = [];
    const where = this.buildBaseWhere(values, true);
    where.push(`${quoteIdentifier('id')} = ${pushValue(values, id)}`);
    const statement = `delete from ${this.runtime.documentsTableName()} where ${where.join(' and ')}`;

    await this.runtime.execute(this.scope, async (database) => {
      await database.query(statement, values);
    });
  }

  async claim(query: ModuleDataQuery<TRecord>, patch: Partial<TRecord>): Promise<TRecord | null> {
    return this.runtime.transaction(async (tx) => {
      const repository = tx.document<TRecord>(this.name);
      const record = await repository.findOne({ ...query, lock: 'update' });
      const id = (record as DataRecord | null)?.id;
      return id ? repository.update(String(id), patch) : null;
    });
  }

  async count(query: ModuleDataQuery<TRecord> = {}): Promise<number> {
    const values: unknown[] = [];
    const where = this.buildWhere(values, query, false);
    const statement = `select count(*)::int as count from ${this.runtime.documentsTableName()} where ${where.join(
      ' and '
    )}`;

    return this.runtime.execute(this.scope, async (database) => {
      const row = (await database.query<{ count: number }>(statement, values)).rows[0];
      return Number(row?.count ?? 0);
    });
  }

  async exists(query?: ModuleDataQuery<TRecord>): Promise<boolean> {
    return (await this.count(query)) > 0;
  }

  private buildBaseWhere(values: unknown[], includeDeleted: boolean): string[] {
    const parts: string[] = [];
    appendScopeWhere(parts, values, this.runtime.moduleId, this.runtime.session, this.scope);
    parts.push(`${quoteIdentifier('document_name')} = ${pushValue(values, this.name)}`);
    appendDeletedFilter(parts, includeDeleted);
    return parts;
  }

  private buildWhere(
    values: unknown[],
    query: ModuleDataQuery<TRecord>,
    includeDeleted: boolean
  ): string[] {
    const parts = this.buildBaseWhere(values, includeDeleted);
    const where = assertPlainWhere(query.where);
    const jsonWhere: DataRecord = {};

    for (const [field, value] of Object.entries(where)) {
      if (value === undefined) {
        throw new Error(`MODULE_DATA_UNDEFINED_WHERE: ${this.name}.${field}`);
      }

      if (DOCUMENT_META_COLUMNS.has(field)) {
        parts.push(
          value === null
            ? `${quoteIdentifier(field)} is null`
            : `${quoteIdentifier(field)} = ${pushValue(values, value)}`
        );
        continue;
      }

      this.assertDocumentField(field);
      jsonWhere[field] = value;
    }

    if (Object.keys(jsonWhere).length > 0) {
      parts.push(
        `${quoteIdentifier('data')} @> ${pushValue(values, JSON.stringify(jsonWhere))}::jsonb`
      );
    }

    return parts;
  }

  private orderExpression(field: string): string {
    if (DOCUMENT_META_COLUMNS.has(field)) {
      return quoteIdentifier(field);
    }
    this.assertDocumentField(field);
    return `${quoteIdentifier('data')} ->> ${quoteStringLiteral(field)}`;
  }

  private pickDataFields(input: Partial<TRecord>): DataRecord {
    const data: DataRecord = {};

    for (const [field, value] of Object.entries(input as DataRecord)) {
      if (field === 'id') {
        continue;
      }
      this.assertDocumentField(field);
      if (value !== undefined) {
        data[field] = value;
      }
    }

    return data;
  }

  private assertDocumentField(field: string): void {
    if (!Object.prototype.hasOwnProperty.call(this.definition.fields, field)) {
      throw new Error(
        `MODULE_DATA_DOCUMENT_FIELD_NOT_DECLARED: ${this.runtime.moduleId}.${this.name}.${field}`
      );
    }
  }

  private async findByUnique(
    input: Partial<TRecord>,
    uniqueBy: readonly string[]
  ): Promise<TRecord | null> {
    const where = Object.fromEntries(
      uniqueBy.map((field) => {
        this.assertDocumentField(field);
        return [field, (input as DataRecord)[field]];
      })
    );

    return this.findOne({ where } as ModuleDataQuery<TRecord>);
  }
}

class PostgresTableRepository<TRecord> implements ModuleDataTable<TRecord> {
  private readonly definition: ModuleTableDefinition;
  private readonly scope: ResolvedScope;
  private readonly columnNames: Set<string>;

  constructor(
    private readonly runtime: PostgresModuleDataRuntime,
    private readonly name: string
  ) {
    this.definition = runtime.getTableDefinition(name);
    this.scope = resolveScope(this.definition.scope, runtime.session);
    this.columnNames = new Set(Object.keys(this.definition.columns));
  }

  async findMany(query: ModuleDataQuery<TRecord> = {}): Promise<TRecord[]> {
    const values: unknown[] = [];
    const where = this.buildWhere(values, query, false);
    const orderBy = buildOrderBy(query.orderBy, (field) => this.columnExpression(field));
    const limitOffset = buildLimitOffset(query);
    const statement = `select * from ${this.runtime.tableName(this.name)} where ${where.join(
      ' and '
    )}${orderBy}${limitOffset}`;

    return this.runtime.execute(this.scope, async (database) =>
      resultRows(await database.query<TRecord>(statement, values))
    );
  }

  async findOne(query: ModuleDataQuery<TRecord> = {}): Promise<TRecord | null> {
    return (await this.findMany({ ...query, limit: 1 }))[0] ?? null;
  }

  async findById(id: string): Promise<TRecord | null> {
    return this.findOne({ where: { id } as unknown as Partial<TRecord> });
  }

  async insert(input: Partial<TRecord>): Promise<TRecord> {
    const values: unknown[] = [];
    const record = this.prepareInsertRecord(input);
    const statement = this.buildInsertStatement(values, record, '');

    return this.runtime.execute(this.scope, async (database) =>
      this.requireReturnedRow(await database.query<TRecord>(statement, values), 'insert')
    );
  }

  async insertMany(input: readonly Partial<TRecord>[]): Promise<TRecord[]> {
    const rows: TRecord[] = [];
    await this.runtime.transaction(async (tx) => {
      const repository = tx.table<TRecord>(this.name);
      for (const item of input) {
        rows.push(await repository.insert(item));
      }
      return rows;
    });
    return rows;
  }

  async insertIfAbsent(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const uniqueBy = assertWriteOptions(options);
    uniqueBy.forEach((field) => this.assertWritableOrMetaField(field));

    const values: unknown[] = [];
    const record = this.prepareInsertRecord(input);
    const conflict = ` on conflict (${uniqueBy.map(quoteIdentifier).join(', ')}) do nothing`;
    const statement = this.buildInsertStatement(values, record, conflict);

    return this.runtime.execute(this.scope, async (database) => {
      const result = await database.query<TRecord>(statement, values);
      const inserted = result.rows[0];
      if (inserted) {
        return inserted;
      }
      const existing = await this.findByUniqueOnDatabase(database, input, uniqueBy);
      if (!existing) {
        throw new Error(
          `MODULE_DATA_TABLE_INSERT_IF_ABSENT_MISSED: ${this.runtime.moduleId}.${this.name}`
        );
      }
      return existing;
    });
  }

  async upsert(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const uniqueBy = assertWriteOptions(options);
    uniqueBy.forEach((field) => this.assertWritableOrMetaField(field));

    const values: unknown[] = [];
    const record = this.prepareInsertRecord(input);
    const update = this.pickTablePatch(input);
    const actor = this.runtime.session.actorId ?? this.runtime.session.userId ?? null;
    const updateFragments = Object.keys(update).map(
      (field) => `${quoteIdentifier(field)} = excluded.${quoteIdentifier(field)}`
    );
    updateFragments.push(`${quoteIdentifier('updated_at')} = now()`);
    updateFragments.push(`${quoteIdentifier('updated_by')} = ${pushValue(values, actor)}`);

    const conflict = ` on conflict (${uniqueBy
      .map(quoteIdentifier)
      .join(', ')}) do update set ${updateFragments.join(', ')}`;
    const statement = this.buildInsertStatement(values, record, conflict);

    return this.runtime.execute(this.scope, async (database) =>
      this.requireReturnedRow(await database.query<TRecord>(statement, values), 'upsert')
    );
  }

  async update(id: string, input: Partial<TRecord>): Promise<TRecord> {
    const values: unknown[] = [];
    const where = this.buildBaseWhere(values, false);
    where.push(`${quoteIdentifier('id')} = ${pushValue(values, id)}`);
    const set = this.buildPatchSet(values, input);
    const statement = `update ${this.runtime.tableName(this.name)} set ${set.join(', ')}
      where ${where.join(' and ')}
      returning *`;

    return this.runtime.execute(this.scope, async (database) =>
      this.requireReturnedRow(await database.query<TRecord>(statement, values), 'update')
    );
  }

  async updateWhere(query: ModuleDataQuery<TRecord>, input: Partial<TRecord>): Promise<number> {
    const values: unknown[] = [];
    const where = this.buildWhere(values, query, false);
    const set = this.buildPatchSet(values, input);
    const statement = `update ${this.runtime.tableName(this.name)} set ${set.join(', ')}
      where ${where.join(' and ')}`;

    return this.runtime.execute(this.scope, async (database) =>
      rowCount(await database.query(statement, values))
    );
  }

  async delete(id: string): Promise<void> {
    const values: unknown[] = [];
    const where = this.buildBaseWhere(values, true);
    where.push(`${quoteIdentifier('id')} = ${pushValue(values, id)}`);
    const statement = `delete from ${this.runtime.tableName(this.name)} where ${where.join(' and ')}`;

    await this.runtime.execute(this.scope, async (database) => {
      await database.query(statement, values);
    });
  }

  async count(query: ModuleDataQuery<TRecord> = {}): Promise<number> {
    const values: unknown[] = [];
    const where = this.buildWhere(values, query, false);
    const statement = `select count(*)::int as count from ${this.runtime.tableName(
      this.name
    )} where ${where.join(' and ')}`;

    return this.runtime.execute(this.scope, async (database) => {
      const row = (await database.query<{ count: number }>(statement, values)).rows[0];
      return Number(row?.count ?? 0);
    });
  }

  async exists(query?: ModuleDataQuery<TRecord>): Promise<boolean> {
    return (await this.count(query)) > 0;
  }

  async softDelete(id: string): Promise<TRecord> {
    return this.patchLifecycle(id, {
      deleted_at: new Date(),
    });
  }

  async restore(id: string): Promise<TRecord> {
    return this.patchLifecycle(id, {
      deleted_at: null,
    });
  }

  private buildBaseWhere(values: unknown[], includeDeleted: boolean): string[] {
    const parts: string[] = [];
    appendScopeWhere(parts, values, this.runtime.moduleId, this.runtime.session, this.scope);
    appendDeletedFilter(parts, includeDeleted);
    return parts;
  }

  private buildWhere(
    values: unknown[],
    query: ModuleDataQuery<TRecord>,
    includeDeleted: boolean
  ): string[] {
    const parts = this.buildBaseWhere(values, includeDeleted);
    const where = assertPlainWhere(query.where);

    for (const [field, value] of Object.entries(where)) {
      if (value === undefined) {
        throw new Error(`MODULE_DATA_UNDEFINED_WHERE: ${this.name}.${field}`);
      }
      this.assertReadableField(field);
      parts.push(
        value === null
          ? `${quoteIdentifier(field)} is null`
          : `${quoteIdentifier(field)} = ${pushValue(values, value)}`
      );
    }

    return parts;
  }

  private buildInsertStatement(values: unknown[], record: DataRecord, conflict: string): string {
    const columns = Object.keys(record);
    const placeholders = columns.map((column) => pushValue(values, record[column]));
    return `insert into ${this.runtime.tableName(this.name)} (${columns.map(quoteIdentifier).join(', ')})
      values (${placeholders.join(', ')})${conflict}
      returning *`;
  }

  private prepareInsertRecord(input: Partial<TRecord>): DataRecord {
    for (const field of Object.keys(input as DataRecord)) {
      if (field !== 'id' && !this.columnNames.has(field)) {
        throw new Error(
          `MODULE_DATA_TABLE_FIELD_NOT_DECLARED: ${this.runtime.moduleId}.${this.name}.${field}`
        );
      }
    }

    const actor = this.runtime.session.actorId ?? this.runtime.session.userId ?? null;
    const record: DataRecord = {
      product_id: this.runtime.session.productId,
      module_id: this.runtime.moduleId,
      scope_type: this.scope.type,
      scope_id: this.scope.id,
      created_by: actor,
      updated_by: actor,
    };

    if (Object.prototype.hasOwnProperty.call(input, 'id')) {
      record.id = (input as DataRecord).id;
    }

    for (const field of this.columnNames) {
      const value = (input as DataRecord)[field];
      if (value !== undefined) {
        record[field] = value;
      }
    }

    return record;
  }

  private buildPatchSet(values: unknown[], input: Partial<TRecord>): string[] {
    const patch = this.pickTablePatch(input);
    const actor = this.runtime.session.actorId ?? this.runtime.session.userId ?? null;
    const set = Object.entries(patch).map(
      ([field, value]) => `${quoteIdentifier(field)} = ${pushValue(values, value)}`
    );
    set.push(`${quoteIdentifier('updated_at')} = now()`);
    set.push(`${quoteIdentifier('updated_by')} = ${pushValue(values, actor)}`);
    return set;
  }

  private pickTablePatch(input: Partial<TRecord>): DataRecord {
    const patch: DataRecord = {};

    for (const [field, value] of Object.entries(input as DataRecord)) {
      if (!this.columnNames.has(field)) {
        throw new Error(
          `MODULE_DATA_TABLE_FIELD_NOT_DECLARED: ${this.runtime.moduleId}.${this.name}.${field}`
        );
      }
      if (value !== undefined) {
        patch[field] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      throw new Error('MODULE_DATA_EMPTY_UPDATE: table update requires at least one table column.');
    }

    return patch;
  }

  private columnExpression(field: string): string {
    this.assertReadableField(field);
    return quoteIdentifier(field);
  }

  private assertReadableField(field: string): void {
    if (!TABLE_META_COLUMNS.has(field) && !this.columnNames.has(field)) {
      throw new Error(
        `MODULE_DATA_TABLE_FIELD_NOT_DECLARED: ${this.runtime.moduleId}.${this.name}.${field}`
      );
    }
  }

  private assertWritableOrMetaField(field: string): void {
    if (MANAGED_TABLE_COLUMNS.has(field)) {
      throw new Error(
        `MODULE_DATA_UNIQUE_BY_MANAGED_FIELD: ${this.runtime.moduleId}.${this.name}.${field}`
      );
    }
    this.assertReadableField(field);
  }

  private async findByUnique(
    input: Partial<TRecord>,
    uniqueBy: readonly string[]
  ): Promise<TRecord | null> {
    return this.runtime.execute(this.scope, (database) =>
      this.findByUniqueOnDatabase(database, input, uniqueBy)
    );
  }

  private async findByUniqueOnDatabase(
    database: ModuleDataPostgresExecutor,
    input: Partial<TRecord>,
    uniqueBy: readonly string[]
  ): Promise<TRecord | null> {
    const where = Object.fromEntries(
      uniqueBy.map((field) => {
        this.assertWritableOrMetaField(field);
        return [field, (input as DataRecord)[field]];
      })
    );

    const values: unknown[] = [];
    const parts = this.buildWhere(values, { where } as ModuleDataQuery<TRecord>, false);
    const statement = `select * from ${this.runtime.tableName(this.name)}
      where ${parts.join(' and ')}
      limit 1`;
    return (await database.query<TRecord>(statement, values)).rows[0] ?? null;
  }

  private async patchLifecycle(id: string, patch: DataRecord): Promise<TRecord> {
    const values: unknown[] = [];
    const where = this.buildBaseWhere(values, true);
    where.push(`${quoteIdentifier('id')} = ${pushValue(values, id)}`);
    const actor = this.runtime.session.actorId ?? this.runtime.session.userId ?? null;
    const set = Object.entries(patch).map(
      ([field, value]) => `${quoteIdentifier(field)} = ${pushValue(values, value)}`
    );
    set.push(`${quoteIdentifier('updated_at')} = now()`);
    set.push(`${quoteIdentifier('updated_by')} = ${pushValue(values, actor)}`);

    const statement = `update ${this.runtime.tableName(this.name)} set ${set.join(', ')}
      where ${where.join(' and ')}
      returning *`;

    return this.runtime.execute(this.scope, async (database) =>
      this.requireReturnedRow(await database.query<TRecord>(statement, values), 'lifecycle')
    );
  }

  private requireReturnedRow(
    result: ModuleDataPostgresQueryResult<TRecord>,
    operation: string
  ): TRecord {
    const row = result.rows[0];
    if (!row) {
      throw new Error(
        `MODULE_DATA_TABLE_${operation.toUpperCase()}_MISSED: ${this.runtime.moduleId}.${this.name}`
      );
    }
    return row;
  }
}

export function createPostgresModuleDataApi(
  options: CreatePostgresModuleDataApiOptions
): ModuleDataApi {
  return new PostgresModuleDataRuntime({
    ...options,
    inTransaction: false,
  }).createApi();
}
