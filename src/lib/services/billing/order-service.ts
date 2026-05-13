/**
 * Order Service
 *
 * Service for managing order records and transaction history.
 *
 * Provides:
 * - Complete transaction history
 * - Idempotency support for webhook processing
 * - Refund tracking and reconciliation
 * - Financial reporting data
 */

import { requireUserContext, withSystemContext } from '@/lib/db';
import { bus } from '@/lib/bus';
import { entitlementPlans, orders, type OrderType, type OrderStatus } from '@/lib/db/schema';
import { and, desc, eq } from 'drizzle-orm';

// ============================================================================
// TYPES
// ============================================================================

export interface CreateOrderParams {
  userId: string;
  orderType: OrderType;
  provider?: string;
  providerOrderId: string;
  amount?: string | number;
  currency?: string;
  status: OrderStatus;
  planId?: string;
  relatedOrderId?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// ORDER CRUD FUNCTIONS
// ============================================================================

/**
 * Create a new order record
 *
 * IMPORTANT: Check for idempotency before calling this
 * Use `getOrderByProviderId` first to ensure no duplicate
 *
 * @example
 * ```ts
 * // Check if already exists (idempotency)
 * const existing = await getOrderByProviderId('stripe', invoiceId);
 * if (existing) {
 *   console.log('Order already processed');
 *   return existing;
 * }
 *
 * // Create new order
 * const order = await createOrder({
 *   userId,
 *   orderType: 'subscription_created',
 *   providerOrderId: invoiceId,
 *   amount: invoice.amount_paid / 100,
 *   currency: invoice.currency,
 *   status: 'succeeded',
 *   planId,
 *   metadata: { stripeInvoice: invoice }
 * });
 * ```
 */
export async function createOrder(params: CreateOrderParams) {
  const {
    userId,
    orderType,
    provider = 'stripe',
    providerOrderId,
    amount,
    currency = 'USD',
    status,
    planId,
    relatedOrderId,
    metadata,
  } = params;

  const result = await withSystemContext(async (database) => {
    return await database
      .insert(orders)
      .values({
        userId,
        orderType,
        provider,
        providerOrderId,
        amount: amount ? String(amount) : undefined,
        currency,
        status,
        planId: planId || undefined,
        relatedOrderId: relatedOrderId || undefined,
        metadata: metadata || {},
      })
      .returning();
  });

  const order = result[0];

  await bus.event.emit(
    'billing.order.created',
    'billing-order-service',
    {
      orderId: order.id,
      userId,
      orderType,
      provider,
      providerOrderId,
      amount: order.amount,
      currency: order.currency,
      status: order.status,
      planId: order.planId,
      relatedOrderId: order.relatedOrderId,
    },
    {
      correlationId: `${provider}:${providerOrderId}`,
      idempotencyKey: `${provider}:${providerOrderId}:order-created`,
    }
  );

  return order;
}

/**
 * Get order by provider order ID
 *
 * Essential for idempotency checking in webhook handlers
 *
 * @example
 * ```ts
 * const existing = await getOrderByProviderId('stripe', 'in_1234567890');
 * if (existing) {
 *   console.log('Already processed this invoice');
 *   return;
 * }
 * ```
 */
export async function getOrderByProviderId(provider: string, providerOrderId: string) {
  return await withSystemContext(async (database) => {
    return await database.query.orders.findFirst({
      where: and(eq(orders.provider, provider), eq(orders.providerOrderId, providerOrderId)),
    });
  });
}

/**
 * Get user's order history
 *
 * @param userId - User ID
 * @param limit - Maximum number of orders to return (default: 50)
 * @param offset - Number of rows to skip for pagination (default: 0)
 */
export async function getUserOrders(userId: string, limit = 50, offset = 0) {
  return await requireUserContext(userId, async (database) => {
    return await database
      .select({
        id: orders.id,
        userId: orders.userId,
        orderType: orders.orderType,
        provider: orders.provider,
        providerOrderId: orders.providerOrderId,
        amount: orders.amount,
        currency: orders.currency,
        status: orders.status,
        planId: orders.planId,
        relatedOrderId: orders.relatedOrderId,
        metadata: orders.metadata,
        createdAt: orders.createdAt,
        updatedAt: orders.updatedAt,
        plan: {
          id: entitlementPlans.id,
          name: entitlementPlans.name,
          slug: entitlementPlans.slug,
          pricing: entitlementPlans.pricing,
        },
      })
      .from(orders)
      .leftJoin(entitlementPlans, eq(orders.planId, entitlementPlans.id))
      .where(eq(orders.userId, userId))
      .orderBy(desc(orders.createdAt))
      .limit(limit)
      .offset(offset);
  });
}

/**
 * Get a single user-owned order.
 *
 * Use this for user-facing routes. Admin and webhook code can use getOrderById()
 * when the caller has already passed an admin/system guard.
 */
export async function getUserOrderById(userId: string, orderId: string) {
  return await requireUserContext(userId, async (database) => {
    return await database.query.orders.findFirst({
      where: and(eq(orders.id, orderId), eq(orders.userId, userId)),
      with: {
        plan: true,
        creditLogs: true,
      },
    });
  });
}

/**
 * Get order by ID
 */
export async function getOrderById(orderId: string) {
  return await withSystemContext(async (database) => {
    return await database.query.orders.findFirst({
      where: eq(orders.id, orderId),
      with: {
        plan: true,
        user: {
          columns: {
            id: true,
            email: true,
          },
        },
        creditLogs: true,
      },
    });
  });
}

/**
 * Update order status
 *
 * Used for processing refunds or updating payment status
 */
export async function updateOrderStatus(orderId: string, status: OrderStatus) {
  const [updated] = await withSystemContext(async (database) => {
    return await database
      .update(orders)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId))
      .returning();
  });

  return updated;
}

// ============================================================================
// REFUND TRACKING
// ============================================================================

/**
 * Create a refund order
 *
 * Links to the original order for tracking
 *
 * @example
 * ```ts
 * // Find original order
 * const originalOrder = await getOrderByProviderId('stripe', paymentIntentId);
 *
 * // Create refund record
 * const refundOrder = await createRefundOrder({
 *   userId: originalOrder.userId,
 *   providerOrderId: refundId,
 *   amount: refundAmount,
 *   currency: originalOrder.currency,
 *   originalOrderId: originalOrder.id,
 *   planId: originalOrder.planId
 * });
 * ```
 */
export async function createRefundOrder(params: {
  userId: string;
  provider?: string;
  providerOrderId: string;
  amount: string | number;
  currency: string;
  originalOrderId: string;
  planId?: string;
  metadata?: Record<string, unknown>;
}) {
  const {
    userId,
    provider = 'stripe',
    providerOrderId,
    amount,
    currency,
    originalOrderId,
    planId,
    metadata,
  } = params;

  return await createOrder({
    userId,
    orderType: 'refund',
    provider,
    providerOrderId,
    amount,
    currency,
    status: 'succeeded',
    planId,
    relatedOrderId: originalOrderId,
    metadata,
  });
}

/**
 * Get refunds for an order
 *
 * Returns all refund orders linked to the original order
 */
export async function getOrderRefunds(originalOrderId: string) {
  return await withSystemContext(async (database) => {
    return await database.query.orders.findMany({
      where: and(eq(orders.relatedOrderId, originalOrderId), eq(orders.orderType, 'refund')),
      orderBy: desc(orders.createdAt),
    });
  });
}

// ============================================================================
// ANALYTICS & REPORTING
// ============================================================================

/**
 * Get orders by type
 *
 * For analytics and reporting
 */
export async function getOrdersByType(orderType: OrderType, limit = 100) {
  return await withSystemContext(async (database) => {
    return await database.query.orders.findMany({
      where: eq(orders.orderType, orderType),
      orderBy: desc(orders.createdAt),
      limit,
    });
  });
}

/**
 * Get user's total spend
 *
 * Calculate total amount spent by user (excluding refunds)
 */
export async function getUserTotalSpend(userId: string): Promise<number> {
  const userOrders = await requireUserContext(userId, async (database) => {
    return await database.query.orders.findMany({
      where: eq(orders.userId, userId),
      columns: {
        amount: true,
        orderType: true,
        status: true,
      },
    });
  });

  const total = userOrders.reduce((sum, order) => {
    // Only count succeeded orders, exclude refunds
    if (order.status === 'succeeded' && order.orderType !== 'refund' && order.amount) {
      return sum + parseFloat(order.amount);
    }
    return sum;
  }, 0);

  return total;
}

/**
 * Get recent orders (admin view)
 *
 * For dashboard and monitoring
 */
export async function getRecentOrders(limit = 20) {
  return await withSystemContext(async (database) => {
    return await database.query.orders.findMany({
      orderBy: desc(orders.createdAt),
      limit,
      with: {
        user: {
          columns: {
            id: true,
            email: true,
          },
        },
        plan: {
          columns: {
            name: true,
            slug: true,
          },
        },
      },
    });
  });
}
