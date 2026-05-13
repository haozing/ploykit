import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const {
  getSessionMock,
  requireUserContextMock,
  getUserOrdersMock,
  getUserCreditLogsMock,
  auditLogDurableMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  requireUserContextMock: vi.fn(async (_userId, callback) => callback({})),
  getUserOrdersMock: vi.fn(),
  getUserCreditLogsMock: vi.fn(),
  auditLogDurableMock: vi.fn(),
}));

vi.mock('@/lib/auth/server', () => ({
  auth: {
    api: {
      getSession: getSessionMock,
    },
  },
}));

vi.mock('@/lib/db', () => ({
  requireUserContext: requireUserContextMock,
}));

vi.mock('@/lib/services/billing/order-service', () => ({
  getUserOrders: getUserOrdersMock,
}));

vi.mock('@/lib/services/billing/credit-log-service', () => ({
  getUserCreditLogs: getUserCreditLogsMock,
}));

vi.mock('@/lib/services/audit/audit-service', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/services/audit/audit-service')>();
  return {
    ...original,
    auditLogDurable: auditLogDurableMock,
  };
});

vi.mock('@/lib/services/user/user-status', () => ({
  assertUserAccountActive: vi.fn().mockResolvedValue(undefined),
}));

import { GET as getCreditHistory } from '../credit-history/route';
import { GET as getOrders } from '../orders/route';
import { GET as getSubscription } from '../subscription/route';

function createRequest(path: string): NextRequest {
  return new NextRequest(`https://app.example.com${path}`, {
    headers: {
      'x-request-id': 'req_user_billing',
    },
  });
}

describe('user billing routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireUserContextMock.mockImplementation(async (_userId, callback) => callback({}));
    getSessionMock.mockResolvedValue({
      session: { id: 'session_1' },
      user: { id: 'user_1', email: 'user@example.com' },
    });
    getUserOrdersMock.mockResolvedValue([
      {
        id: 'order_1',
        createdAt: new Date('2026-05-12T01:02:03.000Z'),
        orderType: 'one_time_purchase',
        status: 'succeeded',
        amount: '12.34',
        currency: 'USD',
        provider: 'stripe',
        providerOrderId: 'pi_secret_should_not_export',
        metadata: { rawProviderPayload: 'should_not_export' },
        plan: { name: 'Pro' },
      },
    ]);
    getUserCreditLogsMock.mockResolvedValue([
      {
        id: 'log_1',
        createdAt: new Date('2026-05-12T02:03:04.000Z'),
        logType: 'grant',
        changeAmount: 123,
        balanceAfter: { apiCallsRemaining: 456 },
        reason: 'Test credit',
        relatedOrderId: 'order_1',
        metadata: { rawProviderPayload: 'should_not_export' },
      },
    ]);
    auditLogDurableMock.mockResolvedValue({ id: 'audit_1' });
  });

  it('serves orders through auth and user DB context', async () => {
    const response = await getOrders(createRequest('/api/user/orders?limit=10'), {
      params: Promise.resolve({}),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      orders: [{ id: 'order_1' }],
      count: 1,
      pagination: { limit: 10, offset: 0, hasMore: false },
    });
    expect(getSessionMock).toHaveBeenCalledOnce();
    expect(requireUserContextMock).toHaveBeenCalledWith('user_1', expect.any(Function));
    expect(getUserOrdersMock).toHaveBeenCalledWith('user_1', 10, 0);
  });

  it('serves credit history through auth and user DB context', async () => {
    const response = await getCreditHistory(createRequest('/api/user/credit-history?limit=5'), {
      params: Promise.resolve({}),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      logs: [{ id: 'log_1' }],
      count: 1,
      pagination: { limit: 5, offset: 0, hasMore: false },
    });
    expect(getSessionMock).toHaveBeenCalledOnce();
    expect(requireUserContextMock).toHaveBeenCalledWith('user_1', expect.any(Function));
    expect(getUserCreditLogsMock).toHaveBeenCalledWith('user_1', 5, 0);
  });

  it('serves the current active subscription through auth and user DB context', async () => {
    const database = {
      query: {
        userEntitlements: {
          findFirst: vi.fn().mockResolvedValue({
            status: 'active',
            usageMetrics: { 'runlynk.calls': 2 },
            currentPeriodStart: null,
            currentPeriodEnd: null,
            stripeCustomerId: null,
            stripeSubscriptionId: null,
            metadata: {},
            plan: {
              id: 'plan_free',
              name: 'Free',
              slug: 'free',
              features: {},
              limits: { monthly: { 'runlynk.calls': 10 } },
              pricing: { currency: 'USD', monthly: 0 },
              langJsonb: null,
            },
          }),
        },
      },
    };
    requireUserContextMock.mockImplementationOnce(async (_userId, callback) => callback(database));

    const response = await getSubscription(createRequest('/api/user/subscription'), {
      params: Promise.resolve({}),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      status: 'active',
      isActive: true,
      plan: {
        id: 'plan_free',
        slug: 'free',
        priceMonthly: 0,
        currency: 'USD',
      },
      usage: { 'runlynk.calls': 2 },
    });
    expect(requireUserContextMock).toHaveBeenCalledWith('user_1', expect.any(Function));
    expect(database.query.userEntitlements.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        with: { plan: true },
      })
    );
  });

  it('exports orders CSV with a watermark, stable fields, and durable audit', async () => {
    const response = await getOrders(createRequest('/api/user/orders?limit=10&format=csv'), {
      params: Promise.resolve({}),
    });
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(text).toMatch(/^# Exported orders for user@example\.com \(user_1\) at /);
    expect(text).toContain('id,createdAt,orderType,status,amount,currency,provider,plan');
    expect(text).toContain('order_1');
    expect(text).not.toContain('providerOrderId');
    expect(text).not.toContain('pi_secret_should_not_export');
    expect(text).not.toContain('rawProviderPayload');
    expect(auditLogDurableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        userEmail: 'user@example.com',
        action: 'data.export',
        resource: 'orders',
        status: 'success',
        metadata: expect.objectContaining({
          format: 'csv',
          limit: 10,
          offset: 0,
          rowCount: 1,
          fields: [
            'id',
            'createdAt',
            'orderType',
            'status',
            'amount',
            'currency',
            'provider',
            'plan',
          ],
        }),
      })
    );
  });

  it('exports credit history CSV with a watermark, stable fields, and durable audit', async () => {
    const response = await getCreditHistory(
      createRequest('/api/user/credit-history?limit=5&format=csv&offset=2'),
      { params: Promise.resolve({}) }
    );
    const text = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(text).toMatch(/^# Exported credit-history for user@example\.com \(user_1\) at /);
    expect(text).toContain('id,createdAt,logType,changeAmount,balanceAfter,reason,relatedOrderId');
    expect(text).toContain('log_1');
    expect(text).not.toContain('rawProviderPayload');
    expect(auditLogDurableMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        userEmail: 'user@example.com',
        action: 'data.export',
        resource: 'credit_history',
        status: 'success',
        metadata: expect.objectContaining({
          format: 'csv',
          limit: 5,
          offset: 2,
          rowCount: 1,
          fields: [
            'id',
            'createdAt',
            'logType',
            'changeAmount',
            'balanceAfter',
            'reason',
            'relatedOrderId',
          ],
        }),
      })
    );
  });
});
