import { beforeEach, describe, expect, it, vi } from 'vitest';

const { withSystemContextMock, findLedgerEntryMock } = vi.hoisted(() => ({
  withSystemContextMock: vi.fn(),
  findLedgerEntryMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  withSystemContext: withSystemContextMock,
}));

vi.mock('@/lib/cache', () => ({
  invalidateUserEntitlementCache: vi.fn(),
}));

import { applyCreditChange } from '../credit-account-service';

describe('credit account service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects reused idempotency keys with a different request fingerprint', async () => {
    findLedgerEntryMock.mockResolvedValueOnce({
      id: 'entry-1',
      accountId: 'account-1',
      scopeType: 'user',
      scopeId: 'user-1',
      metric: 'platform.credits',
      operation: 'grant',
      amount: 10,
      balanceBefore: 0,
      balanceAfter: 10,
      idempotencyKey: 'same-key',
      idempotencyFingerprint: 'different-fingerprint',
      metadata: {},
    });
    withSystemContextMock.mockImplementationOnce(async (callback) =>
      callback({
        query: {
          creditLedgerEntries: {
            findFirst: findLedgerEntryMock,
          },
        },
      })
    );

    await expect(
      applyCreditChange({
        scope: { type: 'user', id: 'user-1' },
        metric: 'platform.credits',
        operation: 'grant',
        amount: 20,
        idempotencyKey: 'same-key',
        visibleInCreditLog: true,
      })
    ).rejects.toMatchObject({
      name: 'CreditIdempotencyConflictError',
    });
  });

  it('locks the credit account row before applying balance changes', async () => {
    const selectForMock = vi.fn(() => ({
      limit: vi.fn().mockResolvedValue([
        {
          id: 'account-1',
          scopeType: 'workspace',
          scopeId: 'workspace-1',
          metric: 'platform.credits',
          balance: 10,
          unlimited: false,
          metadata: {},
        },
      ]),
    }));
    const insertMock = vi
      .fn()
      .mockReturnValueOnce({
        values: vi.fn(() => ({
          onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
        })),
      })
      .mockReturnValueOnce({
        values: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([
            {
              id: 'entry-1',
              accountId: 'account-1',
            },
          ]),
        })),
      });
    const updateMock = vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: vi.fn().mockResolvedValue([{ id: 'account-1' }]),
        })),
      })),
    }));
    withSystemContextMock.mockImplementationOnce(async (callback) =>
      callback({
        insert: insertMock,
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              for: selectForMock,
            })),
          })),
        })),
        update: updateMock,
      })
    );

    await applyCreditChange({
      scope: { type: 'workspace', id: 'workspace-1' },
      metric: 'platform.credits',
      operation: 'grant',
      amount: 5,
    });

    expect(selectForMock).toHaveBeenCalledWith('update');
  });
});
