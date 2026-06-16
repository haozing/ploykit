import { ModuleBillingApi, ModuleBillingPlan, ModuleEntitlementsApi } from '@ploykit/module-sdk';
import type { RuntimeStore, RuntimeStoreEntitlementGrant } from '../../module-runtime/stores';
import {
  isExpired,
  subjectFromCommercialInput,
  subjectToStoredUserId,
  toEntitlementGrant,
  userSubject,
} from './commercial-ledger-utils';

interface CreateCommercialLedgerBillingInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  planCatalog: readonly ModuleBillingPlan[];
  now: () => Date;
  redeemCode(code: string, userId: string): Promise<{ ok: boolean; entitlement?: string }>;
}

export function createCommercialLedgerBilling({
  store,
  scope,
  planCatalog,
  now,
  redeemCode,
}: CreateCommercialLedgerBillingInput): {
  billing: ModuleBillingApi;
  entitlements: ModuleEntitlementsApi;
  activeEntitlements(userId: string, entitlement?: string): Promise<RuntimeStoreEntitlementGrant[]>;
} {
  async function activeEntitlements(
    userId: string,
    entitlement?: string
  ): Promise<RuntimeStoreEntitlementGrant[]> {
    const grants = await store.listEntitlements({
      productId: scope.productId,
      workspaceId: scope.workspaceId,
      userId,
      entitlement,
      status: 'active',
    });
    return grants.filter((grant) => !isExpired(grant.expiresAt, now));
  }

  const billing: ModuleBillingApi = {
    async getPlan(userId) {
      const grants = await activeEntitlements(userId);
      const planIds = new Set(grants.map((grant) => grant.planId).filter(Boolean));
      return planCatalog.find((plan) => planIds.has(plan.id)) ?? null;
    },
    async getCurrentPlan(userId) {
      const grants = await activeEntitlements(userId);
      const planIds = new Set(grants.map((grant) => grant.planId).filter(Boolean));
      return planCatalog.find((plan) => planIds.has(plan.id)) ?? null;
    },
    async hasEntitlement(userId, entitlement) {
      return (await activeEntitlements(userId, entitlement)).length > 0;
    },
    redeemCode,
  };

  const entitlements: ModuleEntitlementsApi = {
    async has(input, entitlement) {
      const subject = typeof input === 'string' ? userSubject(input) : input.subject;
      const resolvedEntitlement = typeof input === 'string' ? entitlement : input.entitlement;
      if (!resolvedEntitlement) {
        return false;
      }
      return (
        (await activeEntitlements(subjectToStoredUserId(subject), resolvedEntitlement)).length > 0
      );
    },
    async list(input = {}) {
      const subject = subjectFromCommercialInput(input);
      const grants = await store.listEntitlements({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        userId: input.subject || input.userId ? subjectToStoredUserId(subject) : undefined,
        entitlement: input.entitlement,
        status: input.status,
      });
      return grants.map(toEntitlementGrant);
    },
    async grant(input) {
      const subject = subjectFromCommercialInput(input);
      const grant = await store.grantEntitlement({
        ...scope,
        userId: subjectToStoredUserId(subject),
        entitlement: input.entitlement,
        planId: input.planId,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        metadata: {
          ...(input.metadata ?? {}),
          subject,
          sourceId: input.sourceId,
        },
      });
      return toEntitlementGrant(grant);
    },
    async revoke(input) {
      return toEntitlementGrant(
        await store.revokeEntitlement(input.id, {
          ...(input.metadata ?? {}),
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
        })
      );
    },
    async override(input) {
      return toEntitlementGrant(
        await store.overrideEntitlement(input.id, {
          status: input.status,
          expiresAt: input.expiresAt,
          metadata: {
            ...(input.metadata ?? {}),
            idempotencyKey: input.idempotencyKey,
          },
        })
      );
    },
    async expire(input = {}) {
      const cutoff = input.before ? new Date(input.before).getTime() : now().getTime();
      const grants = await store.listEntitlements({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        status: 'active',
      });
      let expired = 0;
      for (const grant of grants) {
        if (input.limit && expired >= input.limit) {
          break;
        }
        if (grant.expiresAt && new Date(grant.expiresAt).getTime() <= cutoff) {
          await store.overrideEntitlement(grant.id, {
            status: 'expired',
            metadata: { reason: 'expire' },
          });
          expired += 1;
        }
      }
      return { expired };
    },
  };

  return { billing, entitlements, activeEntitlements };
}
