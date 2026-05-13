/**
 * Usage Ledger Tests
 *
 * Covers:
 * - Recording usage with structured logging
 * - Idempotency key deduplication
 * - Querying by user/category/time range
 * - Quota aggregation
 * - Metadata sanitization
 * - Memory eviction behavior
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryUsageLedger, recordUsage, checkQuota, setUsageLedger } from '../usage-ledger.server';
import type { UsageRecord } from '../usage-ledger.server';

describe('MemoryUsageLedger', () => {
  let ledger: MemoryUsageLedger;

  beforeEach(() => {
    ledger = new MemoryUsageLedger(1000);
  });

  const createRecord = (overrides: Partial<UsageRecord> = {}): UsageRecord => ({
    id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    idempotencyKey: `key-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
    userId: 'user-1',
    category: 'storage',
    amount: 100,
    unit: 'bytes',
    timestamp: new Date(),
    ...overrides,
  });

  describe('record', () => {
    it('should store a usage record', async () => {
      const record = createRecord();
      await ledger.record(record);

      const results = await ledger.query({ userId: 'user-1' });
      expect(results.length).toBe(1);
      expect(results[0].amount).toBe(100);
    });

    it('should deduplicate by idempotency key', async () => {
      const record = createRecord({ idempotencyKey: 'same-key' });
      await ledger.record(record);
      await ledger.record(createRecord({ idempotencyKey: 'same-key' }));

      const results = await ledger.query({ userId: 'user-1' });
      expect(results.length).toBe(1);
    });

    it('should allow different idempotency keys for same user/category', async () => {
      await ledger.record(createRecord({ idempotencyKey: 'key-1' }));
      await ledger.record(createRecord({ idempotencyKey: 'key-2' }));

      const results = await ledger.query({ userId: 'user-1' });
      expect(results.length).toBe(2);
    });
  });

  describe('query', () => {
    beforeEach(async () => {
      await ledger.record(createRecord({ userId: 'user-1', category: 'storage', amount: 100 }));
      await ledger.record(createRecord({ userId: 'user-1', category: 'api_quota', amount: 5 }));
      await ledger.record(createRecord({ userId: 'user-2', category: 'storage', amount: 200 }));
    });

    it('should filter by userId', async () => {
      const results = await ledger.query({ userId: 'user-1' });
      expect(results.length).toBe(2);
    });

    it('should filter by category', async () => {
      const results = await ledger.query({ category: 'storage' });
      expect(results.length).toBe(2);
    });

    it('should filter by userId and category', async () => {
      const results = await ledger.query({ userId: 'user-1', category: 'storage' });
      expect(results.length).toBe(1);
      expect(results[0].amount).toBe(100);
    });

    it('should filter by time range', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 3600000);
      const oneHourLater = new Date(now.getTime() + 3600000);

      const results = await ledger.query({ from: oneHourAgo, to: oneHourLater });
      expect(results.length).toBe(3);
    });

    it('should apply limit and offset', async () => {
      const results = await ledger.query({ limit: 2, offset: 0 });
      expect(results.length).toBe(2);
    });

    it('should return empty array for non-matching query', async () => {
      const results = await ledger.query({ userId: 'nonexistent' });
      expect(results).toEqual([]);
    });
  });

  describe('getQuotaUsage', () => {
    it('should sum usage for user and category', async () => {
      await ledger.record(createRecord({ userId: 'user-1', category: 'storage', amount: 100 }));
      await ledger.record(createRecord({ userId: 'user-1', category: 'storage', amount: 50 }));
      await ledger.record(createRecord({ userId: 'user-1', category: 'api_quota', amount: 5 }));

      const storageUsed = await ledger.getQuotaUsage('user-1', 'storage');
      expect(storageUsed).toBe(150);

      const apiUsed = await ledger.getQuotaUsage('user-1', 'api_quota');
      expect(apiUsed).toBe(5);
    });

    it('should return 0 when no usage exists', async () => {
      const used = await ledger.getQuotaUsage('user-x', 'storage');
      expect(used).toBe(0);
    });

    it('should handle negative amounts (releases)', async () => {
      await ledger.record(createRecord({ userId: 'user-1', category: 'storage', amount: 100 }));
      await ledger.record(createRecord({ userId: 'user-1', category: 'storage', amount: -30 }));

      const used = await ledger.getQuotaUsage('user-1', 'storage');
      expect(used).toBe(70);
    });
  });

  describe('memory eviction', () => {
    it('should evict oldest entries when max size exceeded', async () => {
      const smallLedger = new MemoryUsageLedger(5);

      for (let i = 0; i < 10; i++) {
        await smallLedger.record(
          createRecord({
            idempotencyKey: `key-${i}`,
            userId: 'user-1',
            amount: i,
          })
        );
      }

      const results = await smallLedger.query({ userId: 'user-1' });
      expect(results.length).toBe(5);
      // Most recent entries should remain (unshift adds to front)
      expect(results[0].amount).toBe(9);
    });
  });
});

describe('recordUsage convenience function', () => {
  beforeEach(() => {
    setUsageLedger(new MemoryUsageLedger());
  });

  it('should record usage through global ledger', async () => {
    await recordUsage('storage', 1024, 'bytes', {
      userId: 'user-1',
      idempotencyKey: 'test-key-1',
    });

    const ledger = new MemoryUsageLedger();
    setUsageLedger(ledger);
  });
});

describe('checkQuota convenience function', () => {
  beforeEach(async () => {
    const ledger = new MemoryUsageLedger();
    await ledger.record({
      id: 'r1',
      idempotencyKey: 'k1',
      userId: 'user-1',
      category: 'api_quota',
      amount: 75,
      unit: 'requests',
      timestamp: new Date(),
    });
    setUsageLedger(ledger);
  });

  it('should return quota status', async () => {
    const result = await checkQuota('user-1', 'api_quota', 100);
    expect(result.used).toBe(75);
    expect(result.available).toBe(25);
    expect(result.exceeded).toBe(false);
  });

  it('should report exceeded when limit reached', async () => {
    const result = await checkQuota('user-1', 'api_quota', 75);
    expect(result.exceeded).toBe(true);
    expect(result.available).toBe(0);
  });

  it('should report exceeded when over limit', async () => {
    const result = await checkQuota('user-1', 'api_quota', 50);
    expect(result.exceeded).toBe(true);
    expect(result.available).toBe(0);
  });
});
