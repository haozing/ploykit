import { defineApi } from '@ploykit/module-sdk';

type ProductInput = {
  sku?: string;
  title?: string;
  slug?: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  inventory?: number;
  couponCode?: string;
  couponPercentOff?: number;
};

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}

export default defineApi({
  async get(ctx) {
    const [products, coupons] = await Promise.all([
      ctx.data.table('products').findMany({ orderBy: { updated_at: 'desc' }, limit: 50 }),
      ctx.data.table('coupons').findMany({ orderBy: { updated_at: 'desc' }, limit: 20 }),
    ]);
    return ctx.json({ ok: true, products, coupons });
  },
  async post(ctx) {
    const input = await ctx.request.json<ProductInput>();
    const title = input.title?.trim();
    if (!title) {
      return ctx.json({ ok: false, code: 'SHOP_DEMO_TITLE_REQUIRED' }, { status: 400 });
    }
    const sku = (input.sku?.trim() || slugify(title)).toUpperCase();
    const slug = slugify(input.slug || title);
    const priceCents = readPositiveInteger(input.priceCents, 1000);
    if (!sku || !slug) {
      return ctx.json({ ok: false, code: 'SHOP_DEMO_SKU_REQUIRED' }, { status: 400 });
    }

    const product = await ctx.data.table('products').upsert(
      {
        sku,
        title,
        slug,
        description: input.description?.trim() || null,
        status: 'active',
        price_cents: priceCents,
        currency: input.currency?.trim().toLowerCase() || 'usd',
        inventory: readPositiveInteger(input.inventory, 10),
        metadata: { source: 'api' },
      },
      { uniqueBy: ['sku'] }
    );

    let coupon = null;
    if (input.couponCode?.trim()) {
      coupon = await ctx.data.table('coupons').upsert(
        {
          code: input.couponCode.trim().toUpperCase(),
          percent_off: Math.min(readPositiveInteger(input.couponPercentOff, 10), 90),
          status: 'active',
          metadata: { source: 'api', sku },
        },
        { uniqueBy: ['code'] }
      );
    }

    await ctx.usage.record({ meter: 'shop.products.upserted', metadata: { sku } });
    await ctx.audit.record('shop-demo.product.upserted', { productId: product.id, sku });
    return ctx.json({ ok: true, product, coupon }, { status: 201 });
  },
});
