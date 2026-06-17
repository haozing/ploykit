import type {
  RuntimeStore,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialCatalogKind,
} from '../../module-runtime/stores';
import {
  assertAdmin,
  assertIntegerAmount,
  assertPositiveIntegerAmount,
  hashRedeemCode,
  maskRedeemCode,
} from './commercial-ledger-utils';
import type { RuntimeStoreCommercialRuntime } from './commercial-ledger-types';

interface CreateCommercialAdminRuntimeInput {
  store: RuntimeStore;
  scope: {
    productId: string;
    workspaceId?: string | null;
  };
  creditBalance: (
    userId: string,
    unit?: string
  ) => ReturnType<RuntimeStoreCommercialRuntime['admin']['grantCredits']>;
  recordCredit: (input: {
    userId?: string;
    amount: number;
    unit?: string;
    reason: string;
    idempotencyKey?: string;
    expiresAt?: string;
    metadata?: Record<string, unknown>;
  }) => ReturnType<RuntimeStoreCommercialRuntime['admin']['grantCredits']>;
  validateTaxProfile: RuntimeStoreCommercialRuntime['admin']['validateTaxProfile'];
}

export function createCommercialAdminRuntime({
  store,
  scope,
  creditBalance,
  recordCredit,
  validateTaxProfile,
}: CreateCommercialAdminRuntimeInput): RuntimeStoreCommercialRuntime['admin'] {
  return {
    async grantCredits(input) {
      assertAdmin(input.session);
      assertPositiveIntegerAmount(input.amount, 'admin.grantCredits');
      const balance = await recordCredit({
        userId: input.userId,
        amount: input.amount,
        unit: input.unit,
        reason: input.reason ?? 'admin.grant',
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        metadata: input.metadata,
      });
      await store.recordAudit({
        ...scope,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.credits.granted',
        metadata: { userId: input.userId, amount: input.amount, unit: balance.unit },
      });
      return balance;
    },
    async adjustCredits(input) {
      assertAdmin(input.session);
      assertIntegerAmount(input.amount, 'admin.adjustCredits');
      const balance = await recordCredit({
        userId: input.userId,
        amount: input.amount,
        unit: input.unit,
        reason: 'admin.adjust',
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });
      await store.recordAudit({
        ...scope,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.credits.adjusted',
        metadata: { userId: input.userId, amount: input.amount, unit: balance.unit },
      });
      return balance;
    },
    async grantEntitlement(input) {
      assertAdmin(input.session);
      const grant = await store.grantEntitlement({
        ...scope,
        userId: input.userId,
        entitlement: input.entitlement,
        planId: input.planId,
        source: 'admin',
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata,
      });
      await store.recordAudit({
        ...scope,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.entitlement.granted',
        metadata: { userId: input.userId, entitlement: input.entitlement },
      });
      return grant;
    },
    async revokeEntitlement(input) {
      assertAdmin(input.session);
      const grant = await store.revokeEntitlement(input.entitlementId, {
        revokedBy: input.session.actorId ?? input.session.user?.id,
        source: 'admin',
        metadata: input.metadata,
      });
      await store.recordAudit({
        productId: grant.productId,
        workspaceId: grant.workspaceId,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.entitlement.revoked',
        metadata: {
          entitlementId: input.entitlementId,
          userId: grant.userId,
          entitlement: grant.entitlement,
          reason: input.reason,
          ...(input.metadata ?? {}),
        },
      });
      return grant;
    },
    async overrideEntitlement(input) {
      assertAdmin(input.session);
      const grant = await store.overrideEntitlement(input.entitlementId, {
        status: input.status,
        expiresAt: input.expiresAt,
        metadata: {
          ...(input.metadata ?? {}),
          overrideBy: input.session.actorId ?? input.session.user?.id,
          overrideReason: input.reason,
          overrideStatus: input.status,
          source: 'admin',
        },
      });
      await store.recordAudit({
        productId: grant.productId,
        workspaceId: grant.workspaceId,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.entitlement.overridden',
        metadata: {
          entitlementId: input.entitlementId,
          userId: grant.userId,
          entitlement: grant.entitlement,
          status: input.status,
          expiresAt: input.expiresAt,
          reason: input.reason,
        },
      });
      return grant;
    },
    async createRedeemCode(input) {
      assertAdmin(input.session);
      const codeHash = hashRedeemCode(input.code);
      const code = await store.upsertRedeemCode({
        productId: scope.productId,
        code: codeHash,
        entitlement: input.entitlement,
        creditsAmount: input.creditsAmount,
        creditsUnit: input.creditsUnit ?? 'credit',
        maxRedemptions: input.maxRedemptions,
        expiresAt: input.expiresAt,
        metadata: {
          ...(input.metadata ?? {}),
          maskedCode: maskRedeemCode(input.code),
          prefix: input.code.includes('_') ? input.code.split('_')[0] : undefined,
          status: 'active',
        },
      });
      await store.recordAudit({
        ...scope,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.redeem_code.upserted',
        metadata: { codeHash, maskedCode: maskRedeemCode(input.code) },
      });
      return code;
    },
    listOrders(query = {}) {
      return store.listCommercialOrders({
        ...query,
        productId: scope.productId,
        workspaceId: scope.workspaceId,
      });
    },
    listCreditLedger(query = {}) {
      return store.listCreditLedger({
        ...query,
        productId: scope.productId,
        workspaceId: scope.workspaceId,
      });
    },
    async reconcileCredits(userId, unit = 'credit') {
      const balance = await creditBalance(userId, unit);
      const ledger = await store.listCreditLedger({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        userId,
        unit,
        status: 'available',
      });
      const ledgerBalance = ledger.reduce((sum, entry) => sum + entry.amount, 0);
      return {
        userId,
        unit,
        balance: balance.balance,
        ledgerBalance,
        ok: balance.balance === ledgerBalance,
      };
    },
    validateTaxProfile,
    async upsertCatalogDraft(input) {
      assertAdmin(input.session);
      const existing = await store.listCommercialCatalogItems({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        kind: input.kind,
        itemId: input.itemId,
      });
      const version = Math.max(0, ...existing.map((item) => item.version)) + 1;
      const item = await store.upsertCommercialCatalogItem({
        ...scope,
        kind: input.kind,
        itemId: input.itemId,
        version,
        status: 'draft',
        value: input.value,
        metadata: input.metadata,
      });
      await store.recordAudit({
        ...scope,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.catalog.draft_upserted',
        metadata: {
          kind: input.kind,
          itemId: input.itemId,
          version: item.version,
        },
      });
      return item;
    },
    async publishCatalogItem<TValue = unknown>(input: {
      session: Parameters<
        RuntimeStoreCommercialRuntime['admin']['publishCatalogItem']
      >[0]['session'];
      kind: RuntimeStoreCommercialCatalogKind;
      itemId: string;
      version?: number;
      metadata?: Record<string, unknown>;
    }) {
      assertAdmin(input.session);
      const items = await store.listCommercialCatalogItems({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        kind: input.kind,
        itemId: input.itemId,
      });
      const source =
        (typeof input.version === 'number'
          ? items.find((item) => item.version === input.version)
          : items.find((item) => item.status === 'draft')) ?? items[0];
      if (!source) {
        throw new Error(`MODULE_COMMERCIAL_CATALOG_ITEM_NOT_FOUND: ${input.kind}.${input.itemId}`);
      }
      const published = await store.upsertCommercialCatalogItem({
        ...scope,
        kind: input.kind,
        itemId: input.itemId,
        version: Math.max(0, ...items.map((item) => item.version)) + 1,
        status: 'published',
        value: source.value,
        metadata: {
          publishedFromVersion: source.version,
          ...(input.metadata ?? {}),
        },
      });
      await store.recordAudit({
        ...scope,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.catalog.published',
        metadata: {
          kind: input.kind,
          itemId: input.itemId,
          version: published.version,
          publishedFromVersion: source.version,
        },
      });
      return published as RuntimeStoreCommercialCatalogItem<TValue>;
    },
    async rollbackCatalogItem<TValue = unknown>(input: {
      session: Parameters<
        RuntimeStoreCommercialRuntime['admin']['rollbackCatalogItem']
      >[0]['session'];
      kind: RuntimeStoreCommercialCatalogKind;
      itemId: string;
      toVersion: number;
      metadata?: Record<string, unknown>;
    }) {
      assertAdmin(input.session);
      const items = await store.listCommercialCatalogItems({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        kind: input.kind,
        itemId: input.itemId,
      });
      const source = items.find((item) => item.version === input.toVersion);
      if (!source) {
        throw new Error(
          `MODULE_COMMERCIAL_CATALOG_VERSION_NOT_FOUND: ${input.kind}.${input.itemId}.${input.toVersion}`
        );
      }
      const rollback = await store.upsertCommercialCatalogItem({
        ...scope,
        kind: input.kind,
        itemId: input.itemId,
        version: Math.max(0, ...items.map((item) => item.version)) + 1,
        status: 'published',
        value: source.value,
        metadata: {
          rollbackToVersion: source.version,
          ...(input.metadata ?? {}),
        },
      });
      await store.recordAudit({
        ...scope,
        actorId: input.session.actorId ?? input.session.user?.id,
        type: 'commercial.catalog.rolled_back',
        metadata: {
          kind: input.kind,
          itemId: input.itemId,
          version: rollback.version,
          rollbackToVersion: source.version,
        },
      });
      return rollback as RuntimeStoreCommercialCatalogItem<TValue>;
    },
    listRevenueBuckets(query = {}) {
      return store.listRevenueBuckets({
        productId: scope.productId,
        workspaceId: scope.workspaceId,
        from: query.from,
        to: query.to,
        currency: query.currency,
      });
    },
  };
}
