import { beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, requireUserContext } from '@/lib/db';
import { orders } from '@/lib/db/schema';
import { getUserOrderById, getUserOrders } from '../order-service';

vi.mock('@/lib/db', () => {
  const chain = {
    select: vi.fn(),
    from: vi.fn(),
    leftJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    offset: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.leftJoin.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.orderBy.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  chain.offset.mockResolvedValue([]);

  const mockDb = {
    ...chain,
    query: {
      orders: {
        findMany: vi.fn(),
        findFirst: vi.fn(),
      },
    },
  };

  return {
    db: mockDb,
    requireUserContext: vi.fn((_userId, callback) => callback(mockDb)),
    withSystemContext: vi.fn((callback) => callback(mockDb)),
  };
});

vi.mock('@/lib/bus', () => ({
  bus: {
    event: {
      emit: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db/schema', () => ({
  entitlementPlans: {
    id: 'entitlementPlans.id',
    name: 'entitlementPlans.name',
    slug: 'entitlementPlans.slug',
    pricing: 'entitlementPlans.pricing',
  },
  orders: {
    id: 'orders.id',
    userId: 'orders.userId',
    orderType: 'orders.orderType',
    provider: 'orders.provider',
    providerOrderId: 'orders.providerOrderId',
    amount: 'orders.amount',
    currency: 'orders.currency',
    status: 'orders.status',
    planId: 'orders.planId',
    relatedOrderId: 'orders.relatedOrderId',
    metadata: 'orders.metadata',
    createdAt: 'orders.createdAt',
    updatedAt: 'orders.updatedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ op: 'and', conditions })),
  desc: vi.fn((column) => ({ op: 'desc', column })),
  eq: vi.fn((left, right) => ({ op: 'eq', left, right })),
}));

describe('order service user isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.orders.findMany).mockResolvedValue([]);
    vi.mocked(db.query.orders.findFirst).mockResolvedValue(undefined);
    vi.mocked((db as any).select).mockReturnValue(db);
    vi.mocked((db as any).from).mockReturnValue(db);
    vi.mocked((db as any).leftJoin).mockReturnValue(db);
    vi.mocked((db as any).where).mockReturnValue(db);
    vi.mocked((db as any).orderBy).mockReturnValue(db);
    vi.mocked((db as any).limit).mockReturnValue(db);
    vi.mocked((db as any).offset).mockResolvedValue([]);
  });

  it('filters user order history by userId', async () => {
    await getUserOrders('user-1', 25, 50);

    expect(requireUserContext).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(eq).toHaveBeenCalledWith(orders.userId, 'user-1');
    expect((db as any).limit).toHaveBeenCalledWith(25);
    expect((db as any).offset).toHaveBeenCalledWith(50);
  });

  it('filters single user order reads by both orderId and userId', async () => {
    await getUserOrderById('user-1', 'order-1');

    expect(requireUserContext).toHaveBeenCalledWith('user-1', expect.any(Function));
    expect(eq).toHaveBeenCalledWith(orders.id, 'order-1');
    expect(eq).toHaveBeenCalledWith(orders.userId, 'user-1');
    expect(and).toHaveBeenCalledWith(
      { op: 'eq', left: orders.id, right: 'order-1' },
      { op: 'eq', left: orders.userId, right: 'user-1' }
    );
  });
});
