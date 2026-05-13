import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, requireUserContext } from '@/lib/db';
import { creditLogs } from '@/lib/db/schema';
import { getUserCreditLogs, getUserOrderCreditLogs } from '../credit-log-service';

vi.mock('@/lib/db', () => {
  const mockDb = {
    query: {
      creditLogs: {
        findMany: vi.fn(),
      },
    },
  };

  return {
    db: mockDb,
    requireUserContext: vi.fn((_userId, callback) => callback(mockDb)),
    withSystemContext: vi.fn((callback) => callback(mockDb)),
  };
});

vi.mock('@/lib/db/schema', () => ({
  creditLogs: {
    userId: 'creditLogs.userId',
    relatedOrderId: 'creditLogs.relatedOrderId',
    createdAt: 'creditLogs.createdAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ op: 'and', conditions })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  eq: vi.fn((left, right) => ({ op: 'eq', left, right })),
}));

describe('credit log service user isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.creditLogs.findMany).mockResolvedValue([]);
  });

  it('filters credit history by userId', async () => {
    await getUserCreditLogs('user-1', 25, 50);

    expect(requireUserContext).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(eq).toHaveBeenCalledWith(creditLogs.userId, 'user-1');
    expect(db.query.creditLogs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { op: 'eq', left: creditLogs.userId, right: 'user-1' },
        limit: 25,
        offset: 50,
      })
    );
  });

  it('filters order credit logs by both userId and orderId', async () => {
    await getUserOrderCreditLogs('user-1', 'order-1');

    expect(requireUserContext).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(eq).toHaveBeenCalledWith(creditLogs.userId, 'user-1');
    expect(eq).toHaveBeenCalledWith(creditLogs.relatedOrderId, 'order-1');
    expect(and).toHaveBeenCalledWith(
      { op: 'eq', left: creditLogs.userId, right: 'user-1' },
      { op: 'eq', left: creditLogs.relatedOrderId, right: 'order-1' }
    );
  });
});
