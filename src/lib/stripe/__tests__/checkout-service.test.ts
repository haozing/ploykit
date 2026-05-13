import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  checkoutCreateMock,
  customerCreateMock,
  customerListMock,
  mockDb,
  portalCreateMock,
  validateStripePriceEnvironmentMock,
  getPlanByIdMock,
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
}));

vi.mock('@/lib/db', () => ({
  db: mockDb,
}));

vi.mock('@/lib/services/entitlement/plan-service', () => ({
  getPlanById: getPlanByIdMock,
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
});
