import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  checkoutCreateMock,
  customerCreateMock,
  customerListMock,
  mockDb,
  portalCreateMock,
  validateStripePriceEnvironmentMock,
  getPlanByIdMock,
  createOrderMock,
  getOrderByProviderIdMock,
  updateOrderMetadataMock,
} = vi.hoisted(() => ({
  checkoutCreateMock: vi.fn(),
  customerCreateMock: vi.fn(),
  customerListMock: vi.fn(),
  mockDb: {
    query: {
      userEntitlements: {
        findFirst: vi.fn(),
      },
    },
  },
  portalCreateMock: vi.fn(),
  validateStripePriceEnvironmentMock: vi.fn(),
  getPlanByIdMock: vi.fn(),
  createOrderMock: vi.fn(),
  getOrderByProviderIdMock: vi.fn(),
  updateOrderMetadataMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: mockDb,
}));

vi.mock('@/lib/services/entitlement/plan-service', () => ({
  getPlanById: getPlanByIdMock,
}));

vi.mock('@/lib/services/billing/order-service', () => ({
  createOrder: createOrderMock,
  getOrderByProviderId: getOrderByProviderIdMock,
  updateOrderMetadata: updateOrderMetadataMock,
}));

vi.mock('../env-guard', () => ({
  validateStripePriceEnvironment: validateStripePriceEnvironmentMock,
}));

vi.mock('../client', () => ({
  getStripe: vi.fn(() => ({
    checkout: {
      sessions: {
        create: checkoutCreateMock,
      },
    },
    billingPortal: {
      sessions: {
        create: portalCreateMock,
      },
    },
    customers: {
      create: customerCreateMock,
      list: customerListMock,
      retrieve: vi.fn(),
    },
  })),
}));

import { CheckoutService } from '../checkout-service';

describe('CheckoutService', () => {
  const service = new CheckoutService();

  beforeEach(() => {
    vi.clearAllMocks();
    validateStripePriceEnvironmentMock.mockResolvedValue(undefined);
    getPlanByIdMock.mockResolvedValue({
      id: 'plan_1',
      name: 'Pro Plan',
      slug: 'pro',
    });
    mockDb.query.userEntitlements.findFirst.mockResolvedValue(null);
    customerListMock.mockResolvedValue({ data: [] });
    customerCreateMock.mockResolvedValue({ id: 'cus_1' });
    checkoutCreateMock.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.test' });
    portalCreateMock.mockResolvedValue({ id: 'bps_1', url: 'https://portal.stripe.test' });
    createOrderMock.mockResolvedValue({ id: 'order_1' });
    getOrderByProviderIdMock.mockResolvedValue(null);
    updateOrderMetadataMock.mockResolvedValue({ id: 'order_1' });
  });

  it('creates checkout metadata with distinct plan id, slug, name, and billing period', async () => {
    const session = await service.createCheckoutSession({
      userId: 'user_1',
      userEmail: 'user@example.com',
      planId: 'plan_1',
      planName: 'Pro Plan',
      stripePriceId: 'price_test_pro_monthly',
      billingPeriod: 'monthly',
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/pricing',
    });

    expect(session).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test' });
    expect(validateStripePriceEnvironmentMock).toHaveBeenCalledWith('price_test_pro_monthly');
    expect(checkoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: {
          userId: 'user_1',
          planId: 'plan_1',
          planSlug: 'pro',
          planName: 'Pro Plan',
          billingPeriod: 'monthly',
        },
        subscription_data: {
          metadata: {
            userId: 'user_1',
            planId: 'plan_1',
            planSlug: 'pro',
            planName: 'Pro Plan',
            billingPeriod: 'monthly',
          },
        },
      })
    );
  });

  it('only creates a portal session for an active Stripe-backed entitlement', async () => {
    mockDb.query.userEntitlements.findFirst.mockResolvedValueOnce({
      id: 'ent_1',
      userId: 'user_1',
      status: 'active',
      stripeCustomerId: 'cus_1',
    });

    const session = await service.createPortalSession({
      userId: 'user_1',
      returnUrl: 'https://app.example.com/billing',
    });

    expect(session.url).toBe('https://portal.stripe.test');
    expect(mockDb.query.userEntitlements.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.anything(),
      })
    );
    expect(portalCreateMock).toHaveBeenCalledWith({
      customer: 'cus_1',
      return_url: 'https://app.example.com/billing',
    });
  });

  it('rejects portal sessions when no active subscription exists', async () => {
    mockDb.query.userEntitlements.findFirst.mockResolvedValueOnce(null);

    await expect(
      service.createPortalSession({
        userId: 'user_1',
        returnUrl: 'https://app.example.com/billing',
      })
    ).rejects.toThrow('No active subscription found');
    expect(portalCreateMock).not.toHaveBeenCalled();
  });

  it('uses checkout idempotency for local orders and Stripe sessions', async () => {
    const result = await service.createOneTimeCheckoutSession({
      userId: 'user_1',
      userEmail: 'user@example.com',
      amount: 25,
      currency: 'USD',
      quantity: 2,
      name: 'Credit pack',
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/billing',
      idempotencyKey: 'credit-pack-1',
      metadata: { pluginId: 'billing-plugin' },
    });

    expect(result.session).toEqual({ id: 'cs_1', url: 'https://checkout.stripe.test' });
    expect(getOrderByProviderIdMock).toHaveBeenCalledWith('stripe', 'checkout:credit-pack-1');
    expect(createOrderMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: result.orderId,
        provider: 'stripe',
        providerOrderId: 'checkout:credit-pack-1',
        amount: 50,
        metadata: expect.objectContaining({
          pluginId: 'billing-plugin',
          checkoutKind: 'one_time_purchase',
          checkoutRequest: expect.objectContaining({
            amount: 25,
            quantity: 2,
            name: 'Credit pack',
          }),
        }),
      })
    );
    expect(checkoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'payment',
        client_reference_id: result.orderId,
      }),
      { idempotencyKey: 'checkout:credit-pack-1' }
    );
    expect(updateOrderMetadataMock).toHaveBeenCalledWith(
      result.orderId,
      expect.objectContaining({
        checkoutSessionId: 'cs_1',
        checkoutSessionUrl: 'https://checkout.stripe.test',
      })
    );
  });

  it('returns a cached checkout session for an idempotent replay', async () => {
    getOrderByProviderIdMock.mockResolvedValueOnce({
      id: 'order_existing',
      userId: 'user_1',
      provider: 'stripe',
      providerOrderId: 'checkout:credit-pack-1',
      orderType: 'one_time_purchase',
      amount: '25',
      currency: 'USD',
      status: 'pending',
      metadata: {
        checkoutRequest: {
          amount: 25,
          currency: 'USD',
          quantity: 1,
          name: 'Credit pack',
        },
        checkoutSessionId: 'cs_existing',
        checkoutSessionUrl: 'https://checkout.stripe.test/existing',
      },
    });

    const result = await service.createOneTimeCheckoutSession({
      userId: 'user_1',
      userEmail: 'user@example.com',
      amount: 25,
      currency: 'USD',
      name: 'Credit pack',
      successUrl: 'https://app.example.com/success',
      cancelUrl: 'https://app.example.com/billing',
      idempotencyKey: 'credit-pack-1',
    });

    expect(result).toEqual({
      orderId: 'order_existing',
      session: {
        id: 'cs_existing',
        url: 'https://checkout.stripe.test/existing',
      },
    });
    expect(createOrderMock).not.toHaveBeenCalled();
    expect(checkoutCreateMock).not.toHaveBeenCalled();
    expect(updateOrderMetadataMock).not.toHaveBeenCalled();
  });
});
