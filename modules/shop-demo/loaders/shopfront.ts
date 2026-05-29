import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadShopfront(ctx: ModuleContext) {
  try {
    return await ctx.cache.remember(
      'shop-demo:shopfront:v1',
      async () => {
        const products = await ctx.data.table('products').findMany({
          where: { status: 'active' },
          orderBy: { updated_at: 'desc' },
          limit: 12,
        });
        return {
          products,
          emptyState:
            products.length === 0
              ? 'No products yet. Create catalog items in the dashboard.'
              : null,
        };
      },
      { ttlSeconds: 60 }
    );
  } catch (error) {
    return {
      products: [],
      emptyState: 'Shop catalog is unavailable until module data migrations are applied.',
      dataState: 'unavailable',
      message: error instanceof Error ? error.message : 'Shop data unavailable.',
    };
  }
}
