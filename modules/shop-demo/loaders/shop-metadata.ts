import type { ModuleContext } from '@ploykit/module-sdk';

export default function shopMetadata(ctx: ModuleContext) {
  const origin = new URL(ctx.request.url).origin;
  return {
    title: 'Shop Demo | PloyKit',
    description: 'A product-grade shop sample module with catalog, coupons, orders and checkout.',
    canonical: `${origin}/shop-demo`,
    robots: 'index,follow',
    openGraph: {
      title: 'Shop Demo',
      description: 'Sell products through a first-class local PloyKit module.',
      url: `${origin}/shop-demo`,
    },
  };
}
