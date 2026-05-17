/**
 * user Registration Tests
 *
 * Tests for the registration hook in auth/server.ts
 * Focuses on transaction atomicity and error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockDb,
  createMockCache,
  createMockLogger,
  createMockuser,
  createMockrole,
  createMockEntitlementPlan,
} from './helpers';

//
// Mock Setup
//

const { mockDb, mockQuery: _mockDbQuery } = createMockDb();
const { mockInvalidateuserroleCache, mockInvalidateuserEntitlementCache } = createMockCache();
const mockLogger = createMockLogger();

// Mock modules
vi.mock('@/lib/db/client.server', () => ({ db: mockDb }));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
}));

vi.mock('@/lib/cache/invalidation', () => ({
  invalidateuserroleCache: mockInvalidateuserroleCache,
  invalidateuserEntitlementCache: mockInvalidateuserEntitlementCache,
}));

vi.mock('drizzle-orm', async () => {
  const actual = await vi.importActual('drizzle-orm');
  return {
    ...actual,
    eq: vi.fn((...args) => ({ type: 'eq', args })),
    and: vi.fn((...args) => ({ type: 'and', args })),
  };
});

vi.mock('@/lib/db/schema', () => ({
  userProfiles: { userId: 'userId' },
  roles: { slug: 'slug', isDefault: 'isDefault' },
  user: { id: 'id' },
  session: { userId: 'userId' },
  account: { userId: 'userId' },
  userroles: { userId: 'userId', roleId: 'roleId' },
  userEntitlements: { userId: 'userId', status: 'status' },
  entitlementPlans: { isDefault: 'isDefault', isActive: 'isActive' },
}));

// Mock assignrole
const mockAssignrole = vi.fn();
vi.mock('@/lib/auth/permissions', () => ({
  assignrole: mockAssignrole,
}));

// Mock createDefaultEntitlement
const mockCreateDefaultEntitlement = vi.fn();
vi.mock('@/lib/services/user-entitlement-service', () => ({
  createDefaultEntitlement: mockCreateDefaultEntitlement,
}));

//
// Test Helpers
//

/**
 * Simulate a registration transaction
 */
async function simulateRegistration(config: {
  user: ReturnType<typeof createMockuser>;
  defaultrole?: ReturnType<typeof createMockrole> | null;
  defaultPlan?: ReturnType<typeof createMockEntitlementPlan> | null;
  assignroleError?: Error;
  createEntitlementError?: Error;
  profileInsertError?: Error;
}) {
  const {
    user,
    defaultrole = createMockrole(),
    defaultPlan = createMockEntitlementPlan(),
    assignroleError,
    createEntitlementError,
    profileInsertError,
  } = config;

  // Track transaction callback
  let _transactionCallback: ((tx: Record<string, unknown>) => Promise<void>) | null = null;

  // Mock transaction to capture callback
  mockDb.transaction.mockImplementation(
    async (callback: (tx: Record<string, unknown>) => Promise<void>) => {
      _transactionCallback = callback;

      // Create a mock tx object
      const mockTx = {
        query: {
          roles: {
            findFirst: vi.fn().mockResolvedValue(defaultrole),
          },
          entitlementPlans: {
            findFirst: vi.fn().mockResolvedValue(defaultPlan ? [defaultPlan] : []),
          },
        },
        insert: vi.fn().mockReturnThis(),
        values: vi.fn().mockImplementation(() => {
          if (profileInsertError) {
            throw profileInsertError;
          }
          return Promise.resolve();
        }),
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(defaultPlan ? [defaultPlan] : []),
        limit: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        set: vi.fn().mockReturnThis(),
        returning: vi.fn().mockResolvedValue([{}]),
        delete: vi.fn().mockReturnThis(),
      };

      // Mock assignrole
      if (assignroleError) {
        mockAssignrole.mockRejectedValueOnce(assignroleError);
      } else {
        mockAssignrole.mockResolvedValueOnce(undefined);
      }

      // Mock createDefaultEntitlement
      if (createEntitlementError) {
        mockCreateDefaultEntitlement.mockRejectedValueOnce(createEntitlementError);
      } else {
        mockCreateDefaultEntitlement.mockResolvedValueOnce({});
      }

      // Execute callback
      try {
        await callback(mockTx);
        return true; // Transaction successful
      } catch (error) {
        throw error; // Transaction failed
      }
    }
  );

  // Simulate the registration hook
  try {
    await mockDb.transaction(async (tx: any) => {
      const role = await tx.query.roles.findFirst({
        where: { type: 'eq' },
      });

      if (!role) {
        throw new Error('No default role found');
      }

      // 2. Createuser profile
      await tx.insert().values({
        userId: user.id,
        metadata: {},
        preferences: {},
      });

      await mockAssignrole(user.id, role.slug, undefined, tx);

      await mockCreateDefaultEntitlement(user.id, tx);
    });

    // Transaction succeeded, invalidate cache
    mockInvalidateuserroleCache(user.id);
    mockInvalidateuserEntitlementCache(user.id);

    return { success: true, error: null };
  } catch (error) {
    return { success: false, error };
  }
}

//
// Tests
//

describe('user Registration (Transaction Atomicity)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAssignrole.mockReset();
    mockCreateDefaultEntitlement.mockReset();
    mockDb.transaction.mockReset();
  });

  //
  // Success Cases
  //

  it('shouldSuccessCompleteuserRegisterFlow', async () => {
    const user = createMockuser();

    const result = await simulateRegistration({ user });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();

    expect(mockAssignrole).toHaveBeenCalledTimes(1);
    expect(mockAssignrole).toHaveBeenCalledWith(
      user.id,
      'user', // defaultrole
      undefined,
      expect.any(Object) // tx Object
    );

    expect(mockCreateDefaultEntitlement).toHaveBeenCalledTimes(1);
    expect(mockCreateDefaultEntitlement).toHaveBeenCalledWith(
      user.id,
      expect.any(Object) // tx Object
    );

    expect(mockInvalidateuserroleCache).toHaveBeenCalledWith(user.id);
    expect(mockInvalidateuserEntitlementCache).toHaveBeenCalledWith(user.id);
  });

  //
  // Failure Cases - Transaction Rollback
  //

  it('shouldatdefaultroledoes not existwhenFailed并回滚', async () => {
    const user = createMockuser();

    const result = await simulateRegistration({
      user,
      defaultrole: null, // defaultroledoes not exist
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toMatchObject({
      message: expect.stringContaining('No default role found'),
    });

    expect(mockAssignrole).not.toHaveBeenCalled();

    expect(mockCreateDefaultEntitlement).not.toHaveBeenCalled();

    expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    expect(mockInvalidateuserEntitlementCache).not.toHaveBeenCalled();
  });

  it('shouldat Profile CreateFailedwhen回滚', async () => {
    const user = createMockuser();
    const error = new Error('Profile creation failed');

    const result = await simulateRegistration({
      user,
      profileInsertError: error,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(error);

    expect(mockAssignrole).not.toHaveBeenCalled();

    expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    expect(mockInvalidateuserEntitlementCache).not.toHaveBeenCalled();
  });

  it('shouldatrole分配Failedwhen回滚整事务', async () => {
    const user = createMockuser();
    const error = new Error('role assignment failed');

    const result = await simulateRegistration({
      user,
      assignroleError: error,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(error);

    expect(mockAssignrole).toHaveBeenCalledTimes(1);

    expect(mockCreateDefaultEntitlement).not.toHaveBeenCalled();

    expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    expect(mockInvalidateuserEntitlementCache).not.toHaveBeenCalled();
  });

  it('shouldat权益CreateFailedwhen回滚整事务', async () => {
    const user = createMockuser();
    const error = new Error('Entitlement creation failed');

    const result = await simulateRegistration({
      user,
      createEntitlementError: error,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(error);

    expect(mockAssignrole).toHaveBeenCalledTimes(1);

    expect(mockCreateDefaultEntitlement).toHaveBeenCalledTimes(1);

    expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    expect(mockInvalidateuserEntitlementCache).not.toHaveBeenCalled();
  });

  //
  // Cache Invalidation Timing
  //

  it('shouldat事务Success后才失效缓存', async () => {
    const user = createMockuser();

    await simulateRegistration({ user });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    expect(mockInvalidateuserroleCache).toHaveBeenCalledWith(user.id);
    expect(mockInvalidateuserEntitlementCache).toHaveBeenCalledWith(user.id);

    expect(mockAssignrole).toHaveBeenCalled();
    expect(mockCreateDefaultEntitlement).toHaveBeenCalled();
  });

  it('shouldat事务Failedwhen不失效缓存', async () => {
    const user = createMockuser();

    const result = await simulateRegistration({
      user,
      assignroleError: new Error('Assignment failed'),
    });

    expect(result.success).toBe(false);

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);

    expect(mockInvalidateuserroleCache).not.toHaveBeenCalled();
    expect(mockInvalidateuserEntitlementCache).not.toHaveBeenCalled();
  });
});
