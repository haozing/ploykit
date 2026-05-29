import type { ModuleContext } from '@ploykit/module-sdk';

export default async function loadShopOps(ctx: ModuleContext) {
  try {
    const [products, orders, coupons] = await Promise.all([
      ctx.data.table('products').findMany({ orderBy: { updated_at: 'desc' }, limit: 10 }),
      ctx.data.table('orders').findMany({ orderBy: { updated_at: 'desc' }, limit: 10 }),
      ctx.data.table('coupons').findMany({ where: { status: 'active' }, limit: 10 }),
    ]);
    return {
      products,
      orders,
      metrics: {
        products: products.length,
        orders: orders.length,
        coupons: coupons.length,
        revenueCents: orders.reduce((sum, order) => sum + Number(order.total_cents ?? 0), 0),
      },
    };
  } catch (error) {
    return {
      products: [],
      orders: [],
      metrics: { products: 0, orders: 0, coupons: 0, revenueCents: 0 },
      dataState: 'unavailable',
      message: error instanceof Error ? error.message : 'Shop data unavailable.',
    };
  }
}
