/**
 * Auth Test Helpers
 *
 * Utilities for testing auth-related functionality
 */

import { vi } from 'vitest';

//
// Mock Data Creators
//

/**
 * Create a mock user object
 */
export function createMockuser(
  overrides?: Partial<{
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: Date;
    updatedAt: Date;
  }>
) {
  return {
    id: 'user-123',
    email: 'test@example.com',
    name: 'Test user',
    emailVerified: false,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock role object
 */
export function createMockrole(
  overrides?: Partial<{
    id: string;
    slug: string;
    name: string;
    description: string;
    permissions: string[];
    isDefault: boolean;
  }>
) {
  return {
    id: 'role-123',
    slug: 'user',
    name: 'user',
    description: 'Regular user',
    permissions: ['profile:view:self', 'profile:edit:self'],
    isDefault: true,
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock user role assignment
 */
export function createMockuserrole(
  overrides?: Partial<{
    id: string;
    userId: string;
    roleId: string;
    grantedBy: string | null;
    grantedAt: Date;
  }>
) {
  return {
    id: 'user-role-123',
    userId: 'user-123',
    roleId: 'role-123',
    grantedBy: null,
    grantedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock user profile
 */
export function createMockuserProfile(
  overrides?: Partial<{
    id: string;
    userId: string;
    metadata: Record<string, unknown>;
    preferences: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  }>
) {
  return {
    id: 'profile-123',
    userId: 'user-123',
    metadata: {
      registrationSource: 'email',
      onboardingCompleted: false,
    },
    preferences: {
      theme: 'light',
      language: 'zh',
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock entitlement plan
 */
export function createMockEntitlementPlan(
  overrides?: Partial<{
    id: string;
    slug: string;
    name: string;
    isDefault: boolean;
    isActive: boolean;
    limits: Record<string, unknown>;
  }>
) {
  return {
    id: 'plan-123',
    slug: 'free',
    name: 'Free Plan',
    description: 'Free plan for new users',
    isDefault: true,
    isActive: true,
    limits: {
      monthly: {
        'platform.apiCalls': 100,
        'platform.storageBytes': 1024,
      },
      yearly: {
        'platform.apiCalls': 1200,
        'platform.storageBytes': 1024,
      },
    },
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

/**
 * Create a mock user entitlement
 */
export function createMockUserEntitlement(
  overrides?: Partial<{
    id: string;
    userId: string;
    planId: string;
    status: string;
    startDate: Date;
    usageMetrics: Record<string, unknown>;
  }>
) {
  return {
    id: 'entitlement-123',
    userId: 'user-123',
    planId: 'plan-123',
    status: 'active',
    startDate: new Date('2025-01-01'),
    usageMetrics: {},
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-01'),
    ...overrides,
  };
}

//
// Mock Database
//

/**
 * Create a mock database client
 */
export function createMockDb() {
  const mockQuery = {
    roles: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    userroles: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    userProfiles: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    entitlementPlans: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    userEntitlements: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };

  const mockDb = {
    query: mockQuery,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(), // ?add innerJoin
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    transaction: vi.fn(),
  };

  return { mockDb, mockQuery };
}

/**
 * Create a mock transaction object
 */
export function createMockTransaction() {
  const mockQuery = {
    roles: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    userroles: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    entitlementPlans: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  };

  const mockTx = {
    query: mockQuery,
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  };

  return { mockTx, mockQuery };
}

//
// Mock Cache
//

/**
 * Create mock cache functions
 */
export function createMockCache() {
  const cacheStore = new Map<string, unknown>();

  const mockuserroleCache = {
    get: vi.fn((key: string) => cacheStore.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      cacheStore.set(key, value);
    }),
    delete: vi.fn((key: string) => cacheStore.delete(key)),
    clear: vi.fn(() => cacheStore.clear()),
  };

  const mockuserPermissionCache = {
    get: vi.fn((key: string) => cacheStore.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      cacheStore.set(key, value);
    }),
    delete: vi.fn((key: string) => cacheStore.delete(key)),
    clear: vi.fn(() => cacheStore.clear()),
  };

  const mockuserEntitlementCache = {
    get: vi.fn((key: string) => cacheStore.get(key)),
    set: vi.fn((key: string, value: unknown) => {
      cacheStore.set(key, value);
    }),
    delete: vi.fn((key: string) => cacheStore.delete(key)),
    clear: vi.fn(() => cacheStore.clear()),
  };

  const mockInvalidateuserroleCache = vi.fn();
  const mockInvalidateuserEntitlementCache = vi.fn();

  return {
    cacheStore,
    mockuserroleCache,
    mockuserPermissionCache,
    mockuserEntitlementCache,
    mockInvalidateuserroleCache,
    mockInvalidateuserEntitlementCache,
  };
}

//
// Mock Logger
//

/**
 * Create a mock logger
 */
export function createMockLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  };
}

//
// Test Utilities
//

/**
 * Wait for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 1000,
  interval = 50
): Promise<void> {
  const startTime = Date.now();

  while (!condition()) {
    if (Date.now() - startTime > timeout) {
      throw new Error('Timeout waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

/**
 * Create a deferred promise
 */
export function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}
