import { describe, expect, it } from 'vitest';
import type { PluginCollectionDefinition, PluginStorageQuery } from '@ploykit/plugin-sdk';
import { applyPluginStorageQuery } from '../query';
import { validatePluginRecordData } from '../schema';
import {
  createPluginStorage,
  type EnsurePluginCollectionInput,
  type InsertPluginRecordInput,
  type PluginStorageRepository,
  type PluginStorageScope,
  type PluginStoredRecord,
  type UpdatePluginRecordInput,
  type UpdatePluginRecordWhereInput,
} from '../runtime';

const todoCollection: PluginCollectionDefinition = {
  fields: {
    title: { type: 'string', required: true, maxLength: 20 },
    done: { type: 'boolean', default: false },
    priority: { type: 'integer', default: 0 },
    due_at: 'datetime?',
    tags: 'json?',
  },
};

const claimCollection: PluginCollectionDefinition = {
  fields: {
    job_key: { type: 'string', required: true },
    status: { type: 'string', required: true },
    worker_id: 'string?',
  },
  indexes: [{ fields: ['job_key'], unique: true }],
};

const optionalUniqueCollection: PluginCollectionDefinition = {
  fields: {
    name: { type: 'string', required: true },
    email: 'string?',
  },
  indexes: [{ fields: ['email'], unique: true }],
};

class MemoryPluginStorageRepository implements PluginStorageRepository {
  collections = new Map<string, EnsurePluginCollectionInput>();
  records = new Map<string, PluginStoredRecord>();
  uniqueKeys = new Map<string, string>();

  async ensureCollection(input: EnsurePluginCollectionInput): Promise<void> {
    this.collections.set(`${input.pluginId}:${input.name}`, input);
  }

  async findMany(
    scope: PluginStorageScope,
    collectionName: string,
    _collection: PluginCollectionDefinition,
    query?: PluginStorageQuery
  ): Promise<PluginStoredRecord[]> {
    const scopedRecords = [...this.records.values()].filter((record) =>
      this.matchesScope(record, scope, collectionName)
    );

    return applyPluginStorageQuery(scopedRecords, query);
  }

  async findById(
    scope: PluginStorageScope,
    collectionName: string,
    id: string
  ): Promise<PluginStoredRecord | null> {
    const record = this.records.get(id);
    return record && this.matchesScope(record, scope, collectionName) ? record : null;
  }

  async insert(
    _scope: PluginStorageScope,
    input: InsertPluginRecordInput
  ): Promise<PluginStoredRecord> {
    this.reserveUniqueKeys(input);
    const now = new Date();
    const record: PluginStoredRecord = {
      id: input.id,
      pluginId: input.pluginId,
      collectionName: input.collectionName,
      userId: input.userId,
      data: input.data,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    };

    this.records.set(record.id, record);
    return record;
  }

  async insertIfAbsent(
    _scope: PluginStorageScope,
    input: InsertPluginRecordInput
  ): Promise<{ record: PluginStoredRecord; inserted: boolean }> {
    for (const uniqueKey of input.uniqueKeys ?? []) {
      const existingId = this.uniqueKeys.get(this.uniqueMapKey(input, uniqueKey.key));
      const existing = existingId ? this.records.get(existingId) : undefined;
      if (existing && !existing.deletedAt) {
        return { record: existing, inserted: false };
      }
    }

    return { record: await this.insert(_scope, input), inserted: true };
  }

  async update(
    scope: PluginStorageScope,
    input: UpdatePluginRecordInput
  ): Promise<PluginStoredRecord> {
    const existing = await this.findById(scope, input.collectionName, input.id);
    if (!existing) {
      throw new Error('record not found');
    }

    this.releaseUniqueKeys(input);
    this.reserveUniqueKeys(input);
    const record = {
      ...existing,
      data: input.data,
      updatedAt: new Date(),
    };
    this.records.set(record.id, record);
    return record;
  }

  async updateWhere(
    scope: PluginStorageScope,
    input: UpdatePluginRecordWhereInput
  ): Promise<PluginStoredRecord | null> {
    const records = await this.findMany(scope, input.collectionName, input.collection, input.query);
    const existing = records[0];
    if (!existing) {
      return null;
    }

    const update = input.buildUpdatedData(existing);
    return this.update(scope, {
      pluginId: input.pluginId,
      collectionName: input.collectionName,
      userId: existing.userId,
      id: existing.id,
      data: update.data,
      previousUniqueKeys: update.previousUniqueKeys,
      uniqueKeys: update.uniqueKeys,
    });
  }

  async softDelete(
    scope: PluginStorageScope,
    collectionName: string,
    id: string
  ): Promise<PluginStoredRecord | null> {
    const existing = await this.findById(scope, collectionName, id);
    if (!existing) {
      return null;
    }

    const record = {
      ...existing,
      deletedAt: new Date(),
      updatedAt: new Date(),
    };
    this.records.set(record.id, record);
    this.releaseUniqueKeys({
      pluginId: record.pluginId,
      collectionName,
      userId: record.userId,
      id,
    });
    return record;
  }

  async transaction<T>(
    _scope: PluginStorageScope,
    fn: (repository: PluginStorageRepository) => Promise<T>
  ): Promise<T> {
    const snapshot = new Map(this.records);
    const uniqueSnapshot = new Map(this.uniqueKeys);

    try {
      return await fn(this);
    } catch (error) {
      this.records = snapshot;
      this.uniqueKeys = uniqueSnapshot;
      throw error;
    }
  }

  private uniqueMapKey(input: InsertPluginRecordInput | UpdatePluginRecordInput, key: string) {
    return `${input.pluginId}:${input.collectionName}:${input.userId ?? '__system__'}:${key}`;
  }

  private reserveUniqueKeys(input: InsertPluginRecordInput | UpdatePluginRecordInput): void {
    for (const uniqueKey of input.uniqueKeys ?? []) {
      const key = this.uniqueMapKey(input, uniqueKey.key);
      const existingId = this.uniqueKeys.get(key);
      if (existingId && existingId !== input.id) {
        throw new Error('unique conflict');
      }
    }

    for (const uniqueKey of input.uniqueKeys ?? []) {
      this.uniqueKeys.set(this.uniqueMapKey(input, uniqueKey.key), input.id);
    }
  }

  private releaseUniqueKeys(
    input: Pick<UpdatePluginRecordInput, 'pluginId' | 'collectionName' | 'userId' | 'id'>
  ): void {
    const prefix = `${input.pluginId}:${input.collectionName}:${input.userId ?? '__system__'}:`;
    for (const [key, recordId] of this.uniqueKeys.entries()) {
      if (key.startsWith(prefix) && recordId === input.id) {
        this.uniqueKeys.delete(key);
      }
    }
  }

  private matchesScope(
    record: PluginStoredRecord,
    scope: PluginStorageScope,
    collectionName: string
  ): boolean {
    if (
      record.pluginId !== scope.pluginId ||
      record.collectionName !== collectionName ||
      record.deletedAt
    ) {
      return false;
    }

    if (scope.system) {
      return scope.userId ? record.userId === scope.userId : true;
    }

    return record.userId === scope.userId;
  }
}

describe('plugin storage schema validation', () => {
  it('normalizes defaults and datetime fields on insert', () => {
    const record = validatePluginRecordData(
      todoCollection,
      {
        title: 'Ship storage',
        due_at: new Date('2026-05-08T01:02:03Z'),
      },
      { collectionName: 'todos' }
    );

    expect(record).toMatchObject({
      title: 'Ship storage',
      done: false,
      priority: 0,
      due_at: '2026-05-08T01:02:03.000Z',
    });
  });

  it('rejects unknown fields and invalid declared types', () => {
    expect(() =>
      validatePluginRecordData(
        todoCollection,
        { title: 'x', extra: true },
        { collectionName: 'todos' }
      )
    ).toThrow(/Unknown field "extra"/);

    expect(() =>
      validatePluginRecordData(
        todoCollection,
        { title: 'x', priority: 1.5 },
        { collectionName: 'todos' }
      )
    ).toThrow(/must be an integer/);
  });
});

describe('plugin storage query runtime', () => {
  const records = [
    {
      id: '1',
      pluginId: 'todo',
      collectionName: 'todos',
      userId: 'user-a',
      data: { title: 'Alpha', done: false, priority: 2, tags: ['work'] },
      createdAt: new Date('2026-05-01T00:00:00Z'),
      updatedAt: new Date('2026-05-01T00:00:00Z'),
    },
    {
      id: '2',
      pluginId: 'todo',
      collectionName: 'todos',
      userId: 'user-a',
      data: { title: 'Beta', done: true, priority: 5, tags: ['home'] },
      createdAt: new Date('2026-05-02T00:00:00Z'),
      updatedAt: new Date('2026-05-02T00:00:00Z'),
    },
  ];

  it('applies supported operators, ordering, limit, and offset', () => {
    const result = applyPluginStorageQuery(records, {
      where: {
        title: { startsWith: 'B' },
        priority: { gte: 2 },
        tags: { contains: 'home' },
      },
      orderBy: { priority: 'desc' },
      limit: 1,
      offset: 0,
    });

    expect(result.map((record) => record.id)).toEqual(['2']);
  });
});

describe('plugin storage runtime', () => {
  it('runs configured permission gates for read and write operations', async () => {
    const repository = new MemoryPluginStorageRepository();
    const reads: string[] = [];
    const writes: string[] = [];
    const storage = createPluginStorage({
      pluginId: 'todo',
      userId: 'user-a',
      data: { collections: { todos: todoCollection } },
      repository,
      enforceRead: (capability) => reads.push(capability),
      enforceWrite: (capability) => writes.push(capability),
    });

    await storage.ensureCollections();

    expect(repository.collections.get('todo:todos')?.schemaVersion).toBe(1);
    const inserted = await storage.collection('todos').insert({ title: 'gated todo' });
    await storage.collection('todos').findMany();
    await storage.collection('todos').findById(inserted.id as string);
    await storage.collection('todos').update(inserted.id as string, { done: true });
    await storage.transaction(async (txStorage) => {
      await txStorage.collection('todos').delete(inserted.id as string);
    });

    expect(reads).toEqual([
      'ctx.storage.collection("todos").findMany',
      'ctx.storage.collection("todos").findById',
    ]);
    expect(writes).toEqual([
      'ctx.storage.ensureCollections',
      'ctx.storage.collection("todos").insert',
      'ctx.storage.collection("todos").update',
      'ctx.storage.transaction',
      'ctx.storage.collection("todos").delete',
    ]);
  });

  it('stops before touching the repository when a permission gate rejects', async () => {
    const repository = new MemoryPluginStorageRepository();
    const storage = createPluginStorage({
      pluginId: 'todo',
      userId: 'user-a',
      data: { collections: { todos: todoCollection } },
      repository,
      enforceWrite: () => {
        throw new Error('write denied');
      },
    });

    await expect(storage.collection('todos').insert({ title: 'blocked' })).rejects.toThrow(
      'write denied'
    );
    expect(repository.records.size).toBe(0);
  });

  it('enforces plugin and user isolation at the repository boundary', async () => {
    const repository = new MemoryPluginStorageRepository();
    const storage = createPluginStorage({
      pluginId: 'todo',
      userId: 'user-a',
      data: { collections: { todos: todoCollection } },
      repository,
    });

    await storage.ensureCollections();
    const inserted = await storage.collection('todos').insert({ title: 'private todo' });

    const sameUser = await storage.collection('todos').findById(inserted.id as string);
    const otherUserStorage = createPluginStorage({
      pluginId: 'todo',
      userId: 'user-b',
      data: { collections: { todos: todoCollection } },
      repository,
    });
    const otherPluginStorage = createPluginStorage({
      pluginId: 'notes',
      userId: 'user-a',
      data: { collections: { todos: todoCollection } },
      repository,
    });

    expect(sameUser?.title).toBe('private todo');
    expect(await otherUserStorage.collection('todos').findById(inserted.id as string)).toBeNull();
    expect(await otherPluginStorage.collection('todos').findById(inserted.id as string)).toBeNull();
  });

  it('rolls back storage transactions when the callback fails', async () => {
    const repository = new MemoryPluginStorageRepository();
    const storage = createPluginStorage({
      pluginId: 'todo',
      userId: 'user-a',
      data: { collections: { todos: todoCollection } },
      repository,
    });

    await expect(
      storage.transaction(async (txStorage) => {
        await txStorage.collection('todos').insert({ title: 'rollback me' });
        throw new Error('fail');
      })
    ).rejects.toThrow('fail');

    await expect(storage.collection('todos').findMany()).resolves.toEqual([]);
  });

  it('supports unique insertIfAbsent and atomic claim-style updates', async () => {
    const repository = new MemoryPluginStorageRepository();
    const storage = createPluginStorage({
      pluginId: 'todo',
      userId: 'user-a',
      data: { collections: { claims: claimCollection } },
      repository,
    });

    const first = await storage
      .collection('claims')
      .insertIfAbsent({ job_key: 'job-1', status: 'queued' }, { uniqueBy: ['job_key'] });
    const second = await storage
      .collection('claims')
      .insertIfAbsent({ job_key: 'job-1', status: 'queued' }, { uniqueBy: ['job_key'] });
    const claim = await storage.collection('claims').claim(
      {
        where: { job_key: 'job-1', status: 'queued' },
      },
      { status: 'running', worker_id: 'worker-1' }
    );
    const missed = await storage.collection('claims').claim(
      {
        where: { job_key: 'job-1', status: 'queued' },
      },
      { status: 'running', worker_id: 'worker-2' }
    );

    expect(first.inserted).toBe(true);
    expect(second.inserted).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(claim).toMatchObject({
      claimed: true,
      record: { status: 'running', worker_id: 'worker-1' },
    });
    expect(missed).toEqual({ claimed: false, record: null });
  });

  it('skips automatic unique keys for nullish optional fields', async () => {
    const repository = new MemoryPluginStorageRepository();
    const storage = createPluginStorage({
      pluginId: 'todo',
      userId: 'user-a',
      data: { collections: { contacts: optionalUniqueCollection } },
      repository,
    });

    const first = await storage.collection('contacts').insert({ name: 'A' });
    const second = await storage.collection('contacts').insert({ name: 'B', email: null });

    expect(first.id).not.toBe(second.id);
    expect(await storage.collection('contacts').findMany()).toHaveLength(2);
  });

  it('requires explicit insertIfAbsent unique fields to be present', async () => {
    const repository = new MemoryPluginStorageRepository();
    const storage = createPluginStorage({
      pluginId: 'todo',
      userId: 'user-a',
      data: { collections: { contacts: optionalUniqueCollection } },
      repository,
    });

    await expect(
      storage.collection('contacts').insertIfAbsent({ name: 'A' }, { uniqueBy: ['email'] })
    ).rejects.toMatchObject({
      code: 'PLUGIN_STORAGE_UNIQUE_FIELD_VALUE_REQUIRED',
    });
  });
});
