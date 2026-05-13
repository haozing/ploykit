import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eq, gt, isNull, lte } from 'drizzle-orm';
import { digitalEntitlements } from '@/lib/db/schema';
import { auditLogDurable } from '@/lib/services/audit/audit-service';
import {
  grantDigitalEntitlement,
  hasDigitalEntitlement,
  revokeDigitalEntitlement,
} from '../digital-entitlement-service';

const dbMocks = vi.hoisted(() => {
  const selectChain: any = {};
  selectChain.from = vi.fn(() => selectChain);
  selectChain.where = vi.fn(() => selectChain);
  selectChain.limit = vi.fn();

  const updateChain: any = {};
  updateChain.set = vi.fn(() => updateChain);
  updateChain.where = vi.fn(() => updateChain);
  updateChain.returning = vi.fn();

  const insertChain: any = {};
  insertChain.values = vi.fn(() => insertChain);
  insertChain.returning = vi.fn();

  const database = {
    select: vi.fn(() => selectChain),
    update: vi.fn(() => updateChain),
    insert: vi.fn(() => insertChain),
  };

  return {
    database,
    selectChain,
    updateChain,
    insertChain,
  };
});

vi.mock('@/lib/db', () => ({
  withSystemContext: vi.fn((callback) => callback(dbMocks.database)),
}));

vi.mock('@/lib/db/schema', () => ({
  digitalEntitlements: {
    id: 'digitalEntitlements.id',
    userId: 'digitalEntitlements.userId',
    pluginId: 'digitalEntitlements.pluginId',
    entitlementKey: 'digitalEntitlements.entitlementKey',
    orderId: 'digitalEntitlements.orderId',
    status: 'digitalEntitlements.status',
    sourceType: 'digitalEntitlements.sourceType',
    metadata: 'digitalEntitlements.metadata',
    grantedAt: 'digitalEntitlements.grantedAt',
    revokedAt: 'digitalEntitlements.revokedAt',
    expiresAt: 'digitalEntitlements.expiresAt',
    updatedAt: 'digitalEntitlements.updatedAt',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...conditions) => ({ op: 'and', conditions })),
  eq: vi.fn((left, right) => ({ op: 'eq', left, right })),
  gt: vi.fn((left, right) => ({ op: 'gt', left, right })),
  isNull: vi.fn((column) => ({ op: 'isNull', column })),
  lte: vi.fn((left, right) => ({ op: 'lte', left, right })),
  or: vi.fn((...conditions) => ({ op: 'or', conditions })),
}));

vi.mock('@/lib/services/audit/audit-service', () => ({
  auditLogDurable: vi.fn(),
}));

describe('digital entitlement service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.selectChain.limit.mockReset();
    dbMocks.updateChain.where.mockReset();
    dbMocks.updateChain.where.mockReturnValue(dbMocks.updateChain);
    dbMocks.updateChain.returning.mockReset();
    dbMocks.insertChain.returning.mockReset();
  });

  it('requires an active non-expired entitlement and allows plugin routes to use global keys', async () => {
    dbMocks.selectChain.limit.mockResolvedValue([{ id: 'entitlement-1' }]);

    await expect(
      hasDigitalEntitlement({
        userId: 'user-1',
        pluginId: 'plugin-a',
        entitlementKey: 'premium.export',
      })
    ).resolves.toBe(true);

    expect(dbMocks.database.select).toHaveBeenCalledWith({ id: digitalEntitlements.id });
    expect(eq).toHaveBeenCalledWith(digitalEntitlements.userId, 'user-1');
    expect(eq).toHaveBeenCalledWith(digitalEntitlements.entitlementKey, 'premium.export');
    expect(eq).toHaveBeenCalledWith(digitalEntitlements.status, 'active');
    expect(eq).toHaveBeenCalledWith(digitalEntitlements.pluginId, 'plugin-a');
    expect(isNull).toHaveBeenCalledWith(digitalEntitlements.revokedAt);
    expect(isNull).toHaveBeenCalledWith(digitalEntitlements.expiresAt);
    expect(isNull).toHaveBeenCalledWith(digitalEntitlements.pluginId);
    expect(gt).toHaveBeenCalledWith(digitalEntitlements.expiresAt, expect.any(Date));
  });

  it('expires stale active rows before granting a replacement entitlement', async () => {
    const created = {
      id: 'entitlement-2',
      userId: 'user-1',
      pluginId: 'plugin-a',
      entitlementKey: 'premium.export',
      status: 'active',
    };
    dbMocks.selectChain.limit.mockResolvedValue([]);
    dbMocks.insertChain.returning.mockResolvedValue([created]);

    await expect(
      grantDigitalEntitlement({
        userId: 'user-1',
        pluginId: 'plugin-a',
        entitlementKey: 'premium.export',
        orderId: '00000000-0000-0000-0000-000000000001',
        sourceType: 'one_time_purchase',
        metadata: { provider: 'stripe' },
      })
    ).resolves.toBe(created);

    expect(dbMocks.database.update).toHaveBeenCalledWith(digitalEntitlements);
    expect(dbMocks.updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'expired', updatedAt: expect.any(Date) })
    );
    expect(lte).toHaveBeenCalledWith(digitalEntitlements.expiresAt, expect.any(Date));
    expect(dbMocks.database.insert).toHaveBeenCalledWith(digitalEntitlements);
    expect(dbMocks.insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        pluginId: 'plugin-a',
        entitlementKey: 'premium.export',
        orderId: '00000000-0000-0000-0000-000000000001',
        status: 'active',
        sourceType: 'one_time_purchase',
        metadata: { provider: 'stripe' },
      })
    );
    expect(auditLogDurable).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'entitlement.assign',
        resource: 'digital_entitlement',
        resourceId: 'entitlement-2',
        status: 'success',
      })
    );
  });

  it('reuses an existing active entitlement instead of creating a duplicate', async () => {
    const existing = {
      id: 'entitlement-existing',
      userId: 'user-1',
      pluginId: null,
      entitlementKey: 'premium.export',
      status: 'active',
    };
    dbMocks.selectChain.limit.mockResolvedValue([existing]);

    await expect(
      grantDigitalEntitlement({
        userId: 'user-1',
        entitlementKey: 'premium.export',
      })
    ).resolves.toBe(existing);

    expect(dbMocks.database.insert).not.toHaveBeenCalled();
    expect(auditLogDurable).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'entitlement.assign',
        resourceId: 'entitlement-existing',
      })
    );
  });

  it('revokes only an active exact plugin entitlement', async () => {
    const revoked = {
      id: 'entitlement-revoked',
      userId: 'user-1',
      pluginId: 'plugin-a',
      entitlementKey: 'premium.export',
      status: 'revoked',
    };
    dbMocks.updateChain.returning.mockResolvedValue([revoked]);

    await expect(
      revokeDigitalEntitlement({
        userId: 'user-1',
        pluginId: 'plugin-a',
        entitlementKey: 'premium.export',
        reason: 'refund',
      })
    ).resolves.toBe(revoked);

    expect(dbMocks.database.update).toHaveBeenCalledWith(digitalEntitlements);
    expect(dbMocks.updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'revoked',
        revokedAt: expect.any(Date),
        metadata: { revokeReason: 'refund' },
      })
    );
    expect(eq).toHaveBeenCalledWith(digitalEntitlements.pluginId, 'plugin-a');
    expect(auditLogDurable).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'entitlement.revoke',
        resource: 'digital_entitlement',
        resourceId: 'entitlement-revoked',
        status: 'success',
      })
    );
  });
});
