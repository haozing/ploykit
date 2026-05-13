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

class MemoryPluginStorageRepository implements PluginStorageRepository {
  collections = new Map<string, EnsurePluginCollectionInput>();
  records = new Map<string, PluginStoredRecord>();

  async ensureCollection(input: EnsurePluginCollectionInput): Promise<void> {
    this.collections.set(`${input.pluginId}:${input.name}`, input);
  }

  async findMany(
    scope: PluginStorageScope,
    collectionName: string,
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

  async update(
    scope: PluginStorageScope,
    input: UpdatePluginRecordInput
  ): Promise<PluginStoredRecord> {
    const existing = await this.findById(scope, input.collectionName, input.id);
    if (!existing) {
      throw new Error('record not found');
    }

    const record = {
      ...existing,
      data: input.data,
      updatedAt: new Date(),
    };
    this.records.set(record.id, record);
    return record;
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
    return record;
  }

  async transaction<T>(
    _scope: PluginStorageScope,
    fn: (repository: PluginStorageRepository) => Promise<T>
  ): Promise<T> {
    const snapshot = new Map(this.records);

    try {
      return await fn(this);
    } catch (error) {
      this.records = snapshot;
      throw error;
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
});
