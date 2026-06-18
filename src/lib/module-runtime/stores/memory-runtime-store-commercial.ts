import type {
  RuntimeStore,
  RuntimeStoreCommercialCatalogItem,
  RuntimeStoreCommercialOrder,
  RuntimeStoreCommercialOrderStatus,
  RuntimeStoreCreditLedgerEntry,
  RuntimeStoreCreditReservation,
  RuntimeStoreCreditStatus,
  RuntimeStoreEntitlementGrant,
  RuntimeStoreMeteringLedgerEntry,
  RuntimeStoreMeteringStatus,
  UpsertRuntimeStoreCommercialCatalogItemInput,
} from './runtime-store-types';

type InMemoryCommercialRuntimeStore = Pick<
  RuntimeStore,
  | 'recordMetering'
  | 'getMetering'
  | 'updateMeteringStatus'
  | 'listMetering'
  | 'recordCreditLedger'
  | 'consumeCreditLedger'
  | 'listCreditLedger'
  | 'getCreditBalance'
  | 'createCreditReservation'
  | 'getCreditReservation'
  | 'updateCreditReservation'
  | 'listCreditReservations'
  | 'grantEntitlement'
  | 'listEntitlements'
  | 'revokeEntitlement'
  | 'overrideEntitlement'
  | 'upsertCommercialCatalogItem'
  | 'listCommercialCatalogItems'
  | 'createCommercialOrder'
  | 'getCommercialOrder'
  | 'findCommercialOrderByProviderRef'
  | 'attachCommercialOrderProvider'
  | 'updateCommercialOrderStatus'
  | 'listCommercialOrders'
>;

interface CreateInMemoryCommercialRuntimeStoreInput {
  now: () => Date;
  createId: (prefix: string) => string;
}

interface MemoryCreditLedgerWriteInput {
  productId: string;
  environmentId?: string | null;
  workspaceId?: string | null;
  userId: string;
  amount: number;
  unit: string;
  reason: string;
  status?: RuntimeStoreCreditStatus;
  idempotencyKey?: string;
  expiresAt?: string;
  metadata?: Record<string, unknown>;
}

function iso(now: () => Date): string {
  return now().toISOString();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createInMemoryCommercialRuntimeStore({
  now,
  createId,
}: CreateInMemoryCommercialRuntimeStoreInput): InMemoryCommercialRuntimeStore {
  const metering = new Map<string, RuntimeStoreMeteringLedgerEntry>();
  const meteringIdempotency = new Map<string, string>();
  const creditLedger = new Map<string, RuntimeStoreCreditLedgerEntry>();
  const creditIdempotency = new Map<string, string>();
  const creditReservations = new Map<string, RuntimeStoreCreditReservation>();
  const creditReservationIdempotency = new Map<string, string>();
  const entitlements = new Map<string, RuntimeStoreEntitlementGrant>();
  const entitlementIdempotency = new Map<string, string>();
  const commercialCatalog = new Map<string, RuntimeStoreCommercialCatalogItem>();
  const orders = new Map<string, RuntimeStoreCommercialOrder>();
  const orderIdempotency = new Map<string, string>();
  const providerOrders = new Map<string, string>();

  function effectiveCreditStatus(
    record: RuntimeStoreCreditLedgerEntry
  ): RuntimeStoreCreditStatus {
    if (
      record.status === 'available' &&
      record.expiresAt &&
      new Date(record.expiresAt).getTime() <= now().getTime()
    ) {
      return 'expired';
    }
    return record.status;
  }

  function cloneCreditLedger(
    record: RuntimeStoreCreditLedgerEntry
  ): RuntimeStoreCreditLedgerEntry {
    return clone({ ...record, status: effectiveCreditStatus(record) });
  }

  function creditLedgerIdempotencyKey(input: {
    productId: string;
    environmentId?: string | null;
    workspaceId?: string | null;
    userId: string;
    unit: string;
    idempotencyKey?: string;
  }): string | null {
    return input.idempotencyKey
      ? `${input.productId}:${input.environmentId ?? ''}:${input.workspaceId ?? ''}:${input.userId}:${input.unit}:${input.idempotencyKey}`
      : null;
  }

  function creditReservationIdempotencyKey(input: {
    productId: string;
    environmentId?: string | null;
    workspaceId?: string | null;
    userId: string;
    unit: string;
    idempotencyKey?: string;
  }): string | null {
    return input.idempotencyKey
      ? `${input.productId}:${input.environmentId ?? ''}:${input.workspaceId ?? ''}:${input.userId}:${input.unit}:${input.idempotencyKey}`
      : null;
  }

  function availableCreditBalance(input: {
    productId: string;
    environmentId?: string | null;
    workspaceId?: string | null;
    userId: string;
    unit: string;
  }): number {
    return [...creditLedger.values()]
      .filter((record) => record.productId === input.productId)
      .filter(
        (record) =>
          input.environmentId === undefined || (record.environmentId ?? null) === input.environmentId
      )
      .filter(
        (record) => input.workspaceId === undefined || record.workspaceId === input.workspaceId
      )
      .filter((record) => record.userId === input.userId)
      .filter((record) => record.unit === input.unit)
      .filter((record) => effectiveCreditStatus(record) === 'available')
      .reduce((sum, entry) => sum + entry.amount, 0);
  }

  function insertCreditLedger(input: MemoryCreditLedgerWriteInput): RuntimeStoreCreditLedgerEntry {
    const key = creditLedgerIdempotencyKey(input);
    if (key) {
      const existingId = creditIdempotency.get(key);
      if (existingId) {
        return cloneCreditLedger(creditLedger.get(existingId)!);
      }
    }

    const record: RuntimeStoreCreditLedgerEntry = {
      id: createId('credit'),
      productId: input.productId,
      environmentId: input.environmentId ?? null,
      workspaceId: input.workspaceId,
      userId: input.userId,
      amount: input.amount,
      unit: input.unit,
      reason: input.reason,
      status:
        input.status ??
        (input.expiresAt && new Date(input.expiresAt).getTime() <= now().getTime()
          ? 'expired'
          : 'available'),
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
      metadata: input.metadata ?? {},
      createdAt: iso(now),
    };
    creditLedger.set(record.id, record);
    if (key) {
      creditIdempotency.set(key, record.id);
    }
    return cloneCreditLedger(record);
  }

  function readMetering(id: string): RuntimeStoreMeteringLedgerEntry {
    const record = metering.get(id);
    if (!record) {
      throw new Error(`RUNTIME_STORE_METERING_NOT_FOUND: ${id}`);
    }
    return record;
  }

  function readOrder(id: string): RuntimeStoreCommercialOrder {
    const order = orders.get(id);
    if (!order) {
      throw new Error(`RUNTIME_STORE_COMMERCIAL_ORDER_NOT_FOUND: ${id}`);
    }
    return order;
  }

  return {
    async recordMetering(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.moduleId}:${input.meter}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = meteringIdempotency.get(key);
        if (existingId) {
          return clone(metering.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const record: RuntimeStoreMeteringLedgerEntry = {
        id: createId('meter'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        moduleId: input.moduleId,
        meter: input.meter,
        quantity: input.quantity ?? 1,
        unit: input.unit,
        status: 'authorized',
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      metering.set(record.id, record);
      if (key) {
        meteringIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async getMetering(id) {
      const record = metering.get(id);
      return record ? clone(record) : null;
    },
    async updateMeteringStatus(
      id: string,
      status: RuntimeStoreMeteringStatus,
      metadata?: Record<string, unknown>
    ) {
      const previous = readMetering(id);
      const next: RuntimeStoreMeteringLedgerEntry = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      metering.set(id, next);
      return clone(next);
    },
    async listMetering(query = {}) {
      return [...metering.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter((record) => !query.moduleId || record.moduleId === query.moduleId)
        .filter((record) => !query.meter || record.meter === query.meter)
        .filter((record) => !query.status || record.status === query.status)
        .map((record) => clone(record));
    },
    async recordCreditLedger(input) {
      const unit = input.unit ?? 'credit';
      return insertCreditLedger({
        ...input,
        unit,
      });
    },
    async consumeCreditLedger(input) {
      const unit = input.unit ?? 'credit';
      const key = creditLedgerIdempotencyKey({ ...input, unit });
      if (key) {
        const existingId = creditIdempotency.get(key);
        if (existingId) {
          return cloneCreditLedger(creditLedger.get(existingId)!);
        }
      }
      const balance = availableCreditBalance({
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        unit,
      });
      if (balance < input.amount) {
        throw new Error('MODULE_CREDITS_INSUFFICIENT');
      }
      return insertCreditLedger({
        ...input,
        amount: -input.amount,
        unit,
        status: 'available',
      });
    },
    async listCreditLedger(query = {}) {
      return [...creditLedger.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.environmentId === undefined ||
            (record.environmentId ?? null) === query.environmentId
        )
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.unit || record.unit === query.unit)
        .filter((record) => !query.status || effectiveCreditStatus(record) === query.status)
        .map((record) => cloneCreditLedger(record));
    },
    async getCreditBalance(query) {
      const unit = query.unit ?? 'credit';
      return {
        userId: query.userId,
        unit,
        balance: availableCreditBalance({ ...query, unit }),
      };
    },
    async createCreditReservation(input) {
      const unit = input.unit ?? 'credit';
      const key = creditReservationIdempotencyKey({ ...input, unit });
      if (key) {
        const existingId = creditReservationIdempotency.get(key);
        if (existingId) {
          return clone(creditReservations.get(existingId)!);
        }
      }
      const timestamp = iso(now);
      const record: RuntimeStoreCreditReservation = {
        id: input.id ?? createId('credit_reservation'),
        productId: input.productId,
        environmentId: input.environmentId ?? null,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        amountReserved: input.amountReserved,
        amountCommitted: input.amountCommitted ?? 0,
        unit,
        status: input.status ?? 'reserved',
        reason: input.reason,
        source: input.source,
        sourceId: input.sourceId,
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      creditReservations.set(record.id, record);
      if (key) {
        creditReservationIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async getCreditReservation(id) {
      const record = creditReservations.get(id);
      return record ? clone(record) : null;
    },
    async updateCreditReservation(id, patch) {
      const previous = creditReservations.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_CREDIT_RESERVATION_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreCreditReservation = {
        ...previous,
        amountCommitted: patch.amountCommitted ?? previous.amountCommitted,
        status: patch.status ?? previous.status,
        metadata: { ...previous.metadata, ...(patch.metadata ?? {}) },
        updatedAt: iso(now),
      };
      creditReservations.set(id, next);
      return clone(next);
    },
    async listCreditReservations(query = {}) {
      return [...creditReservations.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) =>
            query.environmentId === undefined ||
            (record.environmentId ?? null) === query.environmentId
        )
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.unit || record.unit === query.unit)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.source || record.source === query.source)
        .filter((record) => !query.sourceId || record.sourceId === query.sourceId)
        .filter(
          (record) =>
            !query.expiresBefore ||
            Boolean(record.expiresAt && record.expiresAt <= query.expiresBefore)
        )
        .map((record) => clone(record));
    },
    async grantEntitlement(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.userId}:${input.entitlement}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = entitlementIdempotency.get(key);
        if (existingId) {
          return clone(entitlements.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const record: RuntimeStoreEntitlementGrant = {
        id: createId('entitlement'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        entitlement: input.entitlement,
        planId: input.planId,
        source: input.source,
        status: input.status ?? 'active',
        idempotencyKey: input.idempotencyKey,
        expiresAt: input.expiresAt,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      entitlements.set(record.id, record);
      if (key) {
        entitlementIdempotency.set(key, record.id);
      }
      return clone(record);
    },
    async listEntitlements(query = {}) {
      return [...entitlements.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.userId || record.userId === query.userId)
        .filter((record) => !query.entitlement || record.entitlement === query.entitlement)
        .filter((record) => !query.status || record.status === query.status)
        .map((record) => clone(record));
    },
    async revokeEntitlement(id: string, metadata?: Record<string, unknown>) {
      const previous = entitlements.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_ENTITLEMENT_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreEntitlementGrant = {
        ...previous,
        status: 'revoked',
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      entitlements.set(id, next);
      return clone(next);
    },
    async overrideEntitlement(id, input) {
      const previous = entitlements.get(id);
      if (!previous) {
        throw new Error(`RUNTIME_STORE_ENTITLEMENT_NOT_FOUND: ${id}`);
      }
      const next: RuntimeStoreEntitlementGrant = {
        ...previous,
        status: input.status,
        expiresAt: input.expiresAt === null ? undefined : (input.expiresAt ?? previous.expiresAt),
        metadata: { ...previous.metadata, ...(input.metadata ?? {}) },
        updatedAt: iso(now),
      };
      entitlements.set(id, next);
      return clone(next);
    },
    async upsertCommercialCatalogItem<TValue = unknown>(
      input: UpsertRuntimeStoreCommercialCatalogItemInput<TValue>
    ) {
      const version = input.version ?? 1;
      const key = `${input.productId}:${input.workspaceId ?? ''}:${input.kind}:${input.itemId}:${version}`;
      const existing = commercialCatalog.get(key);
      const timestamp = iso(now);
      const record: RuntimeStoreCommercialCatalogItem<TValue> = {
        id: existing?.id ?? createId('commercial_catalog'),
        productId: input.productId,
        workspaceId: input.workspaceId ?? null,
        kind: input.kind,
        itemId: input.itemId,
        version,
        status: input.status ?? existing?.status ?? 'draft',
        value: input.value,
        metadata: input.metadata ?? {},
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      commercialCatalog.set(key, record);
      return clone(record);
    },
    async listCommercialCatalogItems<TValue = unknown>(
      query: {
        productId?: string;
        workspaceId?: string | null;
        kind?: RuntimeStoreCommercialCatalogItem['kind'];
        status?: RuntimeStoreCommercialCatalogItem['status'];
        itemId?: string;
      } = {}
    ) {
      return [...commercialCatalog.values()]
        .filter((record) => !query.productId || record.productId === query.productId)
        .filter(
          (record) => query.workspaceId === undefined || record.workspaceId === query.workspaceId
        )
        .filter((record) => !query.kind || record.kind === query.kind)
        .filter((record) => !query.status || record.status === query.status)
        .filter((record) => !query.itemId || record.itemId === query.itemId)
        .sort((left, right) => {
          const itemOrder = left.itemId.localeCompare(right.itemId);
          return itemOrder !== 0 ? itemOrder : right.version - left.version;
        })
        .map((record) => clone(record) as RuntimeStoreCommercialCatalogItem<TValue>);
    },
    async createCommercialOrder(input) {
      const key = input.idempotencyKey
        ? `${input.productId}:${input.workspaceId ?? ''}:${input.userId}:${input.idempotencyKey}`
        : null;
      if (key) {
        const existingId = orderIdempotency.get(key);
        if (existingId) {
          return clone(orders.get(existingId)!);
        }
      }
      const providerKey =
        input.provider && input.providerRef
          ? `${input.productId}:${input.workspaceId ?? ''}:${input.provider}:${input.providerRef}`
          : null;
      if (providerKey) {
        const existingId = providerOrders.get(providerKey);
        if (existingId) {
          return clone(orders.get(existingId)!);
        }
      }

      const timestamp = iso(now);
      const order: RuntimeStoreCommercialOrder = {
        id: createId('order'),
        productId: input.productId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        sku: input.sku,
        amount: input.amount,
        currency: input.currency,
        status: 'created',
        provider: input.provider,
        providerRef: input.providerRef,
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      orders.set(order.id, order);
      if (key) {
        orderIdempotency.set(key, order.id);
      }
      if (providerKey) {
        providerOrders.set(providerKey, order.id);
      }
      return clone(order);
    },
    async getCommercialOrder(id) {
      const order = orders.get(id);
      return order ? clone(order) : null;
    },
    async findCommercialOrderByProviderRef(productId, workspaceId, provider, providerRef) {
      const id = providerOrders.get(`${productId}:${workspaceId ?? ''}:${provider}:${providerRef}`);
      return id ? clone(orders.get(id)!) : null;
    },
    async attachCommercialOrderProvider(
      id: string,
      provider: string,
      providerRef: string,
      metadata?: Record<string, unknown>
    ) {
      const previous = readOrder(id);
      const key = `${previous.productId}:${previous.workspaceId ?? ''}:${provider}:${providerRef}`;
      const existingId = providerOrders.get(key);
      if (existingId && existingId !== id) {
        throw new Error(`RUNTIME_STORE_COMMERCIAL_ORDER_PROVIDER_REF_CONFLICT: ${providerRef}`);
      }
      const next: RuntimeStoreCommercialOrder = {
        ...previous,
        provider,
        providerRef,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      orders.set(id, next);
      providerOrders.set(key, id);
      return clone(next);
    },
    async updateCommercialOrderStatus(
      id: string,
      status: RuntimeStoreCommercialOrderStatus,
      metadata?: Record<string, unknown>
    ) {
      const previous = readOrder(id);
      const next: RuntimeStoreCommercialOrder = {
        ...previous,
        status,
        metadata: { ...previous.metadata, ...(metadata ?? {}) },
        updatedAt: iso(now),
      };
      orders.set(id, next);
      return clone(next);
    },
    async listCommercialOrders(query = {}) {
      return [...orders.values()]
        .filter((order) => !query.productId || order.productId === query.productId)
        .filter(
          (order) => query.workspaceId === undefined || order.workspaceId === query.workspaceId
        )
        .filter((order) => !query.userId || order.userId === query.userId)
        .filter((order) => !query.status || order.status === query.status)
        .map((order) => clone(order));
    },
  };
}
