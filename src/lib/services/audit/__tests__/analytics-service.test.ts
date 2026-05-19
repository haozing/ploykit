import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDb, queryQueue } = vi.hoisted(() => {
  const queryQueue: Array<{ terminal: 'groupBy' | 'where' | 'orderBy'; result: unknown }> = [];
  const mockDb = {
    select: vi.fn(),
  };

  return { mockDb, queryQueue };
});

vi.mock('@/lib/db', () => ({ db: mockDb }));

import {
  calculateMrrSnapshot,
  collectUsageAndLimitValues,
  getRevenueMetrics,
  getUsagePatterns,
} from '../analytics-service';

function queueQuery(terminal: 'groupBy' | 'where' | 'orderBy', result: unknown): void {
  queryQueue.push({ terminal, result });
}

beforeEach(() => {
  queryQueue.length = 0;
  mockDb.select.mockReset();
  mockDb.select.mockImplementation(() => {
    const queued = queryQueue.shift();
    if (!queued) {
      throw new Error('Unexpected db.select() call');
    }

    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    chain.from = vi.fn(() => chain);
    chain.leftJoin = vi.fn(() => chain);
    chain.where = vi.fn(() => (queued.terminal === 'where' ? queued.result : chain));
    chain.groupBy = vi.fn(() => queued.result);
    chain.orderBy = vi.fn(() => queued.result);

    return chain;
  });
});

describe('calculateMrrSnapshot', () => {
  it('calculates monthly snapshot revenue with monthly and yearly intervals', () => {
    const result = calculateMrrSnapshot([
      {
        planName: 'Pro',
        pricing: { monthly: 15, yearly: 120 },
        billingInterval: 'yearly',
        count: 2,
      },
      {
        planName: 'Starter',
        pricing: { monthly: 15 },
        billingInterval: 'monthly',
        count: 3,
      },
    ]);

    expect(result.mrr).toBe(65);
    expect(result.revenueByPlan).toEqual({
      Pro: 20,
      Starter: 45,
    });
  });

  it('prefers structured pricing for the actual entitlement billing interval', () => {
    const result = calculateMrrSnapshot([
      {
        planName: 'Scale',
        billingInterval: 'yearly',
        pricing: { monthly: 99, yearly: 960 },
        count: 1,
      },
    ]);

    expect(result.mrr).toBe(80);
    expect(result.revenueByPlan).toEqual({ Scale: 80 });
  });
});

describe('collectUsageAndLimitValues', () => {
  it('reads monthly/yearly limits through the entitlement limit resolver', () => {
    const result = collectUsageAndLimitValues(
      [
        {
          usage: { 'platform.apiCalls': 40 },
          planLimits: {
            monthly: { 'platform.apiCalls': 100 },
            yearly: { 'platform.apiCalls': 200 },
          },
          billingInterval: 'monthly',
        },
        {
          usage: { 'platform.apiCalls': 75 },
          planLimits: {
            monthly: { 'platform.apiCalls': 100 },
            yearly: { 'platform.apiCalls': 2400 },
          },
          billingInterval: 'yearly',
        },
        {
          usage: { 'platform.apiCalls': 10 },
          planLimits: {
            monthly: { 'platform.apiCalls': 50 },
            yearly: { 'platform.apiCalls': 50 },
          },
          billingInterval: 'monthly',
        },
        {
          usage: { 'platform.apiCalls': 999 },
          planLimits: { monthly: { 'platform.apiCalls': -1 } },
          billingInterval: 'monthly',
        },
      ],
      'platform.apiCalls'
    );

    expect(result.usageValues).toEqual([40, 75, 10, 999]);
    expect(result.limitValues).toEqual([100, 2400, 50]);
    expect(result.limitByUsageIndex).toEqual([100, 2400, 50, null]);
  });
});

describe('getRevenueMetrics', () => {
  it('uses current and previous MRR snapshots instead of created-at window revenue', async () => {
    queueQuery('groupBy', [
      {
        planName: 'Pro',
        pricing: { monthly: 15, yearly: 120 },
        billingInterval: 'yearly',
        count: 2,
      },
      {
        planName: 'Starter',
        pricing: { monthly: 20 },
        billingInterval: 'monthly',
        count: 1,
      },
    ]);
    queueQuery('where', [{ count: 3 }]);
    queueQuery('groupBy', [
      {
        planName: 'Starter',
        pricing: { monthly: 20 },
        billingInterval: 'monthly',
        count: 2,
      },
    ]);

    const metrics = await getRevenueMetrics({
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-31T23:59:59Z'),
      previousStartDate: new Date('2026-04-01T00:00:00Z'),
      previousEndDate: new Date('2026-04-30T23:59:59Z'),
    });

    expect(metrics).toMatchObject({
      mrr: 40,
      arr: 480,
      revenueByPlan: {
        Pro: 20,
        Starter: 20,
      },
      averageRevenuePerUser: 40 / 3,
      lifetimeValue: 960,
    });
    expect(metrics.revenueGrowth).toBe(0);
    expect(mockDb.select).toHaveBeenCalledTimes(3);
  });
});

describe('getUsagePatterns', () => {
  it('returns semantic utilization bucket codes instead of display labels', async () => {
    queueQuery('where', [
      {
        usage: { 'platform.apiCalls': 10 },
        planLimits: { monthly: { 'platform.apiCalls': 100 } },
        billingInterval: 'monthly',
      },
      {
        usage: { 'platform.apiCalls': 40 },
        planLimits: { monthly: { 'platform.apiCalls': 100 } },
        billingInterval: 'monthly',
      },
      {
        usage: { 'platform.apiCalls': 60 },
        planLimits: { monthly: { 'platform.apiCalls': 100 } },
        billingInterval: 'monthly',
      },
      {
        usage: { 'platform.apiCalls': 90 },
        planLimits: { monthly: { 'platform.apiCalls': 100 } },
        billingInterval: 'monthly',
      },
      {
        usage: { 'platform.apiCalls': 125 },
        planLimits: { monthly: { 'platform.apiCalls': 100 } },
        billingInterval: 'monthly',
      },
    ]);
    queueQuery(
      'orderBy',
      Array.from({ length: 14 }, (_, index) => ({
        value: index < 7 ? 10 : 10,
        recordedAt: new Date(`2026-05-${String(index + 1).padStart(2, '0')}T00:00:00Z`),
      }))
    );

    const pattern = await getUsagePatterns('platform.apiCalls', {
      startDate: new Date('2026-05-01T00:00:00Z'),
      endDate: new Date('2026-05-31T23:59:59Z'),
    });

    expect(pattern.distribution).toEqual({
      lte25: 1,
      lte50: 1,
      lte75: 1,
      lte100: 1,
      gt100: 1,
    });
    expect(pattern.distribution).not.toHaveProperty('Over 100%');
  });
});
