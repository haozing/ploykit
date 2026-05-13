import { eq } from 'drizzle-orm';
import { env } from '@/lib/_core/env';
import { withSystemContext } from '@/lib/db/client.server';
import { pluginCollections, pluginRecords } from '@/lib/db/schema/plugin-storage';
import {
  createPluginStorageRuntime,
  describePluginStorageRuntime,
} from '@/lib/plugin-runtime/storage/db-storage.server';
import type { RuntimeCheck } from '../types';

function hasDatabaseConfiguration(): boolean {
  return Boolean(env.DATABASE_URL || env.NEON_DATABASE_URL || env.POSTGRES_HOST);
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function cleanupProbeData(pluginId: string): Promise<void> {
  await withSystemContext(async (database) => {
    await database.delete(pluginRecords).where(eq(pluginRecords.pluginId, pluginId));
    await database.delete(pluginCollections).where(eq(pluginCollections.pluginId, pluginId));
  });
}

export const pluginStorageCheck: RuntimeCheck = {
  name: 'plugin-storage',
  description: 'Validate ctx.storage plugin/user isolation and CRUD runtime',

  async run() {
    if (!hasDatabaseConfiguration() && env.NODE_ENV !== 'production') {
      return {
        key: 'plugin-storage',
        status: 'skipped',
        severity: 'warning',
        message: 'Plugin storage validation skipped: no database connection is configured',
        fix: 'Set database connection variables, run migrations, then rerun runtime:check',
      };
    }

    const pluginId = 'runtime-storage-check';
    const userId = 'runtime-storage-user';

    try {
      await cleanupProbeData(pluginId);

      const storage = createPluginStorageRuntime({
        pluginId,
        userId,
        data: {
          collections: {
            runtime_items: {
              fields: {
                label: { type: 'string', required: true, maxLength: 80 },
                count: { type: 'integer', default: 0 },
                done: { type: 'boolean', default: false },
              },
              indexes: [{ fields: ['done', 'count'] }],
            },
          },
        },
      });

      await storage.ensureCollections();
      const collection = storage.collection<{
        id: string;
        label: string;
        count: number;
        done: boolean;
        createdAt: Date;
        updatedAt: Date;
      }>('runtime_items');

      const inserted = await collection.insert({ label: 'probe' });
      const found = await collection.findById(inserted.id);
      const queried = await collection.findMany({
        where: { label: { startsWith: 'pro' }, count: { gte: 0 }, done: false },
        orderBy: { createdAt: 'desc' },
        limit: 5,
      });
      const updated = await collection.update(inserted.id, { count: 1, done: true });
      await collection.delete(inserted.id);
      const deleted = await collection.findById(inserted.id);

      await cleanupProbeData(pluginId);

      if (!found || queried.length !== 1 || updated.count !== 1 || deleted !== null) {
        return {
          key: 'plugin-storage',
          status: 'failed',
          severity: 'error',
          message: 'Plugin storage probe returned an unexpected CRUD result',
          details: {
            found: Boolean(found),
            queried: queried.length,
            updatedCount: updated.count,
            deleted: deleted === null,
            ...describePluginStorageRuntime(),
          },
          fix: 'Check plugin storage repository, query filtering, and migrations 0008_plugin_storage_runtime.sql',
        };
      }

      return {
        key: 'plugin-storage',
        status: 'ok',
        severity: 'info',
        message: 'Plugin storage runtime verified with real DB CRUD probe',
        details: {
          collection: 'runtime_items',
          insertedId: inserted.id,
          ...describePluginStorageRuntime(),
        },
      };
    } catch (error) {
      await cleanupProbeData(pluginId).catch(() => undefined);

      return {
        key: 'plugin-storage',
        status: 'failed',
        severity: env.NODE_ENV === 'production' ? 'error' : 'warning',
        message: `Plugin storage validation failed: ${toMessage(error)}`,
        fix: 'Run migrations and verify plugin_collections/plugin_records RLS policies before enabling plugin storage',
      };
    }
  },
};
