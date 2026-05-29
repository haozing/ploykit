import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadStudio(ctx: ModuleContext) {
  try {
    const table = ctx.data.table('posts');
    const [recent, drafts, published, categories] = await Promise.all([
      table.findMany({ orderBy: { updated_at: 'desc' }, limit: 10 }),
      table.count({ where: { status: 'draft' } }),
      table.count({ where: { status: 'published' } }),
      ctx.data.table('categories').count({ where: { status: 'active' } }),
    ]);
    return {
      recent,
      metrics: {
        drafts,
        published,
        categories,
      },
    };
  } catch (error) {
    return {
      recent: [],
      metrics: {
        drafts: 0,
        published: 0,
        categories: 0,
      },
      dataState: 'unavailable',
      message: error instanceof Error ? error.message : 'CMS data unavailable.',
    };
  }
}
