/**
 *
 *
 *
 */

import { describe, it, expect, beforeEach, afterEach as _afterEach, vi } from 'vitest';
import { recordUsage, resetUsage } from '../usage-recorder';
import type { RecordUsageOptions, ResetUsageOptions } from '../types';

//
// Mock Module
//

// MockDatabaseModule
vi.mock('@/lib/db', () => {
  const mockTx = {
    update: vi.fn(() => mockTx),
    set: vi.fn(() => mockTx),
    where: vi.fn(() => mockTx),
    returning: vi.fn(() => Promise.resolve([{ id: 'entitlement-1' }])),
    insert: vi.fn(() => ({
      values: vi.fn(() => Promise.resolve()),
    })),
    query: {
      userEntitlements: {
        findFirst: vi.fn(),
      },
    },
  };

  return {
    db: {
      query: {
        userEntitlements: {
          findFirst: vi.fn(),
        },
      },
      transaction: vi.fn((callback) => callback(mockTx)),
      update: vi.fn(() => mockTx),
      set: vi.fn(() => mockTx),
      where: vi.fn(() => mockTx),
      returning: vi.fn(() => Promise.resolve([{ id: 'entitlement-1' }])),
    },
  };
});

// Mock loggerModule
vi.mock('@/lib/_core/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { db } from '@/lib/db';
import { logger } from '@/lib/_core/logger';

//
//

describe('recordUsage()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Success场景', () => {
    it('shouldSuccessRecord配额Use（正增量）', async () => {
      const mockEntitlement = {
        id: 'entitlement-1',
        userId: 'user-1',
        usageMetrics: {
          'runlynk.jobExecutionsPerMonth': 5,
        },
      };

      (db.query.userEntitlements.findFirst as any).mockResolvedValue(mockEntitlement);

      const options: RecordUsageOptions = {
        userId: 'user-1',
        entitlementId: 'entitlement-1',
        metric: 'runlynk.jobExecutionsPerMonth',
        delta: 3,
        metadata: { pluginId: 'runlynk' },
      };

      const result = await recordUsage(options);

      // Assert: ValidationResult
      expect(result).toEqual({
        success: true,
        newValue: 8, // 5 + 3
        metric: 'runlynk.jobExecutionsPerMonth',
      });

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          metric: 'runlynk.jobExecutionsPerMonth',
          delta: 3,
          newValue: 8,
        }),
        'Usage recorded'
      );
    });

    it('shouldSupports负增量（并发槽位释放）', async () => {
      // Arrange
      const mockEntitlement = {
        id: 'entitlement-1',
        userId: 'user-1',
        usageMetrics: {
          'runlynk.concurrentJobs': 3,
        },
      };

      (db.query.userEntitlements.findFirst as any).mockResolvedValue(mockEntitlement);

      const options: RecordUsageOptions = {
        userId: 'user-1',
        entitlementId: 'entitlement-1',
        metric: 'runlynk.concurrentJobs',
        delta: -1, // 1并发槽位
        metadata: { pluginId: 'runlynk' },
      };

      // Act
      const result = await recordUsage(options);

      // Assert
      expect(result.newValue).toBe(2); // 3 - 1
      expect(result.success).toBe(true);
    });

    it('should处理from0Startofmetric', async () => {
      // Arrange
      const mockEntitlement = {
        id: 'entitlement-1',
        userId: 'user-1',
        usageMetrics: {}, // Object，没有jobExecutionsPerMonthField
      };

      (db.query.userEntitlements.findFirst as any).mockResolvedValue(mockEntitlement);

      const options: RecordUsageOptions = {
        userId: 'user-1',
        entitlementId: 'entitlement-1',
        metric: 'runlynk.jobExecutionsPerMonth',
        delta: 1,
        metadata: { pluginId: 'runlynk' },
      };

      // Act
      const result = await recordUsage(options);

      // Assert
      expect(result.newValue).toBe(1); // 0 + 1
    });

    it('shouldInsertusage_historyRecord', async () => {
      // Arrange
      const mockEntitlement = {
        id: 'entitlement-1',
        userId: 'user-1',
        usageMetrics: { 'platform.apiCalls': 10 },
      };

      (db.query.userEntitlements.findFirst as any).mockResolvedValue(mockEntitlement);

      const mockTxInsert = vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      }));

      (db.transaction as any).mockImplementation(async (callback: any) => {
        const mockTx = {
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => Promise.resolve()),
            })),
          })),
          insert: mockTxInsert,
          query: { userEntitlements: { findFirst: vi.fn().mockResolvedValue(mockEntitlement) } },
        };
        return await callback(mockTx);
      });

      const options: RecordUsageOptions = {
        userId: 'user-1',
        entitlementId: 'entitlement-1',
        metric: 'platform.apiCalls',
        delta: 5,
        metadata: { pluginId: 'platform' },
      };

      // Act
      await recordUsage(options);

      expect(mockTxInsert).toHaveBeenCalled();
    });
  });

  describe('Error处理', () => {
    it('should拒绝invalidofmetric格式（以数字开头）', async () => {
      // Arrange - metric 名称必须以字母开头
      const options: RecordUsageOptions = {
        userId: 'user-1',
        entitlementId: 'entitlement-1',
        metric: '123invalid', // 以数字开头是无效的
        delta: 1,
        metadata: {},
      };

      // Act & Assert
      await expect(recordUsage(options)).rejects.toThrow('Invalid metric name');
    });

    it('shouldatentitlementdoes not existwhenThrowError', async () => {
      // Arrange
      (db.query.userEntitlements.findFirst as any).mockResolvedValue(null);

      const options: RecordUsageOptions = {
        userId: 'user-1',
        entitlementId: 'entitlement-999',
        metric: 'runlynk.jobExecutionsPerMonth',
        delta: 1,
        metadata: {},
      };

      // Act & Assert
      await expect(recordUsage(options)).rejects.toThrow('Entitlement not found: entitlement-999');
    });
  });

  describe('Metric名称格式Validation', () => {
    // 有效的 metric 名称：以字母开头，只包含字母、数字和下划线
    const validMetrics = [
      'platform.apiCalls',
      'platform.storageBytes',
      'runlynk.calls',
      'runlynk.jobExecutionsPerMonth',
      'runlynk.concurrentJobs',
      'watermark-remover.calls',
      'runlynk.export_jobs',
      'seo-plus.auditRuns',
    ];

    it.each(validMetrics)('should允许有效格式metric: %s', async (metric) => {
      // Arrange
      const mockEntitlement = {
        id: 'entitlement-1',
        userId: 'user-1',
        usageMetrics: {},
      };

      (db.query.userEntitlements.findFirst as any).mockResolvedValue(mockEntitlement);

      const options: RecordUsageOptions = {
        userId: 'user-1',
        entitlementId: 'entitlement-1',
        metric,
        delta: 1,
        metadata: { pluginId: 'test' },
      };

      // Act & Assert
      await expect(recordUsage(options)).resolves.toBeDefined();
    });

    it('should拒绝无效格式ofmetric', async () => {
      // 无效的 metric 名称：以数字开头、包含非法字符
      const invalidMetrics = [
        '123invalid',
        'metric..name',
        '.metric',
        'metric.',
        'metric.name.',
        'apiCalls',
        'jobExecutionsPerMonth',
        'storageUsed',
      ];

      for (const metric of invalidMetrics) {
        const options: RecordUsageOptions = {
          userId: 'user-1',
          entitlementId: 'entitlement-1',
          metric,
          delta: 1,
          metadata: {},
        };

        await expect(recordUsage(options)).rejects.toThrow('Invalid metric name');
      }
    });

    it('should拒绝空字符串metric', async () => {
      const options: RecordUsageOptions = {
        userId: 'user-1',
        entitlementId: 'entitlement-1',
        metric: '',
        delta: 1,
        metadata: {},
      };

      await expect(recordUsage(options)).rejects.toThrow('Metric name is required');
    });
  });
});

//
//

describe('resetUsage()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: 创建支持 select().from().where() 和 update().set().where() 的 mockTx
  const createMockTx = (
    entitlements: Array<{ id: string; usageMetrics?: Record<string, unknown> }>
  ) => ({
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve(entitlements)),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => Promise.resolve()),
      })),
    })),
  });

  describe('Success场景', () => {
    it('should重置Alluserof配额', async () => {
      // Arrange
      const mockEntitlements = [
        { id: 'entitlement-1', usageMetrics: { 'runlynk.jobExecutionsPerMonth': 10 } },
        { id: 'entitlement-2', usageMetrics: { 'runlynk.jobExecutionsPerMonth': 20 } },
        { id: 'entitlement-3', usageMetrics: { 'runlynk.jobExecutionsPerMonth': 30 } },
      ];

      (db.transaction as any).mockImplementation(async (callback: any) => {
        return await callback(createMockTx(mockEntitlements));
      });

      const options: ResetUsageOptions = {
        metric: 'runlynk.jobExecutionsPerMonth',
        value: 0,
      };

      // Act
      await resetUsage(options);

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: 'runlynk.jobExecutionsPerMonth',
          value: 0,
          planId: 'all',
          affectedRecords: 3,
        }),
        'Usage reset completed'
      );
    });

    it('should仅重置特定Planofuser', async () => {
      // Arrange
      const mockEntitlements = [
        { id: 'entitlement-1', usageMetrics: { 'platform.apiCallsPerDay': 100 } },
      ];

      (db.transaction as any).mockImplementation(async (callback: any) => {
        return await callback(createMockTx(mockEntitlements));
      });

      const options: ResetUsageOptions = {
        metric: 'platform.apiCallsPerDay',
        value: 0,
        planId: 'plan-pro',
      };

      // Act
      await resetUsage(options);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          planId: 'plan-pro',
          affectedRecords: 1,
        }),
        'Usage reset completed'
      );
    });

    it('shouldSupportscustom重置值', async () => {
      // Arrange - 空 entitlements 数组
      (db.transaction as any).mockImplementation(async (callback: any) => {
        return await callback(createMockTx([]));
      });

      const options: ResetUsageOptions = {
        metric: 'runlynk.concurrentJobs',
        value: 5, // as5而非0
      };

      // Act
      await resetUsage(options);

      // Assert
      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          value: 5,
        }),
        'Usage reset completed'
      );
    });
  });

  describe('Error处理', () => {
    it('should拒绝invalidofmetric格式', async () => {
      // Arrange - metric 名称必须以字母开头
      const options: ResetUsageOptions = {
        metric: '123invalidMetric', // 以数字开头是无效的
        value: 0,
      };

      // Act & Assert
      await expect(resetUsage(options)).rejects.toThrow('Invalid metric name');
    });
  });

  describe('事务保护', () => {
    it('shouldat事务内执行Update', async () => {
      // Arrange
      const mockTx = createMockTx([{ id: 'entitlement-1', usageMetrics: {} }]);

      const transactionSpy = vi
        .spyOn(db, 'transaction')
        .mockImplementation(async (callback: any) => await callback(mockTx));

      const options: ResetUsageOptions = {
        metric: 'platform.apiCalls',
        value: 0,
      };

      // Act
      await resetUsage(options);

      expect(transactionSpy).toHaveBeenCalledTimes(1);
    });

    it('shouldatUpdateFailedwhen回滚事务', async () => {
      // Arrange
      const mockError = new Error('Database error');

      (db.transaction as any).mockImplementation(async (callback: any) => {
        // Mock that returns entitlements but fails on update
        const mockTx = {
          select: vi.fn(() => ({
            from: vi.fn(() => ({
              where: vi.fn(() => Promise.resolve([{ id: 'entitlement-1', usageMetrics: {} }])),
            })),
          })),
          update: vi.fn(() => ({
            set: vi.fn(() => ({
              where: vi.fn(() => Promise.reject(mockError)),
            })),
          })),
        };
        return await callback(mockTx);
      });

      const options: ResetUsageOptions = {
        metric: 'runlynk.jobExecutionsPerMonth',
        value: 0,
      };

      // Act & Assert - DatabaseError wraps the original error
      await expect(resetUsage(options)).rejects.toThrow('Failed to reset usage');
    });
  });
});
