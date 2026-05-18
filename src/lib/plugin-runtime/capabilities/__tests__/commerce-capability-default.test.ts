import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  createOrderMock,
  getOrderByProviderIdMock,
  getUserOrderByIdMock,
  getUserOrdersMock,
  applyCreditChangeMock,
  grantDigitalEntitlementMock,
  createOneTimeCheckoutSessionMock,
} = vi.hoisted(() => ({
  createOrderMock: vi.fn(),
  getOrderByProviderIdMock: vi.fn(),
  getUserOrderByIdMock: vi.fn(),
  getUserOrdersMock: vi.fn(),
  applyCreditChangeMock: vi.fn(),
  grantDigitalEntitlementMock: vi.fn(),
  createOneTimeCheckoutSessionMock: vi.fn(),
}));

vi.mock('@/lib/services/billing/order-service', () => ({
  createOrder: createOrderMock,
  getOrderByProviderId: getOrderByProviderIdMock,
  getUserOrderById: getUserOrderByIdMock,
  getUserOrders: getUserOrdersMock,
}));

vi.mock('@/lib/services/billing/credit-account-service', () => ({
  applyCreditChange: applyCreditChangeMock,
}));

vi.mock('@/lib/services/billing/digital-entitlement-service', () => ({
  grantDigitalEntitlement: grantDigitalEntitlementMock,
}));

vi.mock('@/lib/stripe/checkout-service', () => ({
  checkoutService: {
    createOneTimeCheckoutSession: createOneTimeCheckoutSessionMock,
  },
}));

vi.mock('@/lib/billing/product-billing.server', () => ({
  getProductPrimaryCreditMetric: () => 'platform.credits',
}));

vi.mock('@/lib/plugin-runtime/product-context.server', () => ({
  getCurrentRuntimeProductId: () => 'default',
}));

import { definePlugin, Permission } from '@ploykit/plugin-sdk';
import { normalizePluginRuntimeContract } from '../../contract';
import { createPluginRuntimeContext } from '../../context';

function createContext() {
  return createPluginRuntimeContext({
    contract: normalizePluginRuntimeContract(
      definePlugin({
        id: 'commerce-default-test',
        name: 'Commerce Default Test',
        version: '1.0.0',
        permissions: [Permission.CommerceWrite],
      })
    ),
    request: new Request('https://test.local/api/plugins/commerce-default-test/commerce'),
    requestId: 'request-1',
    user: { id: 'user-1', role: 'user', email: 'user@example.test' },
  });
}

describe('default commerce capability host', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes checkout idempotency keys to the Stripe checkout service', async () => {
    createOneTimeCheckoutSessionMock.mockResolvedValueOnce({
      session: { id: 'cs_1', url: 'https://checkout.test/session' },
      orderId: 'order-1',
    });

    await expect(
      createContext().commerce.createCheckout({
        amount: 9,
        currency: 'USD',
        name: 'Credit pack',
        successUrl: 'https://app.test/success',
        cancelUrl: 'https://app.test/cancel',
        idempotencyKey: 'checkout-key',
      })
    ).resolves.toMatchObject({
      id: 'cs_1',
      orderId: 'order-1',
    });

    expect(createOneTimeCheckoutSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: 'checkout-key',
      })
    );
  });

  it('replays existing orders for matching idempotent createOrder calls', async () => {
    getOrderByProviderIdMock.mockResolvedValueOnce({
      id: 'order-1',
      userId: 'user-1',
      orderType: 'one_time_purchase',
      provider: 'local',
      providerOrderId: 'order-key',
      amount: '9',
      currency: 'USD',
      status: 'succeeded',
      planId: null,
      relatedOrderId: null,
      metadata: {
        pluginId: 'commerce-default-test',
        productId: 'default',
        creditMetric: 'platform.credits',
      },
      createdAt: new Date('2026-05-18T00:00:00Z'),
      updatedAt: new Date('2026-05-18T00:00:00Z'),
    });

    await expect(
      createContext().commerce.createOrder({
        providerOrderId: 'order-key',
        amount: 9,
        currency: 'USD',
      })
    ).resolves.toMatchObject({
      id: 'order-1',
      providerOrderId: 'order-key',
      status: 'succeeded',
    });
    expect(createOrderMock).not.toHaveBeenCalled();
  });

  it('rejects mismatched idempotent createOrder replays', async () => {
    getOrderByProviderIdMock.mockResolvedValueOnce({
      id: 'order-1',
      userId: 'user-1',
      orderType: 'one_time_purchase',
      provider: 'local',
      providerOrderId: 'order-key',
      amount: '9',
      currency: 'USD',
      status: 'succeeded',
      planId: null,
      relatedOrderId: null,
      metadata: {
        pluginId: 'commerce-default-test',
        productId: 'default',
        creditMetric: 'platform.credits',
      },
      createdAt: new Date('2026-05-18T00:00:00Z'),
      updatedAt: new Date('2026-05-18T00:00:00Z'),
    });

    await expect(
      createContext().commerce.createOrder({
        providerOrderId: 'order-key',
        amount: 10,
        currency: 'USD',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_COMMERCE_IDEMPOTENCY_CONFLICT',
    });
  });
});
