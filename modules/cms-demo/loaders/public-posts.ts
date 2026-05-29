import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadPublicPosts(ctx: ModuleContext) {
  try {
    return await ctx.cache.remember(
      'cms-demo:public-posts:v1',
      async () => {
        const [posts, categories] = await Promise.all([
          ctx.data.table('posts').findMany({
            where: { status: 'published' },
            orderBy: { published_at: 'desc' },
            limit: 12,
          }),
          ctx.data.table('categories').findMany({
            where: { status: 'active' },
            orderBy: { name: 'asc' },
            limit: 20,
          }),
        ]);
        return {
          posts,
          categories,
          emptyState:
            posts.length === 0
              ? 'No published CMS posts yet. Create a draft in the dashboard and publish it.'
              : null,
        };
      },
      { ttlSeconds: 60 }
    );
  } catch (error) {
    return {
      posts: [],
      categories: [],
      emptyState: 'CMS data is unavailable until module data migrations are applied.',
      dataState: 'unavailable',
      message: error instanceof Error ? error.message : 'CMS data unavailable.',
    };
  }
}
