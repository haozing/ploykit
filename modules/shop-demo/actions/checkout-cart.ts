import { action, type ModuleContext } from '@ploykit/module-sdk';

type CheckoutInput = {
  sku?: string;
  quantity?: number;
  couponCode?: string;
};

type CheckoutFailure = {
  ok: false;
  code: string;
  inventory?: number;
};

type CheckoutReservation = {
  product: Record<string, unknown>;
  order: Record<string, unknown>;
  quantity: number;
  sku: string;
  subtotalCents: number;
  discountCents: number;
  totalCents: number;
  couponCode: string | null;
};

function isCheckoutFailure(value: CheckoutReservation | CheckoutFailure): value is CheckoutFailure {
  return 'ok' in value && value.ok === false;
}

function positiveQuantity(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, 25) : 1;
}

function activeCoupon(coupon: Record<string, unknown> | null): boolean {
  if (!coupon || coupon.status !== 'active') {
    return false;
  }
  if (typeof coupon.expires_at === 'string' && Date.parse(coupon.expires_at) < Date.now()) {
    return false;
  }
  return true;
}

function createOrderNumber(): string {
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SHOP-${Date.now()}-${suffix}`;
}

export default action(async function checkoutCart(ctx: ModuleContext, input: CheckoutInput = {}) {
  const userId = ctx.user?.id;
  if (!userId) {
    return { ok: false, code: 'SHOP_DEMO_AUTH_REQUIRED', upgrade: '/zh/login' };
  }
  const sku = input.sku?.trim().toUpperCase();
  if (!sku) {
    throw new Error('SHOP_DEMO_SKU_REQUIRED');
  }
  const quantity = positiveQuantity(input.quantity);
  const couponCode = input.couponCode?.trim().toUpperCase();
  const orderNumber = createOrderNumber();

  const reservation = await ctx.data.transaction(async (tx): Promise<CheckoutReservation | CheckoutFailure> => {
    const productTable = tx.table('products');
    const product = await productTable.findOne({
      where: { sku, status: 'active' },
      lock: 'update',
    });
    if (!product) {
      return { ok: false, code: 'SHOP_DEMO_PRODUCT_NOT_FOUND' };
    }
    const inventory = Number(product.inventory ?? 0);
    if (inventory < quantity) {
      return { ok: false, code: 'SHOP_DEMO_INVENTORY_REQUIRED', inventory };
    }

    const coupon = couponCode
      ? await tx.table('coupons').findOne({ where: { code: couponCode } })
      : null;
    const percentOff = activeCoupon(coupon) ? Number(coupon?.percent_off ?? 0) : 0;
    const subtotalCents = Number(product.price_cents ?? 0) * quantity;
    const discountCents = Math.floor((subtotalCents * percentOff) / 100);
    const totalCents = Math.max(0, subtotalCents - discountCents);
    const order = await tx.table('orders').insert({
      order_number: orderNumber,
      user_id: userId,
      sku,
      product_title: String(product.title ?? sku),
      quantity,
      subtotal_cents: subtotalCents,
      discount_cents: discountCents,
      total_cents: totalCents,
      currency: String(product.currency ?? 'usd'),
      status: 'checkout_pending',
      checkout_id: null,
      coupon_code: percentOff > 0 ? couponCode : null,
      metadata: {
        source: 'checkoutCart',
        productId: product.id,
        reservedInventory: quantity,
      },
    });
    await productTable.update(String(product.id), { inventory: inventory - quantity });

    return {
      product,
      order,
      quantity,
      sku,
      subtotalCents,
      discountCents,
      totalCents,
      couponCode: percentOff > 0 ? (couponCode ?? null) : null,
    };
  });

  if (isCheckoutFailure(reservation)) {
    return reservation;
  }

  let checkout;
  let order;
  try {
    checkout = await ctx.commerce.createCheckout({
      buyer: { type: 'user', id: userId },
      beneficiary: { type: 'user', id: userId },
      sku,
      amount: reservation.totalCents,
      currency: String(reservation.product.currency ?? 'usd'),
      idempotencyKey: `shop-demo:${userId}:${orderNumber}`,
    });
    order = await ctx.data.table('orders').update(String(reservation.order.id), {
      status: checkout.status,
      checkout_id: checkout.id,
      metadata: {
        ...(reservation.order.metadata as Record<string, unknown> | undefined),
        checkoutStatusAppliedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    await ctx.data.transaction(async (tx) => {
      const productTable = tx.table('products');
      const currentProduct = await productTable.findOne({
        where: { id: String(reservation.product.id) },
        lock: 'update',
      });
      if (currentProduct) {
        await productTable.update(String(currentProduct.id), {
          inventory: Number(currentProduct.inventory ?? 0) + reservation.quantity,
        });
      }
      await tx.table('orders').update(String(reservation.order.id), {
        status: 'checkout_failed',
        metadata: {
          ...(reservation.order.metadata as Record<string, unknown> | undefined),
          checkoutFailure: error instanceof Error ? error.message : String(error),
        },
      });
    });
    throw error;
  }
  await ctx.audit.record('shop-demo.order.created', {
    orderId: order.id,
    orderNumber,
    sku,
    totalCents: reservation.totalCents,
  });
  await ctx.usage.record({
    meter: 'shop.orders.created',
    quantity,
    metadata: { sku, totalCents: reservation.totalCents },
  });
  const event = await ctx.events.publish(
    'shop.order.created',
    { orderId: order.id, orderNumber, sku, totalCents: reservation.totalCents },
    { idempotencyKey: `shop-demo-order-${order.id}` }
  );
  await ctx.notifications.send({
    userId,
    title: 'Shop checkout created',
    body: `${order.product_title} x ${quantity}`,
    actionUrl: '/dashboard/shop-demo',
    metadata: { orderId: order.id, sku, checkoutId: checkout.id },
  });

  return { ok: true, order, checkout, eventId: event.id };
});
