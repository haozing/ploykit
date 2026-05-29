import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadNotes(ctx: ModuleContext) {
  try {
    const table = ctx.data.table('notes');
    const [notes, total] = await Promise.all([
      table.findMany({ orderBy: { updated_at: 'desc' }, limit: 10 }),
      table.count(),
    ]);

    return {
      total,
      notes,
      canAttachFiles: true,
    };
  } catch (error) {
    return {
      total: 0,
      notes: [],
      canAttachFiles: true,
      dataState: 'unavailable-until-runtime-store-database-is-configured',
      message: error instanceof Error ? error.message : 'Data runtime unavailable.',
    };
  }
}
