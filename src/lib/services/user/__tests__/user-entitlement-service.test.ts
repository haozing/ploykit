/**
 * Integration Tests for user Entitlement Service
 *
 * Tests cover critical financial logic including:
 * - Subscription lifecycle (create, upgrade, cancel, expire)
 * - Feature and quota permission checks
 * - Usage tracking and metering
 * - Transaction safety and concurrency
 * - Cache invalidation
 * - Audit trail verification
 *
 * Test failures here indicate potential financial impact
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockFactories } from '@/lib/test-utils/db-mock';

// Test UUIDs (valid UUID v4 format)
const TEST_IDS = {
  USER_123: '550e8400-e29b-41d4-a716-446655440001',
  USER_456: '550e8400-e29b-41d4-a716-446655440002',
  PLAN_FREE: '550e8400-e29b-41d4-a716-446655440100',
  PLAN_PRO: '550e8400-e29b-41d4-a716-446655440101',
  PLAN_ENTERPRISE: '550e8400-e29b-41d4-a716-446655440102',
  ENTITLEMENT_123: '650e8400-e29b-41d4-a716-446655440200',
  ADMIN_123: '550e8400-e29b-41d4-a716-446655440010',
} as const;

// Mock modules
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      userEntitlements: {
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      entitlementPlans: {
        findFirst: vi.fn(),
      },
    },
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    for: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    returning: vi.fn(),
    transaction: vi.fn(),
    execute: vi.fn(),
  },
  withSystemContext: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  userEntitlementCache: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
  CACHE_KEYS: {
    user: {
      entitlement: (userId: string) => `user:${userId}:entitlement`,
    },
  },
  invalidateUserEntitlementCache: vi.fn(),
}));

vi.mock('@/lib/services/audit/audit-service', () => ({
  auditLogDurable: vi.fn(),
}));

vi.mock('@/lib/_core/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { db, withSystemContext } from '@/lib/db';
import { userEntitlementCache, invalidateUserEntitlementCache } from '@/lib/cache';
import { auditLogDurable as auditLog } from '@/lib/services/audit/audit-service';
import * as EntitlementService from '../user-entitlement-service';

describe('user Entitlement Service - Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ?  // Query Functions
  // ?
  describe('Query Functions', () => {
    describe('getUserEntitlement', () => {
      it('should return entitlement from cache if available', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({ userId: TEST_IDS.USER_123 }),
          plan: mockFactories.entitlementPlan(),
        };

        vi.mocked(userEntitlementCache.get).mockReturnValue(entitlement);

        const result = await EntitlementService.getUserEntitlement(TEST_IDS.USER_123);

        expect(result).toEqual(entitlement);
        expect(userEntitlementCache.get).toHaveBeenCalledWith(
          `user:${TEST_IDS.USER_123}:entitlement`
        );
        expect(db.query.userEntitlements.findFirst).not.toHaveBeenCalled();
      });

      it('should query database and cache result when cache miss', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({ userId: TEST_IDS.USER_123 }),
          plan: mockFactories.entitlementPlan(),
        };

        vi.mocked(userEntitlementCache.get).mockReturnValue(undefined);
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.getUserEntitlement(TEST_IDS.USER_123);

        expect(result).toEqual(entitlement);
        expect(db.query.userEntitlements.findFirst).toHaveBeenCalled();
        expect(userEntitlementCache.set).toHaveBeenCalledWith(
          `user:${TEST_IDS.USER_123}:entitlement`,
          entitlement
        );
      });

      it('should return null when user has no entitlement', async () => {
        vi.mocked(userEntitlementCache.get).mockReturnValue(undefined);
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(undefined);

        const result = await EntitlementService.getUserEntitlement(TEST_IDS.USER_123);

        expect(result).toBeNull();
        expect(userEntitlementCache.set).toHaveBeenCalledWith(
          `user:${TEST_IDS.USER_123}:entitlement`,
          expect.objectContaining({ __cachedNull__: true }),
          60_000
        );
      });
    });

    describe('getUserPlan', () => {
      it('should return plan from entitlement', async () => {
        const plan = mockFactories.entitlementPlan({ id: TEST_IDS.PLAN_FREE });
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan,
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.getUserPlan(TEST_IDS.USER_123);

        expect(result).toEqual(plan);
      });

      it('should return null when user has no entitlement', async () => {
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(undefined);

        const result = await EntitlementService.getUserPlan(TEST_IDS.USER_123);

        expect(result).toBeNull();
      });
    });

    describe('getUserEntitlementHistory', () => {
      it('should return all entitlements for user including expired', async () => {
        const activeEntitlement = {
          ...mockFactories.userEntitlement({ status: 'active' }),
          plan: mockFactories.entitlementPlan({ name: 'Pro Plan' }),
        };
        const expiredEntitlement = {
          ...mockFactories.userEntitlement({ status: 'expired' }),
          plan: mockFactories.entitlementPlan({ name: 'Free Plan' }),
        };

        vi.mocked(db.query.userEntitlements.findMany).mockResolvedValue([
          activeEntitlement,
          expiredEntitlement,
        ]);

        const result = await EntitlementService.getUserEntitlementHistory(TEST_IDS.USER_123);

        expect(result).toHaveLength(2);
        expect(result).toContainEqual(activeEntitlement);
        expect(result).toContainEqual(expiredEntitlement);
      });
    });
  });

  // ?  // Permission Checks (Feature-based)
  // ?
  describe('Permission Checks - Feature Based', () => {
    describe('hasFeature', () => {
      it('should return true when user has the feature', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan: mockFactories.entitlementPlan({
            features: {
              'platform.apiAccess': true,
              'platform.premiumTools': false,
            },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const hasApi = await EntitlementService.hasFeature(TEST_IDS.USER_123, 'platform.apiAccess');
        const hasPremium = await EntitlementService.hasFeature(
          TEST_IDS.USER_123,
          'platform.premiumTools'
        );

        expect(hasApi).toBe(true);
        expect(hasPremium).toBe(false);
      });

      it('should expose parameterized feature values through getFeatureValue', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan: mockFactories.entitlementPlan({
            features: {
              'seo-plus.enabled': true,
              'seo-plus.outputResolution': '4k',
              'seo-plus.keywordLimit': 250,
            },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        await expect(
          EntitlementService.getFeatureValue(TEST_IDS.USER_123, 'seo-plus.outputResolution')
        ).resolves.toBe('4k');
        await expect(
          EntitlementService.getFeatureValue(TEST_IDS.USER_123, 'seo-plus.keywordLimit')
        ).resolves.toBe(250);
        await expect(
          EntitlementService.hasFeature(TEST_IDS.USER_123, 'seo-plus.outputResolution')
        ).resolves.toBe(false);
        await expect(
          EntitlementService.hasFeature(TEST_IDS.USER_123, 'seo-plus.enabled')
        ).resolves.toBe(true);
      });

      it('should return false when user has no entitlement', async () => {
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(undefined);

        const result = await EntitlementService.hasFeature(TEST_IDS.USER_123, 'platform.apiAccess');

        expect(result).toBe(false);
      });
    });

    describe('hasAPIAccess', () => {
      it('should return true when user has API access feature', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.apiAccess': true },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.hasAPIAccess(TEST_IDS.USER_123);

        expect(result).toBe(true);
      });
    });

    describe('canCreateWebhook', () => {
      it('should return true when user has webhook feature', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.webhooksAccess': true },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.canCreateWebhook(TEST_IDS.USER_123);

        expect(result).toBe(true);
      });
    });

    describe('getToolsAccessLevel', () => {
      it('should return correct access level', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.toolsAccess': 'premium' },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.getToolsAccessLevel(TEST_IDS.USER_123);

        expect(result).toBe('premium');
      });

      it('should return null when user has no entitlement', async () => {
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(undefined);

        const result = await EntitlementService.getToolsAccessLevel(TEST_IDS.USER_123);

        expect(result).toBeNull();
      });
    });
  });

  // ?  // Permission Checks (Feature + Quota Combined)
  // ?
  describe('Permission Checks - Feature + Quota Combined', () => {
    describe('canCallAPI', () => {
      it('should return false when user lacks API access feature', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.apiAccess': false },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.canCallAPI(TEST_IDS.USER_123);

        expect(result).toBe(false);
      });

      it('should return false when user has feature but exceeded quota', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({
            usageMetrics: { 'platform.apiCalls': 1000 }, // At limit
          }),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.apiAccess': true },
            limits: { monthly: { 'platform.apiCalls': 1000 } },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.canCallAPI(TEST_IDS.USER_123);

        expect(result).toBe(false);
      });

      it('should return true when user has feature and quota available', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({
            usageMetrics: { 'platform.apiCalls': 500 },
          }),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.apiAccess': true },
            limits: { monthly: { 'platform.apiCalls': 1000 } },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.canCallAPI(TEST_IDS.USER_123);

        expect(result).toBe(true);
      });

      it('should return true when user has unlimited quota', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({
            usageMetrics: { 'platform.apiCalls': 50000 },
          }),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.apiAccess': true },
            limits: {}, // No limit defined = unlimited
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.canCallAPI(TEST_IDS.USER_123);

        expect(result).toBe(true);
      });
    });

    describe('canCreateHook', () => {
      it('should check both feature and quota for hook creation', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({
            usageMetrics: { 'platform.hooksCreated': 2 },
          }),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.hookCreate': true },
            limits: { monthly: { 'platform.hooks': 3 } },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.canCreateHook(TEST_IDS.USER_123);

        expect(result).toBe(true);
      });
    });

    describe('canInstallPlugin', () => {
      it('should check both feature and quota for plugin installation', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({
            usageMetrics: { 'platform.pluginsInstalled': 10 },
          }),
          plan: mockFactories.entitlementPlan({
            features: { 'platform.pluginInstall': true },
            limits: { monthly: { 'platform.plugins': 10 } },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.canInstallPlugin(TEST_IDS.USER_123);

        expect(result).toBe(false); // At limit
      });
    });

    describe('getRemainingQuota', () => {
      it('should calculate remaining quota correctly', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({
            usageMetrics: { 'platform.apiCalls': 300 },
          }),
          plan: mockFactories.entitlementPlan({
            limits: { monthly: { 'platform.apiCalls': 1000 } },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.getRemainingQuota(
          TEST_IDS.USER_123,
          'platform.apiCalls',
          'platform.apiCalls'
        );

        expect(result).toBe(700);
      });

      it('should return -1 for unlimited quota', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan: mockFactories.entitlementPlan({
            limits: {}, // No limit
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.getRemainingQuota(
          TEST_IDS.USER_123,
          'platform.apiCalls',
          'platform.apiCalls'
        );

        expect(result).toBe(-1);
      });

      it('should read monthly/yearly limits through one resolver', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({
            billingInterval: 'yearly',
            usageMetrics: {
              'platform.apiCalls': 300,
              'seo-plus.auditRuns': 4,
            },
          }),
          plan: mockFactories.entitlementPlan({
            limits: {
              monthly: {
                'platform.apiCalls': 1000,
                'seo-plus.auditRuns': 10,
              },
              yearly: {
                'platform.apiCalls': 1200,
                'seo-plus.auditRuns': 20,
              },
            },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        await expect(
          EntitlementService.getLimitValue(TEST_IDS.USER_123, 'platform.apiCalls')
        ).resolves.toBe(1200);
        await expect(
          EntitlementService.getRemainingQuota(
            TEST_IDS.USER_123,
            'seo-plus.auditRuns',
            'seo-plus.auditRuns'
          )
        ).resolves.toBe(16);
      });

      it('should return 0 when user has no entitlement', async () => {
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(undefined);

        const result = await EntitlementService.getRemainingQuota(
          TEST_IDS.USER_123,
          'platform.apiCalls',
          'platform.apiCalls'
        );

        expect(result).toBe(0);
      });
    });
  });

  // ?  // Usage Tracking
  // ?
  describe('Usage Tracking', () => {
    // Helper to create mock for atomic update operations
    const createAtomicUpdateMock = (
      returnResult: { id: string }[] = [{ id: TEST_IDS.ENTITLEMENT_123 }]
    ) => {
      vi.mocked(db.update).mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue(returnResult),
          }),
        }),
      } as any);
    };

    describe('trackMetric', () => {
      it('should atomically increment metric and return true on success', async () => {
        createAtomicUpdateMock();

        const result = await EntitlementService.trackMetric(
          TEST_IDS.USER_123,
          'platform.apiCalls',
          1
        );

        expect(db.update).toHaveBeenCalled();
        expect(result).toBe(true);
      });

      it('should return false when no active entitlement found', async () => {
        createAtomicUpdateMock([]);

        const result = await EntitlementService.trackMetric(
          TEST_IDS.USER_123,
          'platform.apiCalls',
          1
        );

        expect(result).toBe(false);
      });

      it('should support custom metrics', async () => {
        createAtomicUpdateMock();

        const result = await EntitlementService.trackMetric(
          TEST_IDS.USER_123,
          'platform.hooksCreated',
          1
        );

        expect(db.update).toHaveBeenCalled();
        expect(result).toBe(true);
      });

      it('should support plugin-scoped metrics', async () => {
        createAtomicUpdateMock();

        const result = await EntitlementService.trackMetric(
          TEST_IDS.USER_123,
          'seo-plus.auditRuns',
          1
        );

        expect(db.update).toHaveBeenCalled();
        expect(result).toBe(true);
      });

      it('should support decrement with negative delta', async () => {
        createAtomicUpdateMock();

        const result = await EntitlementService.trackMetric(
          TEST_IDS.USER_123,
          'runlynk.channels',
          -1
        );

        expect(db.update).toHaveBeenCalled();
        expect(result).toBe(true);
      });
    });

    describe('setMetric', () => {
      it('should set metric to specific value', async () => {
        createAtomicUpdateMock();

        const result = await EntitlementService.setMetric(
          TEST_IDS.USER_123,
          'platform.storageBytes',
          50
        );

        expect(db.update).toHaveBeenCalled();
        expect(result).toBe(true);
      });
    });

    describe('resetUsageMetrics', () => {
      it('should reset specific usage metrics', async () => {
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue({
          usageMetrics: { 'platform.apiCalls': 100, 'platform.hooksCreated': 5 },
        } as any);
        vi.mocked(db.update).mockReturnValue({
          set: vi.fn().mockReturnValue({
            where: vi.fn().mockResolvedValue([]),
          }),
        } as any);

        await EntitlementService.resetUsageMetrics(TEST_IDS.USER_123, ['platform.apiCalls']);

        expect(db.update).toHaveBeenCalled();
      });
    });
  });

  // ?  // Subscription Management (CRITICAL - Financial Logic)
  // ?
  describe('Subscription Management - CRITICAL', () => {
    describe('createUserEntitlement', () => {
      it('should create entitlement within transaction and invalidate cache', async () => {
        const newEntitlement = mockFactories.userEntitlement({
          userId: TEST_IDS.USER_123,
          planId: TEST_IDS.PLAN_FREE,
        });

        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([newEntitlement]),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        const result = await EntitlementService.createUserEntitlement({
          userId: TEST_IDS.USER_123,
          planId: TEST_IDS.PLAN_FREE,
          status: 'active',
          startDate: new Date(),
          usageMetrics: {},
        });

        expect(result).toEqual(newEntitlement);
        expect(invalidateUserEntitlementCache).toHaveBeenCalledWith(TEST_IDS.USER_123);
        expect(auditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'entitlement.created',
            userId: TEST_IDS.USER_123,
          })
        );
      });

      it('should deactivate existing entitlements before creating new one', async () => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([mockFactories.userEntitlement()]),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await EntitlementService.createUserEntitlement({
          userId: TEST_IDS.USER_123,
          planId: TEST_IDS.PLAN_PRO,
          status: 'active',
          startDate: new Date(),
          usageMetrics: {},
        });

        // Should update existing entitlements to inactive
        expect(mockTx.update).toHaveBeenCalled();
      });

      it('should skip audit logging when skipAudit is true', async () => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([mockFactories.userEntitlement()]),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await EntitlementService.createUserEntitlement(
          {
            userId: TEST_IDS.USER_123,
            planId: TEST_IDS.PLAN_FREE,
            status: 'active',
            startDate: new Date(),
            usageMetrics: {},
          },
          { skipAudit: true }
        );

        expect(auditLog).not.toHaveBeenCalled();
      });
    });

    describe('createDefaultEntitlement', () => {
      it('should create free plan entitlement for new user', async () => {
        const freePlan = mockFactories.entitlementPlan({
          id: TEST_IDS.PLAN_FREE,
          isDefault: true,
          isActive: true,
        });
        const entitlement = mockFactories.userEntitlement({
          userId: TEST_IDS.USER_123,
          planId: TEST_IDS.PLAN_FREE,
        });

        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([freePlan]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockResolvedValue([]),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([entitlement]),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        const result = await EntitlementService.createDefaultEntitlement(TEST_IDS.USER_123);

        expect(result).toEqual(entitlement);
        expect(invalidateUserEntitlementCache).toHaveBeenCalledWith(TEST_IDS.USER_123);
      });

      it('should throw error when no default plan found', async () => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]), // No default plan
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await expect(
          EntitlementService.createDefaultEntitlement(TEST_IDS.USER_123)
        ).rejects.toThrow('No default entitlement plan found');
      });
    });

    describe('upgradeUserPlan - CRITICAL FINANCIAL LOGIC', () => {
      it('should upgrade user plan with transaction protection', async () => {
        const proPlan = mockFactories.entitlementPlan({
          id: TEST_IDS.PLAN_PRO,
          name: 'Pro Plan',
          isActive: true,
        });
        const existingEntitlement = mockFactories.userEntitlement({
          userId: TEST_IDS.USER_123,
          planId: TEST_IDS.PLAN_FREE,
        });
        const updatedEntitlement = {
          ...existingEntitlement,
          planId: TEST_IDS.PLAN_PRO,
        };

        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([proPlan]),
                }),
                limit: vi.fn().mockResolvedValue([existingEntitlement]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([updatedEntitlement]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        const result = await EntitlementService.upgradeUserPlan(
          TEST_IDS.USER_123,
          TEST_IDS.PLAN_PRO,
          'sub_123',
          'cus_123'
        );

        expect(result.planId).toBe(TEST_IDS.PLAN_PRO);
        expect(invalidateUserEntitlementCache).toHaveBeenCalledWith(TEST_IDS.USER_123);
        expect(auditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'entitlement.upgraded',
            metadata: expect.objectContaining({
              newPlanId: TEST_IDS.PLAN_PRO,
              planName: 'Pro Plan',
            }),
          })
        );
      });

      it('should create new entitlement for first-time subscriber', async () => {
        const proPlan = mockFactories.entitlementPlan({
          id: TEST_IDS.PLAN_PRO,
          isActive: true,
        });
        const newEntitlement = mockFactories.userEntitlement({
          userId: TEST_IDS.USER_123,
          planId: TEST_IDS.PLAN_PRO,
        });

        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([proPlan]),
                }),
                limit: vi.fn().mockResolvedValue([]), // No existing entitlement
              }),
            }),
          }),
          insert: vi.fn().mockReturnValue({
            values: vi.fn().mockReturnValue({
              returning: vi.fn().mockResolvedValue([newEntitlement]),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        const result = await EntitlementService.upgradeUserPlan(
          TEST_IDS.USER_123,
          TEST_IDS.PLAN_PRO
        );

        expect(result.planId).toBe(TEST_IDS.PLAN_PRO);
      });

      it('should throw error when upgrading to inactive plan', async () => {
        const inactivePlan = mockFactories.entitlementPlan({
          id: TEST_IDS.PLAN_PRO,
          isActive: false,
        });

        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([inactivePlan]),
                }),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await expect(
          EntitlementService.upgradeUserPlan(TEST_IDS.USER_123, TEST_IDS.PLAN_PRO)
        ).rejects.toThrow('Cannot upgrade to an inactive plan');
      });

      it('should throw error when plan not found', async () => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: vi.fn().mockReturnValue({
                  limit: vi.fn().mockResolvedValue([]), // Plan not found
                }),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await expect(
          EntitlementService.upgradeUserPlan(TEST_IDS.USER_123, TEST_IDS.PLAN_PRO)
        ).rejects.toThrow('Plan not found');
      });

      it('should use SELECT FOR UPDATE for row-level locking', async () => {
        const proPlan = mockFactories.entitlementPlan({
          id: TEST_IDS.PLAN_PRO,
          isActive: true,
        });

        const mockFor = vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([proPlan]),
        });

        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                for: mockFor,
                limit: vi.fn().mockResolvedValue([mockFactories.userEntitlement()]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([mockFactories.userEntitlement()]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await EntitlementService.upgradeUserPlan(TEST_IDS.USER_123, TEST_IDS.PLAN_PRO);

        // Verify FOR UPDATE was called
        expect(mockFor).toHaveBeenCalledWith('update');
      });
    });

    describe('cancelSubscription - CRITICAL FINANCIAL LOGIC', () => {
      it('should cancel subscription immediately when requested', async () => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([mockFactories.userEntitlement()]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await EntitlementService.cancelSubscription(TEST_IDS.USER_123, true);

        expect(invalidateUserEntitlementCache).toHaveBeenCalledWith(TEST_IDS.USER_123);
        expect(auditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'entitlement.cancelled_immediately',
          })
        );
      });

      it('should schedule cancellation for end of period', async () => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([mockFactories.userEntitlement()]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await EntitlementService.cancelSubscription(TEST_IDS.USER_123, false);

        expect(auditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'entitlement.cancel_scheduled',
          })
        );
      });

      it('should throw error when user has no active subscription', async () => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]), // No active subscription
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await expect(EntitlementService.cancelSubscription(TEST_IDS.USER_123)).rejects.toThrow(
          'No active subscription found for user'
        );
      });

      it('should include cancellation reason in audit metadata', async () => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([mockFactories.userEntitlement()]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await EntitlementService.cancelSubscription(TEST_IDS.USER_123, true, {
          reason: 'user requested cancellation',
        });

        expect(auditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            metadata: expect.objectContaining({
              reason: 'user requested cancellation',
            }),
          })
        );
      });
    });

    describe('reactivateSubscription', () => {
      it('should reactivate cancelled subscription', async () => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([
                  mockFactories.userEntitlement({
                    id: TEST_IDS.ENTITLEMENT_123,
                    status: 'active',
                  }),
                ]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await EntitlementService.reactivateSubscription(
          TEST_IDS.USER_123,
          TEST_IDS.ENTITLEMENT_123
        );

        expect(invalidateUserEntitlementCache).toHaveBeenCalledWith(TEST_IDS.USER_123);
        expect(auditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'entitlement.reactivated',
            resourceId: TEST_IDS.ENTITLEMENT_123,
          })
        );
      });

      it('should throw error when no cancelled subscription found', async () => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await expect(
          EntitlementService.reactivateSubscription(TEST_IDS.USER_123, TEST_IDS.ENTITLEMENT_123)
        ).rejects.toThrow('No cancelled subscription found for user');
      });

      it('should not reactivate a cancelled historical subscription when one is already active', async () => {
        const mockTx = {
          select: vi.fn().mockReturnValue({
            from: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                limit: vi.fn().mockResolvedValue([{ id: TEST_IDS.ENTITLEMENT_123 }]),
              }),
            }),
          }),
          update: vi.fn(),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await expect(
          EntitlementService.reactivateSubscription(TEST_IDS.USER_123, TEST_IDS.ENTITLEMENT_123)
        ).rejects.toThrow('User already has an active subscription');

        expect(mockTx.update).not.toHaveBeenCalled();
      });
    });

    describe('expireSubscription', () => {
      it('should mark subscription as expired', async () => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([mockFactories.userEntitlement()]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await EntitlementService.expireSubscription(TEST_IDS.USER_123);

        expect(invalidateUserEntitlementCache).toHaveBeenCalledWith(TEST_IDS.USER_123);
        expect(auditLog).toHaveBeenCalledWith(
          expect.objectContaining({
            action: 'entitlement.expired',
            userId: 'system',
          })
        );
      });

      it('should throw error when no active subscription found', async () => {
        const mockTx = {
          update: vi.fn().mockReturnValue({
            set: vi.fn().mockReturnValue({
              where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([]),
              }),
            }),
          }),
        };

        vi.mocked(withSystemContext).mockImplementation((callback) =>
          callback({
            transaction: (txCallback: any) => txCallback(mockTx),
          } as any)
        );

        await expect(EntitlementService.expireSubscription(TEST_IDS.USER_123)).rejects.toThrow(
          'No active subscription found for user'
        );
      });
    });
  });

  // ?  // Summary Functions
  // ?
  describe('Summary Functions', () => {
    describe('getUserEntitlementSummary', () => {
      it('should return full summary with quotas calculated', async () => {
        const entitlement = {
          ...mockFactories.userEntitlement({
            userId: TEST_IDS.USER_123,
            status: 'active',
            usageMetrics: {
              'platform.apiCalls': 300,
              'platform.hooks': 1,
              'platform.plugins': 5,
            },
          }),
          plan: mockFactories.entitlementPlan({
            id: TEST_IDS.PLAN_PRO,
            name: 'Pro Plan',
            slug: 'pro',
            limits: {
              monthly: {
                'platform.apiCalls': 1000,
                'platform.hooks': 10,
                'platform.plugins': 50,
              },
            },
          }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        const result = await EntitlementService.getUserEntitlementSummary(TEST_IDS.USER_123);

        expect(result.hasEntitlement).toBe(true);
        expect(result.plan).toEqual({
          id: TEST_IDS.PLAN_PRO,
          name: 'Pro Plan',
          slug: 'pro',
        });
        expect(result.usage).toEqual({
          'platform.apiCalls': 300,
          'platform.hooks': 1,
          'platform.plugins': 5,
        });
        expect(result.quotas).toEqual({
          'platform.apiCalls': 700,
          'platform.hooks': 9,
          'platform.plugins': 45,
        });
        expect(result.status).toBe('active');
      });

      it('should return no entitlement when user has none', async () => {
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(undefined);

        const result = await EntitlementService.getUserEntitlementSummary(TEST_IDS.USER_123);

        expect(result.hasEntitlement).toBe(false);
        expect(result.plan).toBeNull();
        expect(result.limits).toEqual({});
        expect(result.usage).toEqual({});
        expect(result.quotas).toEqual({});
      });
    });
  });

  // ?  // Plan Tier Checking
  // ?
  describe('Plan Tier Checking', () => {
    describe('hasRequiredPlanTier', () => {
      it('should return true when user plan sortOrder meets or exceeds requirement', async () => {
        // User has Pro plan with sortOrder 2
        const entitlement = {
          ...mockFactories.userEntitlement(),
          plan: mockFactories.entitlementPlan({ slug: 'pro', sortOrder: 2 }),
        };

        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(entitlement);

        // Mock required plan lookups with different sortOrders
        vi.mocked(db.query.entitlementPlans.findFirst)
          .mockResolvedValueOnce({ sortOrder: 1 } as any) // hobby: sortOrder 1
          .mockResolvedValueOnce({ sortOrder: 2 } as any) // pro: sortOrder 2
          .mockResolvedValueOnce({ sortOrder: 3 } as any); // enterprise: sortOrder 3

        const hasHobby = await EntitlementService.hasRequiredPlanTier(TEST_IDS.USER_123, 'hobby');
        const hasPro = await EntitlementService.hasRequiredPlanTier(TEST_IDS.USER_123, 'pro');
        const hasEnterprise = await EntitlementService.hasRequiredPlanTier(
          TEST_IDS.USER_123,
          'enterprise'
        );

        expect(hasHobby).toBe(true); // Pro (2) >= Hobby (1)
        expect(hasPro).toBe(true); // Pro (2) >= Pro (2)
        expect(hasEnterprise).toBe(false); // Pro (2) < Enterprise (3)
      });

      it('should return true for default plan when user has no entitlement', async () => {
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(undefined);
        vi.mocked(db.query.entitlementPlans.findFirst).mockResolvedValue({
          isDefault: true,
          sortOrder: 0,
        } as any);

        const result = await EntitlementService.hasRequiredPlanTier(TEST_IDS.USER_123, 'free');

        expect(result).toBe(true);
      });

      it('should return false for paid tier when user has no entitlement', async () => {
        vi.mocked(db.query.userEntitlements.findFirst).mockResolvedValue(undefined);
        vi.mocked(db.query.entitlementPlans.findFirst).mockResolvedValue({
          isDefault: false,
          sortOrder: 2,
        } as any);

        const result = await EntitlementService.hasRequiredPlanTier(TEST_IDS.USER_123, 'pro');

        expect(result).toBe(false);
      });
    });
  });

  // ?  // Statistics Functions
  // ?
  describe('Statistics Functions', () => {
    describe('getUserEntitlementStats', () => {
      it('should return counts by subscription status using single optimized query', async () => {
        // Mock db.execute for the optimized single-query implementation
        vi.mocked(db.execute).mockResolvedValue({
          rows: [
            {
              total: '150',
              active: '100',
              trial: '20',
              cancelled: '15',
              expired: '15',
            },
          ],
        } as any);

        const stats = await EntitlementService.getUserEntitlementStats();

        expect(stats).toEqual({
          total: 150,
          active: 100,
          trial: 20,
          cancelled: 15,
          expired: 15,
        });
        expect(db.execute).toHaveBeenCalled();
      });

      it('should throw error on database failure', async () => {
        vi.mocked(db.execute).mockRejectedValue(new Error('Database error'));

        await expect(EntitlementService.getUserEntitlementStats()).rejects.toThrow(
          'Database error'
        );
      });
    });
  });
});
