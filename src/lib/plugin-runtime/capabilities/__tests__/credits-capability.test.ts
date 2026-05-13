import { beforeEach, describe, expect, it, vi } from 'vitest';
import { definePlugin, Permission } from '@ploykit/plugin-sdk';

const { withSystemContextMock, invalidateUserEntitlementCacheMock } = vi.hoisted(() => ({
  withSystemContextMock: vi.fn(),
  invalidateUserEntitlementCacheMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  usageHistory: {
    idempotencyKey: 'usage_history.idempotency_key',
    userId: 'usage_history.user_id',
    pluginId: 'usage_history.plugin_id',
    metadata: 'usage_history.metadata',
    value: 'usage_history.value',
  },
  userEntitlements: {
    userId: 'user_entitlements.user_id',
    status: 'user_entitlements.status',
    usageMetrics: 'user_entitlements.usage_metrics',
    usageUpdatedAt: 'user_entitlements.usage_updated_at',
  },
  withSystemContext: withSystemContextMock,
}));

vi.mock('@/lib/cache', () => ({
  invalidateUserEntitlementCache: invalidateUserEntitlementCacheMock,
}));

import { normalizePluginRuntimeContract } from '../../contract';
import { createPluginRuntimeContext } from '../../context';

type MockDatabase = {
  query: {
    userEntitlements: {
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

function createContract() {
  return normalizePluginRuntimeContract(
    definePlugin({
      id: 'credit-test',
      name: 'Credit Test',
      version: '1.0.0',
      permissions: [Permission.CreditsRead, Permission.CreditsConsume],
    })
  );
}

function createContext() {
  return createPluginRuntimeContext({
    contract: createContract(),
    request: new Request('https://test.local/api/plugins/credit-test/credits'),
    requestId: 'request-1',
    user: { id: 'user-1', role: 'user' },
  });
}

function createMockDatabase(
  options: {
    balance?: number;
    insertedUsage?: boolean;
    updatedBalance?: number | null;
    replayMetadata?: Record<string, unknown>;
    replayPluginId?: string;
    replayUserId?: string;
    replayValue?: number;
  } = {}
): MockDatabase {
  const database = {} as MockDatabase;
  const insertedUsage = options.insertedUsage ?? true;

  const insertBuilder = {
    values: vi.fn().mockReturnThis(),
    onConflictDoNothing: vi.fn().mockReturnThis(),
    returning: vi
      .fn()
      .mockResolvedValue(insertedUsage ? [{ idempotencyKey: 'credit-call-1' }] : []),
  };

  const updateBuilder = {
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    returning: vi
      .fn()
      .mockResolvedValue(
        options.updatedBalance === null
          ? []
          : [{ usageMetrics: { 'platform.apiCallsRemaining': options.updatedBalance ?? 7 } }]
      ),
  };

  const deleteBuilder = {
    where: vi.fn().mockResolvedValue(undefined),
  };

  const selectBuilder = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([
      {
        metadata: options.replayMetadata ?? {
          meter: 'credit-test.external-api',
          balanceBefore: 10,
          balanceAfter: 7,
        },
        pluginId: options.replayPluginId ?? 'credit-test',
        userId: options.replayUserId ?? 'user-1',
        value: options.replayValue ?? 3,
      },
    ]),
  };

  database.query = {
    userEntitlements: {
      findFirst: vi.fn().mockResolvedValue({
        usageMetrics: {
          'platform.apiCallsRemaining': options.balance ?? 10,
        },
      }),
    },
  };
  database.insert = vi.fn(() => insertBuilder);
  database.update = vi.fn(() => updateBuilder);
  database.delete = vi.fn(() => deleteBuilder);
  database.select = vi.fn(() => selectBuilder);
  database.from = vi.fn().mockReturnThis();
  database.where = vi.fn().mockReturnThis();
  database.limit = vi.fn().mockReturnThis();

  return database;
}

describe('credits capability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the default platform credit balance', async () => {
    const database = createMockDatabase({ balance: 42 });
    withSystemContextMock.mockImplementation(async (callback) => callback(database));
    const context = createContext();

    await expect(context.credits.getBalance()).resolves.toEqual({
      balance: 42,
      metric: 'platform.apiCallsRemaining',
      userId: 'user-1',
    });
  });

  it('atomically consumes credits and returns the updated balance', async () => {
    const database = createMockDatabase({ updatedBalance: 7 });
    withSystemContextMock.mockImplementation(async (callback) => callback(database));
    const context = createContext();

    await expect(
      context.credits.consume({
        meter: 'credit-test.external-api',
        amount: 3,
        idempotencyKey: 'credit-call-1',
        metadata: { provider: 'example' },
      })
    ).resolves.toEqual({
      consumed: true,
      amount: 3,
      balanceBefore: 10,
      balanceAfter: 7,
      meter: 'credit-test.external-api',
      userId: 'user-1',
      idempotencyKey: 'credit-call-1',
      metadata: { provider: 'example' },
    });
    expect(database.insert).toHaveBeenCalled();
    expect(database.update).toHaveBeenCalled();
    expect(invalidateUserEntitlementCacheMock).toHaveBeenCalledWith('user-1');
  });

  it('does not double charge repeated idempotency keys', async () => {
    const database = createMockDatabase({
      insertedUsage: false,
      replayValue: 3,
      replayMetadata: {
        meter: 'credit-test.external-api',
        balanceBefore: 10,
        balanceAfter: 7,
      },
    });
    withSystemContextMock.mockImplementation(async (callback) => callback(database));
    const context = createContext();

    await expect(
      context.credits.consume({
        meter: 'credit-test.external-api',
        amount: 3,
        idempotencyKey: 'credit-call-1',
      })
    ).resolves.toMatchObject({
      consumed: true,
      balanceBefore: 10,
      balanceAfter: 7,
    });
    expect(database.update).not.toHaveBeenCalled();
    expect(invalidateUserEntitlementCacheMock).not.toHaveBeenCalled();
  });

  it('rejects insufficient credit and releases the idempotency reservation', async () => {
    const database = createMockDatabase({ updatedBalance: null });
    withSystemContextMock.mockImplementation(async (callback) => callback(database));
    const context = createContext();

    await expect(
      context.credits.consume({
        meter: 'credit-test.external-api',
        amount: 99,
        idempotencyKey: 'credit-call-1',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CREDITS_INSUFFICIENT',
      statusCode: 402,
    });
    expect(database.delete).toHaveBeenCalled();
  });

  it('rejects idempotency key reuse across different operations', async () => {
    const database = createMockDatabase({
      insertedUsage: false,
      replayMetadata: {
        meter: 'other-plugin.external-api',
        balanceBefore: 10,
        balanceAfter: 7,
      },
    });
    withSystemContextMock.mockImplementation(async (callback) => callback(database));
    const context = createContext();

    await expect(
      context.credits.consume({
        meter: 'credit-test.external-api',
        amount: 3,
        idempotencyKey: 'credit-call-1',
      })
    ).rejects.toMatchObject({
      code: 'PLUGIN_CREDITS_IDEMPOTENCY_CONFLICT',
      statusCode: 409,
    });
  });
});
