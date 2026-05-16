import { defineApi, z } from '@ploykit/plugin-sdk';

const COLLECTION = 'host_capability_lab_checks';

const storageProbeInputSchema = z.object({
  source: z.string().max(80).optional(),
});

interface LabCheckRecord extends Record<string, unknown> {
  id: string;
  title: string;
  status: 'queued' | 'ready' | 'archived';
  sequence: number;
  score: number;
  active: boolean;
  tags: string[];
  optional_note?: string | null;
  checked_at: string;
  createdAt: Date;
  updatedAt: Date;
}

function recordPreview(record: LabCheckRecord) {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    sequence: record.sequence,
    active: record.active,
    tags: record.tags,
    optional_note: record.optional_note ?? null,
  };
}

export default defineApi({
  async get(ctx) {
    const records = await ctx.storage.collection<LabCheckRecord>(COLLECTION).findMany({
      orderBy: { sequence: 'desc' },
      limit: 8,
    });

    return ctx.json({
      ok: true,
      userId: ctx.user?.id ?? null,
      records: records.map(recordPreview),
    });
  },

  async post(ctx) {
    const input = await ctx.request.json(storageProbeInputSchema);
    const seed = `${Date.now()}`;
    const baseSequence = Number(seed.slice(-8));

    await ctx.storage.ensureCollections();

    const collection = ctx.storage.collection<LabCheckRecord>(COLLECTION);
    const inserted = await collection.insert({
      title: `Browser probe ${seed}`,
      status: 'queued',
      sequence: baseSequence,
      score: 98.5,
      active: true,
      tags: ['host-page', 'storage', input.source ?? 'browser'],
      optional_note: 'created before update',
      checked_at: new Date().toISOString(),
    });
    const updated = await collection.update(inserted.id, {
      status: 'ready',
      optional_note: null,
      score: 100,
    });
    const readBack = await collection.findById(updated.id);

    const transactional = await ctx.storage.transaction(async (transactionalStorage) => {
      return transactionalStorage.collection<LabCheckRecord>(COLLECTION).insert({
        title: `Transaction probe ${seed}`,
        status: 'ready',
        sequence: baseSequence + 1,
        score: 99,
        active: true,
        tags: ['transaction', 'storage'],
        optional_note: 'written inside ctx.storage.transaction',
        checked_at: new Date().toISOString(),
      });
    });

    const disposable = await collection.insert({
      title: `Delete probe ${seed}`,
      status: 'archived',
      sequence: baseSequence + 2,
      score: 1,
      active: false,
      tags: ['delete'],
      optional_note: 'this record should be soft deleted',
      checked_at: new Date().toISOString(),
    });
    await collection.delete(disposable.id);
    const deletedReadBack = await collection.findById(disposable.id);

    const [statusRows, nullRows, inRows, startsWithRows, containsRows] = await Promise.all([
      collection.findMany({
        where: { status: 'ready', active: true },
        orderBy: { sequence: 'desc' },
        limit: 10,
      }),
      collection.findMany({
        where: { optional_note: { eq: null } },
        orderBy: { sequence: 'desc' },
        limit: 10,
      }),
      collection.findMany({
        where: { status: { in: ['ready', 'queued'] } },
        orderBy: { sequence: 'desc' },
        limit: 10,
      }),
      collection.findMany({
        where: { title: { startsWith: 'Browser probe' } },
        orderBy: { sequence: 'desc' },
        limit: 10,
      }),
      collection.findMany({
        where: { tags: { contains: 'host-page' } },
        orderBy: { sequence: 'desc' },
        limit: 10,
      }),
    ]);

    return ctx.json({
      ok: true,
      seed,
      userId: ctx.user?.id ?? null,
      summary: {
        insertedId: inserted.id,
        updatedStatus: updated.status,
        readBackOk: readBack?.id === inserted.id && readBack.status === 'ready',
        transactionId: transactional.id,
        deletedGone: deletedReadBack === null,
        statusFilterCount: statusRows.length,
        nullFilterCount: nullRows.length,
        inFilterCount: inRows.length,
        startsWithCount: startsWithRows.length,
        containsCount: containsRows.length,
        queryMode: 'database-filtered-jsonb',
      },
      records: statusRows.slice(0, 5).map(recordPreview),
    });
  },
});
