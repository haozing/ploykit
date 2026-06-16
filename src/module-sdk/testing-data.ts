import type {
  ModuleDataApi,
  ModuleDataDocument,
  ModuleDataQuery,
  ModuleDataSqlFragment,
  ModuleDataTable,
  ModuleDataWriteOptions,
} from './data';

type TestingDataRecord = Record<string, unknown> & { id?: string };

function readComparable(value: unknown): string {
  return value instanceof Date ? value.toISOString() : JSON.stringify(value);
}

function matchesWhere(record: TestingDataRecord, where?: Record<string, unknown>): boolean {
  if (!where) {
    return true;
  }

  return Object.entries(where).every(([key, value]) => record[key] === value);
}

class TestingDataCollection<TRecord extends TestingDataRecord>
  implements ModuleDataDocument<TRecord>, ModuleDataTable<TRecord>
{
  private nextId = 1;
  private readonly records = new Map<string, TRecord>();

  async findMany(query: ModuleDataQuery<TRecord> = {}): Promise<TRecord[]> {
    let rows = [...this.records.values()].filter((record) =>
      matchesWhere(record, query.where as Record<string, unknown> | undefined)
    );

    for (const [field, direction] of Object.entries(query.orderBy ?? {}).reverse()) {
      rows = rows.sort((left, right) => {
        const leftValue = readComparable(left[field]);
        const rightValue = readComparable(right[field]);
        return direction === 'desc'
          ? rightValue.localeCompare(leftValue)
          : leftValue.localeCompare(rightValue);
      });
    }

    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map((record) => ({ ...record }));
  }

  async findOne(query?: ModuleDataQuery<TRecord>): Promise<TRecord | null> {
    return (await this.findMany({ ...query, limit: 1 }))[0] ?? null;
  }

  async findById(id: string): Promise<TRecord | null> {
    const record = this.records.get(id);
    return record ? { ...record } : null;
  }

  async insert(input: Partial<TRecord>): Promise<TRecord> {
    const id = String(input.id ?? `test_${this.nextId++}`);
    const record = { ...input, id } as TRecord;
    this.records.set(id, record);
    return { ...record };
  }

  async insertMany(input: readonly Partial<TRecord>[]): Promise<TRecord[]> {
    const records: TRecord[] = [];
    for (const item of input) {
      records.push(await this.insert(item));
    }
    return records;
  }

  async insertIfAbsent(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const existing = await this.findByUnique(input, options);
    return existing ?? this.insert(input);
  }

  async upsert(input: Partial<TRecord>, options: ModuleDataWriteOptions): Promise<TRecord> {
    const existing = await this.findByUnique(input, options);
    if (!existing?.id) {
      return this.insert(input);
    }
    return this.update(existing.id, input);
  }

  async update(id: string, input: Partial<TRecord>): Promise<TRecord> {
    const existing = this.records.get(id);
    if (!existing) {
      throw new Error(`MODULE_TEST_DATA_NOT_FOUND: ${id}`);
    }
    const next = { ...existing, ...input, id } as TRecord;
    this.records.set(id, next);
    return { ...next };
  }

  async updateWhere(query: ModuleDataQuery<TRecord>, input: Partial<TRecord>): Promise<number> {
    const rows = await this.findMany(query);
    for (const row of rows) {
      if (row.id) {
        await this.update(row.id, input);
      }
    }
    return rows.length;
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  async claim(query: ModuleDataQuery<TRecord>, patch: Partial<TRecord>): Promise<TRecord | null> {
    const record = await this.findOne({ ...query, lock: 'update' });
    return record?.id ? this.update(record.id, patch) : null;
  }

  async count(query?: ModuleDataQuery<TRecord>): Promise<number> {
    return (await this.findMany(query)).length;
  }

  async exists(query?: ModuleDataQuery<TRecord>): Promise<boolean> {
    return (await this.count(query)) > 0;
  }

  async softDelete(id: string): Promise<TRecord> {
    return this.update(id, { deleted_at: new Date().toISOString() } as unknown as Partial<TRecord>);
  }

  async restore(id: string): Promise<TRecord> {
    return this.update(id, { deleted_at: null } as unknown as Partial<TRecord>);
  }

  private async findByUnique(
    input: Partial<TRecord>,
    options: ModuleDataWriteOptions
  ): Promise<TRecord | null> {
    if (!options.uniqueBy || options.uniqueBy.length === 0) {
      throw new Error('MODULE_TEST_DATA_UNIQUE_BY_REQUIRED');
    }

    const where = Object.fromEntries(
      options.uniqueBy.map((field) => [field, input[field as keyof TRecord]])
    );
    return this.findOne({ where } as ModuleDataQuery<TRecord>);
  }
}

function moduleDataPhysicalTableName(moduleId: string, tableName: string): string {
  return `mod_${moduleId.replace(/-/g, '_')}__${tableName}`;
}

export function createTestingDataApi(moduleId: string): ModuleDataApi {
  const documents = new Map<string, TestingDataCollection<TestingDataRecord>>();
  const tables = new Map<string, TestingDataCollection<TestingDataRecord>>();
  const getCollection = (
    store: Map<string, TestingDataCollection<TestingDataRecord>>,
    name: string
  ) => {
    let collection = store.get(name);
    if (!collection) {
      collection = new TestingDataCollection();
      store.set(name, collection);
    }
    return collection;
  };
  const tableRef = (name: string): ModuleDataSqlFragment => ({
    text: `"${moduleDataPhysicalTableName(moduleId, name)}"`,
    values: [],
  });
  const viewRef = (name: string): ModuleDataSqlFragment => ({
    text: `"${moduleDataPhysicalTableName(moduleId, name)}_view"`,
    values: [],
  });

  return {
    document<TRecord = Record<string, unknown>>(name: string) {
      return getCollection(documents, name) as unknown as ModuleDataDocument<TRecord>;
    },
    table<TRecord = Record<string, unknown>>(name: string) {
      return getCollection(tables, name) as unknown as ModuleDataTable<TRecord>;
    },
    async transaction<T>(callback: (tx: ModuleDataApi) => Promise<T>): Promise<T> {
      return callback(this);
    },
    tableRef,
    viewRef,
    sql: {
      async query<T = unknown>(): Promise<T[]> {
        return [];
      },
      async execute(): Promise<{ rowCount: number }> {
        return { rowCount: 0 };
      },
    },
  };
}
