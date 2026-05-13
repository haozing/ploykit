import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { withSystemContext } from '@/lib/db';
import {
  digitalEntitlements,
  type Order,
  type DigitalEntitlement,
  type DigitalEntitlementSourceType,
} from '@/lib/db/schema';
import { auditLogDurable } from '@/lib/services/audit/audit-service';

export interface DigitalEntitlementLookup {
  userId: string;
  entitlementKey: string;
  pluginId?: string | null;
}

export interface GrantDigitalEntitlementInput extends DigitalEntitlementLookup {
  orderId?: string | null;
  sourceType?: DigitalEntitlementSourceType;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown>;
  operatorId?: string;
}

export interface RevokeDigitalEntitlementInput extends DigitalEntitlementLookup {
  reason?: string;
  operatorId?: string;
  metadata?: Record<string, unknown>;
}

export interface GrantOneTimePurchaseEntitlementInput extends DigitalEntitlementLookup {
  provider?: string;
  providerOrderId: string;
  amount?: string | number;
  currency?: string;
  metadata?: Record<string, unknown>;
}

export interface RefundOneTimePurchaseEntitlementInput extends DigitalEntitlementLookup {
  originalOrderId: string;
  provider?: string;
  providerRefundId: string;
  amount: string | number;
  currency?: string;
  metadata?: Record<string, unknown>;
  reason?: string;
}

function normalizeKey(key: string): string {
  const normalized = key.trim();
  if (!normalized || normalized.length > 160 || !/^[a-zA-Z0-9._:-]+$/.test(normalized)) {
    throw new Error('Digital entitlement key must be non-empty and namespaced.');
  }
  return normalized;
}

function pluginMatcher(pluginId?: string | null) {
  return pluginId
    ? eq(digitalEntitlements.pluginId, pluginId)
    : isNull(digitalEntitlements.pluginId);
}

function exactPluginMatcher(pluginId?: string | null) {
  return pluginMatcher(pluginId);
}

function activeWhere(input: DigitalEntitlementLookup) {
  return and(
    eq(digitalEntitlements.userId, input.userId),
    eq(digitalEntitlements.entitlementKey, normalizeKey(input.entitlementKey)),
    eq(digitalEntitlements.status, 'active'),
    isNull(digitalEntitlements.revokedAt),
    or(isNull(digitalEntitlements.expiresAt), gt(digitalEntitlements.expiresAt, new Date())),
    or(pluginMatcher(input.pluginId), isNull(digitalEntitlements.pluginId))
  );
}

export async function hasDigitalEntitlement(input: DigitalEntitlementLookup): Promise<boolean> {
  const rows = await withSystemContext((database) =>
    database
      .select({ id: digitalEntitlements.id })
      .from(digitalEntitlements)
      .where(activeWhere(input))
      .limit(1)
  );

  return rows.length > 0;
}

export async function grantDigitalEntitlement(
  input: GrantDigitalEntitlementInput
): Promise<DigitalEntitlement> {
  const entitlementKey = normalizeKey(input.entitlementKey);
  const now = new Date();

  const row = await withSystemContext(async (database) => {
    await database
      .update(digitalEntitlements)
      .set({
        status: 'expired',
        updatedAt: now,
      })
      .where(
        and(
          eq(digitalEntitlements.userId, input.userId),
          eq(digitalEntitlements.entitlementKey, entitlementKey),
          exactPluginMatcher(input.pluginId),
          eq(digitalEntitlements.status, 'active'),
          isNull(digitalEntitlements.revokedAt),
          lte(digitalEntitlements.expiresAt, now)
        )
      );

    const [existing] = await database
      .select()
      .from(digitalEntitlements)
      .where(
        and(
          eq(digitalEntitlements.userId, input.userId),
          eq(digitalEntitlements.entitlementKey, entitlementKey),
          exactPluginMatcher(input.pluginId),
          eq(digitalEntitlements.status, 'active'),
          isNull(digitalEntitlements.revokedAt),
          or(isNull(digitalEntitlements.expiresAt), gt(digitalEntitlements.expiresAt, now))
        )
      )
      .limit(1);

    if (existing) {
      return existing;
    }

    const [created] = await database
      .insert(digitalEntitlements)
      .values({
        id: randomUUID(),
        userId: input.userId,
        pluginId: input.pluginId ?? null,
        entitlementKey,
        orderId: input.orderId ?? null,
        status: 'active',
        sourceType: input.sourceType ?? 'manual',
        metadata: input.metadata ?? {},
        grantedAt: now,
        expiresAt: input.expiresAt ?? null,
        updatedAt: now,
      })
      .returning();

    return created;
  });

  await auditLogDurable({
    action: 'entitlement.assign',
    resource: 'digital_entitlement',
    resourceId: row.id,
    userId: input.operatorId ?? input.userId,
    status: 'success',
    metadata: {
      userId: input.userId,
      pluginId: input.pluginId,
      entitlementKey,
      orderId: input.orderId,
      sourceType: input.sourceType ?? 'manual',
    },
  });

  return row;
}

export async function revokeDigitalEntitlement(
  input: RevokeDigitalEntitlementInput
): Promise<DigitalEntitlement | null> {
  const entitlementKey = normalizeKey(input.entitlementKey);
  const now = new Date();

  const [row] = await withSystemContext((database) =>
    database
      .update(digitalEntitlements)
      .set({
        status: 'revoked',
        revokedAt: now,
        updatedAt: now,
        metadata: {
          ...(input.metadata ?? {}),
          revokeReason: input.reason,
        },
      })
      .where(
        and(
          eq(digitalEntitlements.userId, input.userId),
          eq(digitalEntitlements.entitlementKey, entitlementKey),
          exactPluginMatcher(input.pluginId),
          eq(digitalEntitlements.status, 'active'),
          isNull(digitalEntitlements.revokedAt)
        )
      )
      .returning()
  );

  if (!row) {
    return null;
  }

  await auditLogDurable({
    action: 'entitlement.revoke',
    resource: 'digital_entitlement',
    resourceId: row.id,
    userId: input.operatorId ?? input.userId,
    status: 'success',
    metadata: {
      userId: input.userId,
      pluginId: input.pluginId,
      entitlementKey,
      reason: input.reason,
    },
  });

  return row;
}

export async function grantOneTimePurchaseEntitlement(
  input: GrantOneTimePurchaseEntitlementInput
): Promise<{ order: Order; entitlement: DigitalEntitlement }> {
  const { createOrder, getOrderByProviderId } = await import(
    '@/lib/services/billing/order-service'
  );
  const provider = input.provider ?? 'local';
  const entitlementKey = normalizeKey(input.entitlementKey);
  let order = await getOrderByProviderId(provider, input.providerOrderId);

  if (!order) {
    order = await createOrder({
      userId: input.userId,
      orderType: 'one_time_purchase',
      provider,
      providerOrderId: input.providerOrderId,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      status: 'succeeded',
      metadata: {
        ...(input.metadata ?? {}),
        pluginId: input.pluginId,
        entitlementKey,
      },
    });
  }

  const entitlement = await grantDigitalEntitlement({
    userId: input.userId,
    pluginId: input.pluginId,
    entitlementKey,
    orderId: order.id,
    sourceType: 'one_time_purchase',
    metadata: input.metadata,
    operatorId: 'system',
  });

  return { order, entitlement };
}

export async function refundOneTimePurchaseEntitlement(
  input: RefundOneTimePurchaseEntitlementInput
): Promise<{ refundOrder: Order; entitlement: DigitalEntitlement | null }> {
  const { createRefundOrder, getOrderByProviderId } = await import(
    '@/lib/services/billing/order-service'
  );
  const provider = input.provider ?? 'local';
  const entitlementKey = normalizeKey(input.entitlementKey);
  let refundOrder = await getOrderByProviderId(provider, input.providerRefundId);

  if (!refundOrder) {
    refundOrder = await createRefundOrder({
      userId: input.userId,
      provider,
      providerOrderId: input.providerRefundId,
      amount: input.amount,
      currency: input.currency ?? 'USD',
      originalOrderId: input.originalOrderId,
      metadata: {
        ...(input.metadata ?? {}),
        pluginId: input.pluginId,
        entitlementKey,
      },
    });
  }

  const entitlement = await revokeDigitalEntitlement({
    userId: input.userId,
    pluginId: input.pluginId,
    entitlementKey,
    reason: input.reason ?? `Refund ${refundOrder.id}`,
    metadata: {
      ...(input.metadata ?? {}),
      refundOrderId: refundOrder.id,
      originalOrderId: input.originalOrderId,
    },
    operatorId: 'system',
  });

  return { refundOrder, entitlement };
}
