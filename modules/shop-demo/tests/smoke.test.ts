import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestingModuleContext } from '@ploykit/module-sdk';
import moduleDefinition from '../module';
import productsApi from '../api/products';
import ordersApi from '../api/orders';
import checkoutCart from '../actions/checkout-cart';
import billingStatus from '../api/billing-status';
import runPaidTool from '../actions/run-paid-tool';
import loadShopOps from '../loaders/ops';
import loadShopfront from '../loaders/shopfront';

test('shop-demo declares catalog routes, data and checkout workflow', () => {
  assert.equal(moduleDefinition.id, 'shop-demo');
  assert.ok(moduleDefinition.data?.tables?.products);
  assert.ok(moduleDefinition.data?.tables?.coupons);
  assert.ok(moduleDefinition.data?.tables?.orders);
  assert.equal(moduleDefinition.routes?.site?.[0]?.path, '/shop-demo');
  assert.equal(moduleDefinition.routes?.dashboard?.[0]?.path, '/shop-demo');
  assert.equal(moduleDefinition.routes?.dashboard?.[1]?.path, '/shop-demo/billing');
  assert.equal(moduleDefinition.routes?.api?.length, 3);
  assert.ok(moduleDefinition.actions?.checkoutCart);
  assert.ok(moduleDefinition.actions?.runPaidTool);
  assert.deepEqual(moduleDefinition.events?.publishes, ['shop.order.created']);
});

test('shop-demo creates product, coupon and checkout order evidence', async () => {
  const ctx = createTestingModuleContext({
    moduleId: 'shop-demo',
    request: {
      async json<T = unknown>() {
        return {
          sku: 'PKT-PRO',
          title: 'PloyKit Pro Seat',
          description: 'A sample SaaS seat.',
          priceCents: 2500,
          inventory: 5,
          couponCode: 'LAUNCH10',
          couponPercentOff: 10,
        } as T;
      },
    },
  });

  const createResponse = await productsApi.post?.(ctx);
  assert.equal(createResponse?.status, 201);
  const created = (await createResponse?.json()) as {
    ok: boolean;
    product: { sku: string; inventory: number };
    coupon: { code: string; percent_off: number };
  };
  assert.equal(created.ok, true);
  assert.equal(created.product.sku, 'PKT-PRO');
  assert.equal(created.coupon.code, 'LAUNCH10');

  const checkout = await checkoutCart.run(ctx, {
    sku: 'PKT-PRO',
    quantity: 2,
    couponCode: 'LAUNCH10',
  });
  assert.equal(checkout.ok, true);
  assert.ok(checkout.order);
  assert.ok(checkout.checkout);
  assert.equal(checkout.order.subtotal_cents, 5000);
  assert.equal(checkout.order.discount_cents, 500);
  assert.equal(checkout.order.total_cents, 4500);
  assert.equal(checkout.checkout.status, 'created');

  const ordersResponse = await ordersApi.get?.(ctx);
  const orders = (await ordersResponse?.json()) as { ok: boolean; orders: { sku: string }[] };
  assert.equal(orders.ok, true);
  assert.equal(orders.orders[0]?.sku, 'PKT-PRO');

  const billingResponse = await billingStatus.get?.(ctx);
  const billing = (await billingResponse?.json()) as {
    ok: boolean;
    entitlement: string;
    entitled: boolean;
    balance: { balance: number } | null;
  };
  assert.equal(billing.ok, true);
  assert.equal(billing.entitlement, 'demo.entitlement');
  assert.equal(billing.entitled, false);

  const paidTool = await runPaidTool.run(ctx, {});
  assert.equal(paidTool.ok, true);
  assert.equal(paidTool.charged, 1);
  assert.ok(paidTool.balance);

  const shopfront = await loadShopfront(ctx);
  assert.equal(shopfront.products[0]?.inventory, 3);

  const ops = await loadShopOps(ctx);
  assert.equal(ops.metrics.orders, 1);
  assert.equal(ops.metrics.revenueCents, 4500);
});
