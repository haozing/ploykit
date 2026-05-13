/**
 * Database Mocking Utilities for Testing
 *
 * Provides utilities to mock Drizzle ORM database operations
 * for unit and integration tests.
 */

import { vi, expect } from 'vitest';

/**
 * Mock database instance with common operations
 */
export const createMockDb = () => {
  return {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    offset: vi.fn().mockReturnThis(),
    groupBy: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    execute: vi.fn().mockResolvedValue([]),
    then: vi.fn((cb) => cb([])), // For promise chaining
  };
};

/**
 * Create a mock query result
 */
export const createMockQueryResult = <T>(data: T[]) => {
  return Promise.resolve(data);
};

/**
 * Mock data factories for common entities
 */
export const mockFactories = {
  /**
   */
  auditLog: (overrides = {}) => ({
    id: 'audit-123',
    userId: 'user-123',
    userEmail: 'user@example.com',
    userName: 'Test user',
    action: 'plan.upgraded',
    resource: 'entitlement',
    resourceId: 'entitlement-123',
    resourceName: 'Test Entitlement',
    status: 'success',
    ipAddress: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    errorMessage: null,
    errorStack: null,
    metadata: {},
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }),

  role: (overrides = {}) => ({
    id: 'role-123',
    name: 'Admin',
    slug: 'admin',
    description: 'Administrator role',
    permissions: ['users:read', 'users:write', 'settings:write'],
    isDefault: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }),

  userrole: (overrides = {}) => ({
    id: 'user-role-123',
    userId: 'user-123',
    roleId: 'role-123',
    grantedBy: 'admin-123',
    grantedAt: new Date('2024-01-01'),
    expiresAt: null,
    ...overrides,
  }),

  /**
   */
  entitlementPlan: (overrides = {}) => ({
    id: '550e8400-e29b-41d4-a716-446655440100',
    name: 'Free Plan',
    slug: 'free',
    description: 'Free tier for all users',
    features: {
      'platform.apiAccess': false,
      'platform.webhooksAccess': false,
      'platform.premiumTools': false,
      'platform.advancedFeatures': false,
      'platform.prioritySupport': false,
      'platform.toolsAccess': 'basic',
    },
    limits: {
      monthly: {
        'platform.apiCalls': 1000,
        'platform.hooks': 3,
        'platform.plugins': 10,
        'platform.storageBytes': 100 * 1024 * 1024,
      },
      yearly: {
        'platform.apiCalls': 12000,
        'platform.hooks': 3,
        'platform.plugins': 10,
        'platform.storageBytes': 100 * 1024 * 1024,
      },
    },
    pricing: {
      currency: 'USD',
    },
    sortOrder: 0,
    isActive: true,
    isDefault: true,
    metadata: {},
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }),

  /**
   */
  userEntitlement: (overrides = {}) => ({
    id: '650e8400-e29b-41d4-a716-446655440200',
    userId: 'user-123',
    planId: '550e8400-e29b-41d4-a716-446655440100',
    status: 'active',
    billingInterval: 'monthly',
    startDate: new Date('2024-01-01'),
    endDate: null,
    currentPeriodStart: new Date('2024-01-01'),
    currentPeriodEnd: new Date('2024-02-01'),
    trialEndDate: null,
    cancelledAt: null,
    cancelAtPeriodEnd: false,
    quotaPeriodStart: new Date('2024-01-01'),
    quotaPeriodEnd: new Date('2024-02-01'),
    usageMetrics: {
      'platform.apiCalls': 0,
      'platform.hooksCreated': 0,
      'platform.pluginsInstalled': 0,
      'platform.storageBytes': 0,
    },
    usageUpdatedAt: new Date('2024-01-01'),
    stripeSubscriptionId: null,
    stripeCustomerId: null,
    stripeSubscriptionStatus: null,
    metadata: {},
    notes: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }),
};

/**
 * Create a fully configured mock database with pre-defined responses
 */
export const createMockDbWithData = (
  data: Partial<{
    entitlementPlans: unknown[];
    userEntitlements: unknown[];
    auditLogs: unknown[];
    roles: unknown[];
    userroles: unknown[];
  }> = {}
) => {
  const db = createMockDb();

  // Override the then method to return appropriate data based on the query
  db.then = vi.fn((cb) => {
    // This is a simplified mock - in real tests you'd match based on query type
    if (data.entitlementPlans) return cb(data.entitlementPlans);
    if (data.userEntitlements) return cb(data.userEntitlements);
    if (data.auditLogs) return cb(data.auditLogs);
    if (data.roles) return cb(data.roles);
    if (data.userroles) return cb(data.userroles);
    return cb([]);
  });

  return db;
};

/**
 * Mock SQL tagged template literal for Drizzle
 */
export const mockSql = {
  raw: vi.fn((str: string) => str),
  identifier: vi.fn((name: string) => name),
};

/**
 * Assert that a database operation was called with specific values
 */
export const assertDbOperation = (
  mockDb: ReturnType<typeof createMockDb>,
  operation: 'insert' | 'update' | 'delete' | 'select',
  expectedCalls: number = 1
) => {
  expect(mockDb[operation]).toHaveBeenCalledTimes(expectedCalls);
};

/**
 * Reset all mocks in a mock database
 */
export const resetDbMocks = (mockDb: ReturnType<typeof createMockDb>) => {
  Object.values(mockDb).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) {
      fn.mockClear();
    }
  });
};
