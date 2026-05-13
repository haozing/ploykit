import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  busOnMock,
  handlers,
  mockDb,
  createOrderMock,
  createRefundOrderMock,
  getOrderByProviderIdMock,
  updateOrderStatusMock,
  markInvoicesForOrderStatusMock,
  upsertProviderInvoiceMock,
  cancelSubscriptionMock,
  getPlanForStripePriceIdMock,
  getUserEntitlementMock,
  logMonthlyResetMock,
  logRefundRevokeMock,
  readPlanLimitValueMock,
  upgradeUserPlanMock,
} = vi.hoisted(() => {
  const registeredHandlers = new Map<string, (payload: unknown) => Promise<void>>();

  const whereMock = vi.fn().mockResolvedValue([]);
  const setMock = vi.fn(() => ({ where: whereMock }));
  const updateMock = vi.fn(() => ({ set: setMock }));

  const limitMock = vi.fn().mockResolvedValue([{ id: 'plan_pro', name: 'Pro', limits: {} }]);
  const selectWhereMock = vi.fn(() => ({ limit: limitMock }));
  const fromMock = vi.fn(() => ({ where: selectWhereMock }));
  const selectMock = vi.fn(() => ({ from: fromMock }));

  return {
    busOnMock: vi.fn(
      (event: string, _pluginId: string, handler: (payload: unknown) => Promise<void>) => {
        registeredHandlers.set(event, handler);
      }
    ),
    handlers: registeredHandlers,
    mockDb: {
      query: {
        userEntitlements: {
          findFirst: vi.fn(),
        },
      },
      update: updateMock,
      select: selectMock,
      __whereMock: whereMock,
      __setMock: setMock,
      __limitMock: limitMock,
    },
    createOrderMock: vi.fn(),
    createRefundOrderMock: vi.fn(),
    getOrderByProviderIdMock: vi.fn(),
    updateOrderStatusMock: vi.fn(),
    markInvoicesForOrderStatusMock: vi.fn(),
    upsertProviderInvoiceMock: vi.fn(),
    cancelSubscriptionMock: vi.fn(),
    getPlanForStripePriceIdMock: vi.fn(),
    getUserEntitlementMock: vi.fn(),
    logMonthlyResetMock: vi.fn(),
    logRefundRevokeMock: vi.fn(),
    readPlanLimitValueMock: vi.fn(),
    upgradeUserPlanMock: vi.fn(),
  };
});

vi.mock('@/lib/bus', () => ({
  bus: {
    event: {
      on: busOnMock,
    },
  },
}));

vi.mock('@/lib/db', () => ({
  db: mockDb,
}));

vi.mock('@/lib/services/user/user-entitlement-service', () => ({
  cancelSubscription: cancelSubscriptionMock,
  getUserEntitlement: getUserEntitlementMock,
  readPlanLimitValue: readPlanLimitValueMock,
  upgradeUserPlan: upgradeUserPlanMock,
}));

vi.mock('@/lib/services/billing/order-service', () => ({
  createOrder: createOrderMock,
  createRefundOrder: createRefundOrderMock,
  getOrderByProviderId: getOrderByProviderIdMock,
  updateOrderStatus: updateOrderStatusMock,
}));

vi.mock('@/lib/services/billing/credit-log-service', () => ({
  logSubscriptionCreated: vi.fn(),
  logMonthlyReset: logMonthlyResetMock,
  logRefundRevoke: logRefundRevokeMock,
}));

vi.mock('@/lib/services/billing/local-billing-service', () => ({
  markInvoicesForOrderStatus: markInvoicesForOrderStatusMock,
  upsertProviderInvoice: upsertProviderInvoiceMock,
}));

vi.mock('@/lib/services/billing/plan-price-service', () => ({
  getPlanForStripePriceId: getPlanForStripePriceIdMock,
}));

import { BILLING_EVENTS } from '../../constants';
import { initSubscriptionHandlers } from '../subscription-handler';

function handlerFor(event: string) {
  const handler = handlers.get(event);
  if (!handler) {
    throw new Error(`Handler not registered for ${event}`);
  }
  return handler;
}

describe('subscription webhook handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handlers.clear();
    mockDb.query.userEntitlements.findFirst.mockResolvedValue(null);
    mockDb.__whereMock.mockResolvedValue([]);
    mockDb.__limitMock.mockResolvedValue([{ id: 'plan_pro', name: 'Pro', limits: {} }]);
    getOrderByProviderIdMock.mockResolvedValue(null);
    getPlanForStripePriceIdMock.mockResolvedValue(null);
    getUserEntitlementMock.mockResolvedValue(null);
    readPlanLimitValueMock.mockReturnValue(100);
    createOrderMock.mockResolvedValue({
      id: 'order_1',
      providerOrderId: 'in_1',
      planId: 'plan_pro',
    });
    createRefundOrderMock.mockResolvedValue({ id: 'refund_order_1' });
    upgradeUserPlanMock.mockResolvedValue({ id: 'ent_1' });
    upsertProviderInvoiceMock.mockResolvedValue({ id: 'invoice_1' });
    markInvoicesForOrderStatusMock.mockResolvedValue([{ id: 'invoice_1' }]);
    initSubscriptionHandlers();
  });

  it('handles subscription updates from portal price changes', async () => {
    mockDb.query.userEntitlements.findFirst.mockResolvedValueOnce({
      id: 'ent_existing',
      userId: 'user_1',
      planId: 'plan_pro',
      stripeCustomerId: 'cus_1',
      billingInterval: 'monthly',
      metadata: {},
      plan: { id: 'plan_pro', name: 'Pro' },
    });
    getPlanForStripePriceIdMock.mockResolvedValueOnce({
      planId: 'plan_enterprise',
      interval: 'yearly',
    });
    upgradeUserPlanMock.mockResolvedValueOnce({ id: 'ent_updated' });

    await handlerFor(BILLING_EVENTS.SUBSCRIPTION_UPDATED)({
      userId: 'user_1',
      data: {
        subscriptionId: 'sub_1',
        customerId: 'cus_1',
        stripePriceId: 'price_enterprise_yearly',
        status: 'active',
        currentPeriodStart: new Date('2026-05-01T00:00:00Z'),
        currentPeriodEnd: new Date('2027-05-01T00:00:00Z'),
        cancelAtPeriodEnd: false,
      },
    });

    expect(getPlanForStripePriceIdMock).toHaveBeenCalledWith({
      stripePriceId: 'price_enterprise_yearly',
    });
    expect(upgradeUserPlanMock).toHaveBeenCalledWith(
      'user_1',
      'plan_enterprise',
      'sub_1',
      'cus_1',
      { operatorId: 'stripe_webhook' }
    );
    expect(cancelSubscriptionMock).not.toHaveBeenCalled();
  });

  it('handles subscription cancellation as an immediate entitlement cancellation', async () => {
    getUserEntitlementMock.mockResolvedValueOnce({
      id: 'ent_1',
      userId: 'user_1',
      status: 'active',
    });

    await handlerFor(BILLING_EVENTS.SUBSCRIPTION_CANCELLED)({
      userId: 'user_1',
      data: {
        subscriptionId: 'sub_1',
        cancelledAt: new Date('2026-05-12T00:00:00Z'),
      },
    });

    expect(cancelSubscriptionMock).toHaveBeenCalledWith('user_1', true, {
      operatorId: 'stripe_webhook',
      reason: 'Subscription cancelled in Stripe',
    });
    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        orderType: 'subscription_cancelled',
        provider: 'stripe',
        status: 'succeeded',
      })
    );
  });

  it('handles subscription renewal by creating an order, invoice, and credit reset', async () => {
    mockDb.query.userEntitlements.findFirst.mockResolvedValueOnce({
      id: 'ent_1',
      userId: 'user_1',
      billingInterval: 'monthly',
      metadata: { paymentFailureCount: 2 },
      plan: { id: 'plan_pro', name: 'Pro', limits: {} },
    });

    await handlerFor(BILLING_EVENTS.SUBSCRIPTION_RENEWED)({
      userId: 'user_1',
      data: {
        subscriptionId: 'sub_1',
        invoiceId: 'in_1',
        invoiceNumber: 'INV-001',
        stripePriceId: 'price_pro_monthly',
        billingInterval: 'monthly',
        amount: 25,
        currency: 'usd',
        hostedInvoiceUrl: 'https://stripe.test/invoice/in_1',
        invoicePdf: 'https://stripe.test/invoice/in_1.pdf',
        periodStart: new Date('2026-05-01T00:00:00Z'),
        periodEnd: new Date('2026-06-01T00:00:00Z'),
        paidAt: new Date('2026-05-01T00:00:30Z'),
      },
    });

    expect(getOrderByProviderIdMock).toHaveBeenCalledWith('stripe', 'in_1');
    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        orderType: 'subscription_renewed',
        provider: 'stripe',
        providerOrderId: 'in_1',
        amount: '25',
        currency: 'usd',
        status: 'succeeded',
      })
    );
    expect(upsertProviderInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        orderId: 'order_1',
        provider: 'stripe',
        providerInvoiceId: 'in_1',
        invoiceNumber: 'INV-001',
        status: 'paid',
        currency: 'USD',
        totalAmount: '25',
      })
    );
    expect(logMonthlyResetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        resetAmount: 100,
        entitlementId: 'ent_1',
        orderId: 'order_1',
      })
    );
  });

  it('handles one-off paid invoices as generic orders and invoices', async () => {
    await handlerFor(BILLING_EVENTS.INVOICE_PAID)({
      userId: 'user_1',
      data: {
        invoiceId: 'in_oneoff_1',
        invoiceNumber: 'INV-ONE-001',
        amount: 49,
        currency: 'usd',
        paidAt: new Date('2026-05-01T00:00:30Z'),
        metadata: { sku: 'template-pack' },
      },
    });

    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        orderType: 'one_time_purchase',
        provider: 'stripe',
        providerOrderId: 'in_oneoff_1',
        amount: '49',
        currency: 'usd',
        status: 'succeeded',
      })
    );
    expect(upsertProviderInvoiceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'stripe',
        providerInvoiceId: 'in_oneoff_1',
        invoiceNumber: 'INV-ONE-001',
        status: 'paid',
        currency: 'USD',
        totalAmount: '49',
      })
    );
  });

  it('handles refunds idempotently and mirrors financial status', async () => {
    getOrderByProviderIdMock
      .mockResolvedValueOnce({
        id: 'order_original',
        userId: 'user_1',
        providerOrderId: 'in_1',
        planId: 'plan_pro',
      })
      .mockResolvedValueOnce(null);

    await handlerFor(BILLING_EVENTS.ORDER_REFUNDED)({
      userId: 'user_1',
      data: {
        orderId: 'in_1',
        chargeId: 'ch_1',
        refundedAmount: 25,
        totalAmount: 25,
        currency: 'usd',
        refunds: [
          {
            id: 're_1',
            amount: 25,
            reason: 'requested_by_customer',
            status: 'succeeded',
          },
        ],
      },
    });

    expect(createRefundOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        providerOrderId: 're_1',
        amount: 25,
        currency: 'usd',
        originalOrderId: 'order_original',
        planId: 'plan_pro',
      })
    );
    expect(updateOrderStatusMock).toHaveBeenCalledWith('order_original', 'refunded');
    expect(markInvoicesForOrderStatusMock).toHaveBeenCalledWith(
      'order_original',
      'refunded',
      expect.objectContaining({
        refundOrderId: 'refund_order_1',
        refundedAmount: 25,
      })
    );
    expect(logRefundRevokeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        creditsRevoked: 100,
        refundOrderId: 'refund_order_1',
      })
    );
  });

  it('skips duplicate refunds without mutating orders or credits again', async () => {
    getOrderByProviderIdMock
      .mockResolvedValueOnce({
        id: 'order_original',
        userId: 'user_1',
        providerOrderId: 'in_1',
        planId: 'plan_pro',
      })
      .mockResolvedValueOnce({
        id: 'refund_existing',
        userId: 'user_1',
        providerOrderId: 're_1',
      });

    await handlerFor(BILLING_EVENTS.ORDER_REFUNDED)({
      userId: 'user_1',
      data: {
        orderId: 'in_1',
        chargeId: 'ch_1',
        refundedAmount: 25,
        totalAmount: 25,
        currency: 'usd',
        refunds: [
          {
            id: 're_1',
            amount: 25,
            reason: 'requested_by_customer',
            status: 'succeeded',
          },
        ],
      },
    });

    expect(createRefundOrderMock).not.toHaveBeenCalled();
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
    expect(markInvoicesForOrderStatusMock).not.toHaveBeenCalled();
    expect(logRefundRevokeMock).not.toHaveBeenCalled();
  });
});
